// chatRoutes.js - Handles all chat-related API endpoints.

import express from 'express';

const router = express.Router();

export default (supabaseClient) => {
    const supabase = supabaseClient;

    // Middleware to verify Supabase JWT token and attach user to request
    const authenticate = async (req, res, next) => { // Renamed from authenticateFirebase
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: No token provided.' });
        }
            // Use Supabase auth.getUser() to validate the JWT
            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (error || !user) {
                console.error('Supabase auth error:', error?.message);
                return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
            }

            req.user = user; // Attach authenticated Supabase user object
            next(); // Proceed to the next middleware or route handler
    };

    // Endpoint to validate token and return user info (for frontend authentication check)
    router.post('/check-status', authenticate, (req, res) => {
        // If authenticate middleware succeeds, req.user contains the Supabase user
        res.status(200).json({ authenticated: true, user: req.user });
    });

    // GET /api/chat-connections - Get the user's chat connections/rooms
    router.get('/chat-connections', authenticate, async (req, res) => {
        const userId = req.user.id; // Get user's ID from Supabase user object

        try {
            // Fetch chat room documents where the authenticated user is a participant
            // Assuming a 'chat_rooms' table with 'participants' (array of user IDs), 'last_message', 'last_message_timestamp'
            const { data: chatRooms, error: chatRoomsError } = await supabase
                .from('chat_rooms')
                .select('*') // Select all columns, including participants array
                .contains('participants', [userId]) // Find rooms where the user is in the participants array
                .order('last_message_timestamp', { ascending: false });

            if (chatRoomsError) {
                console.error('Error fetching chat rooms from Supabase:', chatRoomsError);
                throw chatRoomsError; // Re-throw to be caught by outer catch block
            }

            const transformedChatRooms = [];

            for (const room of chatRooms) {
                const otherParticipantId = room.participants.find(id => id !== userId);

                if (otherParticipantId) {
                    // Fetch the other participant's profile (assuming a 'profiles' table with 'id', 'name', 'avatar_url')
                    const { data: otherParticipant, error: profileError } = await supabase
                        .from('profiles')
                        .select('id, name, avatar_url')
                        .eq('id', otherParticipantId)
                        .single(); // Get a single result or null/error

                    // Construct chat room object
                    transformedChatRooms.push({
                        id: room.id,
                        otherParticipant: {
                            id: otherParticipantId,
                            name: otherParticipant?.name || 'Unknown User', // Use fetched name or fallback
                            profilePic: otherParticipant?.avatar_url || `https://placehold.co/40x40/e2e8f0/000000?text=${otherParticipant?.name?.charAt(0) || 'U'}`, // Use fetched avatar_url or fallback
                        },
                        lastMessage: room.last_message || '', // Use column name from Supabase table
                        time: room.last_message_timestamp ? new Date(room.last_message_timestamp).toISOString() : null, // Use column name from Supabase table
                        // You might add logic here to calculate unread count for the current user from a separate table/logic
                        unread: 0 // Placeholder
                    });
                }
                // If no other participant is found (e.g., error in data, or a solo room which shouldn't happen in this context),
                // that room is effectively skipped from the list presented to the user.
            }

            // In this simplified version, we treat all fetched rooms as 'connections'
            // You would need separate logic/tables in Supabase to distinguish between 'connections' and 'requests'
            res.status(200).json({ connections: transformedChatRooms, requests: [] }); // Return empty requests array for now

        } catch (error) {
            console.error('Error fetching chat connections:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // GET /api/chat/get-messages/:chatId - Get messages for a specific chat room
    router.get('/get-messages/:chatId', authenticate, async (req, res) => {
        const { chatId } = req.params;
        const userId = req.user.id; // Get user's ID from Supabase user object

        try {
            // First, verify that the user is a participant in the specified chat room
            const { data: chatRoom, error: roomError } = await supabase
                .from('chat_rooms')
                .select('participants')
                .eq('id', chatId)
                .contains('participants', [userId]) // Check if user is a participant
                .single();

            if (roomError || !chatRoom) {
                console.error('Chat room verification failed or room not found:', roomError?.message);
                return res.status(403).json({ error: 'Forbidden: You are not a participant in this chat room.' });
            }

            // Fetch messages from the 'messages' table for the given chat_id, ordered by timestamp
            const { data: messages, error: messagesError } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId) // Filter by chat room ID
                .order('created_at', { ascending: true }); // Order by timestamp

            if (messagesError) {
                console.error('Error fetching messages from Supabase:', messagesError);
                throw messagesError; // Re-throw to be caught by outer catch block
            }

            // Transform messages for the frontend, including sender context ('my' or 'other')
            const transformedMessages = messages.map(msg => ({
                id: msg.id,
                chatId: msg.chat_id,
                senderId: msg.sender_id, // Keep sender_id for potential frontend use (e.g., displaying sender name)
                sender: msg.sender_id === userId ? 'my' : 'other', // Determine if the message is from the current user
                text: msg.text,
                files: msg.files_urls || [], // Use column name for file URLs (expected to be an array)
                replyTo: msg.reply_to_message_id ? { messageId: msg.reply_to_message_id } : null, // Structure for frontend reply display
                time: new Date(msg.created_at).toISOString(), // Use column name for timestamp
                isEdited: msg.is_edited || false, // Use column name for edited status
                isPinned: msg.is_pinned || false, // Use column name for pinned status
            }));

            // Filter out messages deleted by the current user
            const filteredMessages = transformedMessages.filter(msg =>
                !(msg.deleted_by && msg.deleted_by.includes(userId))
            );
            res.status(200).json(filteredMessages);

        } catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // POST /api/chat/send-message - Send a new message (text and/or files)
    router.post('/send-message', authenticate, async (req, res) => {
        const { chatRoomId, text, replyToMessageId } = req.body;
        const senderId = req.user.id; // Get sender's ID from authenticated Supabase user
        const files = req.files; // Assuming 'req.files' is populated by a middleware like 'express-fileupload' or 'multer'

        if (!chatRoomId || (!text && (!files || files.length === 0))) {
            return res.status(400).json({ error: 'chatRoomId is required.' });
        }

        try {
            // Verify that the user is a participant in the chat room before allowing message creation
            const { count: participantCount, error: participantError } = await supabase
                .from('chat_rooms')
                .select('id', { count: 'exact' })
                .eq('id', chatRoomId)
                .contains('participants', [senderId]);

            if (participantError || participantCount === 0) {
                console.error('Participant verification failed:', participantError?.message);
                return res.status(403).json({ error: 'Forbidden: You are not a participant in this chat room.' });
            }

            // --- File Upload to Supabase Storage ---
            const uploadedFilesUrls = [];
            if (files && files.length > 0) {
                for (const file of files) {
                    const filePath = `${chatRoomId}/${senderId}/${Date.now()}-${file.originalname}`; // Unique path within a chat room and user
                    
                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('chat_media') // Assuming you have a bucket named 'chat_media'
                        .upload(filePath, file.buffer, { // Use file.buffer if using multer, or file.data if using express-fileupload
                            contentType: file.mimetype,
                            upsert: false // Prevent overwriting
                        });

                    if (uploadError) {
                        console.error('Error uploading file to Supabase Storage:', uploadError);
                        // Depending on requirements, you might stop the process or continue without this file
                        // For now, we'll throw an error to fail the message sending
                        throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
                    }

                    // Get the public URL for the uploaded file
                    const { data: publicUrlData } = supabase.storage
                        .from('chat_media')
                        .getPublicUrl(filePath);

                    if (publicUrlData?.publicUrl) {
                        uploadedFilesUrls.push({
                            name: file.originalname,
                            type: file.mimetype,
                            url: publicUrlData.publicUrl
                        });
                    } else {
                        console.warn('Could not get public URL for file:', filePath);
                        // Handle case where public URL is not available immediately
                    }
                }
            }
            // --- End File Upload ---

            // Insert the new message into the 'messages' table
            // Assuming a 'messages' table with columns: id, chat_id, sender_id, text, files_urls (jsonb array), reply_to_message_id, created_at, is_edited, is_pinned
            const newMessage = {
                chat_id: chatRoomId,
                sender_id: senderId,
                text: text || null, // Allow messages with only files
                files_urls: uploadedFilesUrls.length > 0 ? uploadedFilesUrls : null, // Store array of uploaded file metadata (name, type, url)
                reply_to_message_id: replyToMessageId || null, // ID of the message being replied to
                // created_at column is automatically set by Supabase with a default timestamp
                is_edited: false,
                is_pinned: false,
            };

            const { data: insertedMessage, error: insertError } = await supabase
                .from('messages')
                .insert([newMessage])
                .select('*') // Select the inserted row to return
                .single(); // Expecting a single inserted row

            if (insertError) {
                console.error('Error inserting message into Supabase:', insertError);
                throw insertError; // Re-throw to be caught by outer catch block
            }

            // Update the 'last_message' and 'last_message_timestamp' fields on the chat_rooms table
            const { error: updateError } = await supabase
                .from('chat_rooms')
                .update({
                    last_message: text ? text.substring(0, 100) : (uploadedFilesUrls.length > 0 ? `Sent ${uploadedFilesUrls.length} file(s)` : ''), // Snippet or file indicator
                    last_message_timestamp: new Date().toISOString(), // Use current server time
                    // TODO: Add logic here to update 'unread_count' for other participants
                })
                .eq('id', chatRoomId);

            if (updateError) {
                console.error('Error updating chat room timestamp:', updateError);
                // Log the error but still return success for the message send, as the message itself was saved.
            }

            // Return the newly created message data to the frontend
            res.status(201).json({
                message: 'Message sent successfully!',
                sentMessage: {
                    id: insertedMessage.id,
                    chatId: insertedMessage.chat_id,
                    senderId: insertedMessage.sender_id,
                    sender: insertedMessage.sender_id === userId ? 'my' : 'other',
                    text: insertedMessage.text,
                    files: insertedMessage.files_urls || [],
                    replyTo: insertedMessage.reply_to_message_id ? { messageId: insertedMessage.reply_to_message_id } : null,
                    time: new Date(insertedMessage.created_at).toISOString(),
                    isEdited: insertedMessage.is_edited,
                    isPinned: insertedMessage.is_pinned,
                }
            });

        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // POST /api/chat/create-chat-room
    router.post('/create-chat-room', authenticate, async (req, res) => {
        const { otherParticipantId } = req.body; // Changed variable name for clarity
        const userId = req.user.id; // Get current user's ID

        if (!otherParticipantId || userId === otherParticipantId) {
            return res.status(400).json({ error: 'Invalid otherParticipantId.' });
        }

        try {
            // Check if a chat room already exists between these two users
            // We need to find a room where the participants array contains *both* user IDs.
            // Supabase's `contains` can check if an array column contains ALL the values in a provided array.
            const { data: existingRoom, error: existingRoomError } = await supabase
                .from('chat_rooms')
                .select('id')
                .contains('participants', [userId, otherParticipantId])
                .limit(1) // We only need to find one if it exists
                .single(); // Get a single result or null/error

            if (existingRoomError && existingRoomError.code !== 'PGRST116') { // PGRST116 means 'The result contains 0 rows'
                console.error('Error checking for existing chat room:', existingRoomError);
                throw existingRoomError;
            }

            if (existingRoom) {
                // Room already exists, return its ID
                return res.status(200).json({ message: 'Chat room already exists.', chatRoomId: existingRoom.id });
            }

            // If no existing room, create a new one
            const newChatRoom = {
                participants: [userId, otherParticipantId],
                // created_at column is automatically set by Supabase
                last_message: '', // Initialize
                last_message_timestamp: new Date().toISOString(), // Initialize with current time
                // TODO: Add columns/logic for unread counts, room type (e.g., direct, group), etc.
            };

            // Insert the new chat room into the 'chat_rooms' table
            const { data: insertedRoom, error: insertError } = await supabase
                .from('chat_rooms')
                .insert([newChatRoom])
                .select('id') // Select the ID of the newly created room
                .single();

            if (insertError) {
                console.error('Error creating chat room in Supabase:', insertError);
                throw insertError;
            }

            res.status(201).json({ message: 'Chat room created successfully.', chatRoomId: insertedRoom.id });

        } catch (error) {
            console.error('Error creating chat room:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // PUT /api/chat/edit-message/:messageId - Edit a message
    router.put('/edit-message/:messageId', authenticate, async (req, res) => {
        const { messageId } = req.params;
        const { newText } = req.body;
        const userId = req.user.id;

        if (!newText) {
            return res.status(400).json({ error: 'newText is required.' });
        }

        try {
            // Verify the message exists and the user is the sender
            const { data: message, error: fetchError } = await supabase
                .from('messages')
                .select('id, sender_id')
                .eq('id', messageId)
                .eq('sender_id', userId) // Ensure the user is the sender
                .single();

            if (fetchError || !message) {
                console.error('Message fetch or sender verification failed:', fetchError?.message);
                return res.status(403).json({ error: 'Forbidden: You can only edit your own messages.' });
            }

            // Update the message
            const { data: updatedMessage, error: updateError } = await supabase
                .from('messages')
                .update({ text: newText, is_edited: true })
                .eq('id', messageId)
                .select('*') // Select the updated row
                .single();

            if (updateError) {
                console.error('Error updating message:', updateError);
                throw updateError;
            }

            res.status(200).json({ message: 'Message edited successfully.', updatedMessage });

        } catch (error) {
            console.error('Error editing message:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // DELETE /api/chat/delete-message/:messageId - Delete a message for the current user
    router.delete('/delete-message/:messageId', authenticate, async (req, res) => {
        const { messageId } = req.params;
        const userId = req.user.id;

        try {
            // Fetch the message to ensure it exists and get current deleted_by array
            const { data: message, error: fetchError } = await supabase
                .from('messages')
                .select('id, deleted_by')
                .eq('id', messageId)
                .single();

            if (fetchError || !message) {
                console.error('Message fetch failed:', fetchError?.message);
                return res.status(404).json({ error: 'Message not found.' });
            }

            // Add the current user's ID to the deleted_by array
            const currentDeletedBy = message.deleted_by || [];
            if (currentDeletedBy.includes(userId)) {
                return res.status(200).json({ message: 'Message already deleted by this user.' });
            }
            const newDeletedBy = [...currentDeletedBy, userId];

            // Update the message with the new deleted_by array
            const { error: updateError } = await supabase
                .from('messages')
                .update({ deleted_by: newDeletedBy })
                .eq('id', messageId);

            if (updateError) {
                console.error('Error updating message deleted_by:', updateError);
                throw updateError;
            }

            res.status(200).json({ message: 'Message deleted for this user successfully.' });

        } catch (error) {
            console.error('Error deleting message:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // PUT /api/chat/pin-message/:messageId - Pin or unpin a message
    router.put('/pin-message/:messageId', authenticate, async (req, res) => {
        const { messageId } = req.params;
        const { pin } = req.body; // Expect true to pin, false to unpin
        const userId = req.user.id;

        if (typeof pin !== 'boolean') {
            return res.status(400).json({ error: 'Boolean value "pin" is required.' });
        }

        try {
            // Verify the message exists and the user is a participant in the chat room
            const { data: message, error: fetchError } = await supabase
                .from('messages')
                .select('id, chat_id')
                .eq('id', messageId)
                .single();

            if (fetchError || !message) {
                 console.error('Message fetch failed:', fetchError?.message);
                 return res.status(404).json({ error: 'Message not found.' });
            }

             // You might want to add an extra check here to ensure the user is a participant
             // in the chat room of the message. This would involve fetching the chat_room
             // and checking the participants array, similar to the /get-messages endpoint.

            // Update the message's is_pinned status
            const { error: updateError } = await supabase
                .from('messages')
                .update({ is_pinned: pin })
                .eq('id', messageId);

            if (updateError) {
                console.error('Error updating message pinned status:', updateError);
                throw updateError;
            }

            res.status(200).json({ message: `Message ${pin ? 'pinned' : 'unpinned'} successfully.` });

        } catch (error) {
            console.error('Error pinning/unpinning message:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // POST /api/chat/block-user - Block a user
    router.post('/block-user', authenticate, async (req, res) => {
        const { blockedUserId } = req.body;
        const blockerId = req.user.id;

        if (!blockedUserId || blockerId === blockedUserId) {
            return res.status(400).json({ error: 'Invalid blockedUserId.' });
        }

        try {
            // Optional: Verify that both users exist in the 'profiles' table
            // const { data: usersExist, error: usersExistError } = await supabase
            //     .from('profiles')
            //     .select('id')
            //     .in('id', [blockerId, blockedUserId])
            //     .then(({ data }) => ({ data, error: null })) // Simple check for both IDs existing

            // if (usersExistError || !usersExist || usersExist.length !== 2) {
            //     console.error('Error verifying users:', usersExistError?.message);
            //     return res.status(404).json({ error: 'One or both users not found.' });
            // }

            // Check if the user is already blocked
            const { count: existingBlockCount, error: existingBlockError } = await supabase
                 .from('blocked_users')
                 .select('id', { count: 'exact' })
                 .eq('blocker_id', blockerId)
                 .eq('blocked_id', blockedUserId);

            if (existingBlockError) {
                 console.error('Error checking for existing block:', existingBlockError);
                 throw existingBlockError;
            }

            if (existingBlockCount > 0) {
                 return res.status(200).json({ message: 'User already blocked.' });
            }

            // Insert into 'blocked_users' table
            const { error: insertError } = await supabase
                .from('blocked_users')
                .insert([{ blocker_id: blockerId, blocked_id: blockedUserId }]);

            if (insertError) {
                console.error('Error blocking user:', insertError);
                throw insertError;
            }

            res.status(201).json({ message: 'User blocked successfully.' });

        } catch (error) {
            console.error('Error blocking user:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // POST /api/chat/report-item - Report a message or chat room
    router.post('/report-item', authenticate, async (req, res) => {
        const { itemType, itemId, reason } = req.body;
        const reporterId = req.user.id;

        if (!['message', 'chat'].includes(itemType) || !itemId || !reason) {
            return res.status(400).json({ error: 'itemType ("message" or "chat"), itemId, and reason are required.' });
        }

        try {
            // Optional: Verify the existence and user's relation to the reported item
            // - If itemType is 'message', check if the message exists and the reporter is in the chat room.
            // - If itemType is 'chat', check if the chat room exists and the reporter is a participant.

            // Insert into 'reports' table
            const { error: insertError } = await supabase
                .from('reports')
                .insert([{ reporter_id: reporterId, item_type: itemType, item_id: itemId, reason: reason }]);

            if (insertError) {
                console.error('Error reporting item:', insertError);
                throw insertError;
            }

            res.status(201).json({ message: `${itemType} reported successfully.` });

        } catch (error) {
            console.error('Error reporting item:', error);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // TODO: Implement endpoints for editing, deleting, pinning messages, and handling blocks/reports
    // Example: POST /api/chat/edit-message/:messageId
    // Example: POST /api/chat/delete-message/:messageId (for everyone or just user)
    // Example: POST /api/chat/pin-message/:messageId
    // Example: POST /api/chat/block-user
    // Example: POST /api/chat/report-item (for message or chat room)

    return router;
};