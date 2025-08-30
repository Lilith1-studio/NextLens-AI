// notificationRoutes.js - Handles all notification-related API endpoints.

import express from 'express';
const router = express.Router();

export default (supabase) => {
    // Middleware to verify Supabase token and get user ID
    const authenticate = async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.error('Authentication failed: No token provided.');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split('Bearer ')[1];
        try {
            const { data: user, error } = await supabase.auth.getUser(token);
            console.log('Authentication user data:', user); // Log user data for debugging
            if (error || !user) {
                console.error('Authentication failed:', error?.message || 'User not found');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            req.user = user.user; // Attach the user object to the request
            next();
        } catch (error) {
            console.error('Authentication failed:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    };

    // GET /api/notifications - Fetch notifications for the authenticated user
    router.get('/', authenticate, async (req, res) => {
        try {
            const authenticatedUserId = req.user.id; // Get authenticated user ID

            // Get the user's role from the 'users' table
            const { data: userProfile, error: profileError } = await supabase
                .from('users') // Assuming 'users' is your user profile table
                .select('role, id') // Select id as well for clarity
                .eq('id', authenticatedUserId)
                .single();

            if (profileError || !userProfile) {
                console.error('Error fetching user profile:', profileError?.message || 'Profile not found');
                return res.status(500).json({ error: 'Error fetching user role' });
            }

            let data;
            let error;

            if (userProfile.role === 'company') {
 // For company users, fetch applications for jobs they posted
 // Join applications with jobs and applicant's user/profile data
 const { data: applicationsData, error: applicationsError } = await supabase
 .from('applications')
                    .select(`
 id,
 created_at, // Keep created_at from applications table
 status,
 submitted_items,
 job_title:jobs!inner(
 title as job_title,
 company_id
 ),
 applicant:users!applications_applicant_id_fkey(
 applicant_id:id,
 name,
 avatar_url
 )`)
                    .eq('jobs.company_id', authenticatedUserId); // Filter by the company's user ID

                data = applicationsData;
                error = applicationsError;
            } else {
                // If the user is 'talent' or another role, fetch their direct notifications
                // This is the original logic for fetching notifications
                ({ data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', authenticatedUserId)); // Filter by user_id
            }

            if (error) {
                console.error('Error fetching notifications:', error.message);
                return res.status(500).json({ error: 'Error fetching notifications' });
            }
            res.json(data);
        } catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // POST /api/notifications/mark-read - Mark notifications as read
    router.post('/mark-read', authenticate, async (req, res) => {
        try {
            const { notificationIds } = req.body; // Accepts an array of notification IDs
            if (!Array.isArray(notificationIds)) {
                return res.status(400).json({ error: 'notificationIds must be an array' });
            }

            // Update records where the id is in the provided array
            const { data, error } = await supabase
                .from('notifications')
                .update({ is_read: true }) // Assuming the column name is is_read
                .in('id', notificationIds);

            if (error) {
                console.error('Error marking notifications as read:', error.message);
                return res.status(500).json({ error: 'Error marking notifications as read' });
            }

            res.status(200).json({ message: 'Notifications marked as read' });
        } catch (error) {
            console.error('Error marking notifications as read:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // POST /api/notifications/add - Add a new notification
    // This endpoint might be called by other parts of your backend
    // (e.g., when a job application is submitted or a connection request is made).
    // It requires the user_id of the recipient, the type, and content of the notification.
    router.post('/add', authenticate, async (req, res) => {
 try {
            const { user_id, type, content, related_entity_id } = req.body; // related_entity_id could be job_id, user_id, etc.

            if (!user_id || !type || !content) {
                return res.status(400).json({ error: 'Recipient user_id, type, and content are required' });
            }

            // Ensure the user_id corresponds to an existing user
            const { data: recipient, error: recipientError } = await supabase
                .from('users') // Or your user table name
                .select('id')
                .eq('id', user_id)
                .single();

            if (recipientError || !recipient) {
                return res.status(404).json({ error: 'Recipient user not found' });
            }

            const { data, error } = await supabase
 .from('notifications') // Assuming 'notifications' table is for general notifications
 // Note: This endpoint seems designed for general notifications. If you need to specifically link to application data, the structure might need adjustments to match the frontend's expectation (e.g., including job_id, applicant_id, etc., directly in the notification row or a related table).
                .insert([
                    { user_id, type, content, related_entity_id } // is_read defaults to false
                ]);

            if (error) {
                console.error('Error adding notification:', error.message);
                return res.status(500).json({ error: 'Error adding notification' });
            }

            res.status(201).json({ message: 'Notification added successfully' });
        } catch (error) {
            console.error('Error adding notification:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // POST /api/update-application-status - Update the status of a job application
    router.post('/update-application-status', authenticate, async (req, res) => {
        try {
            const { applicationId, newStatus } = req.body;
            const authenticatedUserId = req.user.id;

            // Basic validation
            if (!applicationId || !newStatus) {
                return res.status(400).json({ error: 'applicationId and newStatus are required' });
            }

            // Update the status in the 'applications' table
 // Ensure the authenticated user (company) is authorized to update this specific application (e.g., they posted the job)

 // 1. Get the job_id for the application
            const { data: applicationData, error: applicationError } = await supabase
                .from('applications')
                .select('job_id')
                .eq('id', applicationId)
                .single();

            if (applicationError || !applicationData) {
                console.error('Error fetching application:', applicationError?.message || 'Application not found');
                return res.status(404).json({ error: 'Application not found' });
            }

            const jobId = applicationData.job_id;

            // 2. Get the company_id for the job
            const { data: jobData, error: jobError } = await supabase
                .from('jobs')
                .select('company_id')
                .eq('id', jobId)
                .single();

            if (jobError || !jobData || jobData.company_id !== authenticatedUserId) {
                console.warn(`Unauthorized attempt to update application ${applicationId} by user ${authenticatedUserId}. Job owner is ${jobData?.company_id}.`);
                return res.status(403).json({ error: 'Forbidden: You are not authorized to update this application.' });
            }

 // 3. If authorized, update the status
            const { data, error } = await supabase
                .from('applications')
                .update({ status: newStatus })
                .eq('id', applicationId); // Assuming the application ID column is 'id'
            if (error) {
                console.error('Error updating application status:', error.message);
                return res.status(500).json({ error: 'Error updating application status' });
            }

 // Optional: Add logic to send a notification to the applicant about the status change here
 // Fetch applicant's user ID
            const { data: applicantUserData, error: applicantUserError } = await supabase
                .from('applications')
                .select('applicant_id, job_title:jobs(title)') // Select applicant_id and job title
                .eq('id', applicationId)
                .single();

            if (applicantUserError || !applicantUserData || !applicantUserData.applicant_id) {
                console.error('Error fetching applicant user ID for notification:', applicantUserError?.message || 'Applicant user not found');
 // Continue with status update success, but log the notification failure
            } else {
                const applicantId = applicantUserData.applicant_id;
                const jobTitle = applicantUserData.job_title ? applicantUserData.job_title.title : 'a job'; // Get job title

 // Create content for the notification
                const notificationContent = {
                    applicationId: applicationId,
                    jobTitle: jobTitle,
                    newStatus: newStatus,
 company: userProfile.name || 'Your Company' // Assuming 'name' is available in the company user profile
                };

 // Insert a new notification for the applicant
                const { error: notificationError } = await supabase
                    .from('notifications') // Assuming notifications table is for talent-facing updates
                    .insert([
                        { user_id: applicantId, type: 'Application Status Update', content: notificationContent, related_entity_id: applicationId }
                    ]);
                if (notificationError) console.error('Error creating notification for applicant:', notificationError.message);
            }

            res.status(200).json({ message: 'Application status updated successfully' });
        } catch (error) {
            console.error('Error updating application status:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    return router;
};
