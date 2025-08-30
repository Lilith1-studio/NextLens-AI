// contactRoutes.js - Handles all contact-related API endpoints using Supabase.

import express from 'express';
const router = express.Router();

// This function is designed to be called from your main server file,
// where you would pass the initialized Supabase client.
export default (supabase) => {
    // The Supabase client is now available via the `supabase` parameter

    // Middleware to verify Supabase token and attach user to request
    // This middleware can be reused across different route files
    const verifyToken = async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1]; // Assuming token is in "Bearer TOKEN" format
        if (!token) {
            return res.status(401).json({
                error: 'Unauthorized: No token provided.'
            });
        }

        try {
            // Use the Supabase client (initialized with service role key in index.js)
            // to verify the token on the backend.
            const {
                data: {
                    user
                },
                error
            } = await supabase.auth.getUser(token);
            if (error || !user) {
                console.error('Supabase token verification failed:', error);
                return res.status(401).json({
                    error: 'Unauthorized: Invalid or expired token.'
                });
            }
            req.user = user; // Attach the authenticated user to the request object
            next(); // Proceed to the route handler
        } catch (error) {
            console.error('Unexpected error during token verification:', error);
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
        }
    };


    // POST /api/contact - Handle contact form submissions.
    // Requires authentication using the verifyToken middleware.
    router.post('/', verifyToken, async (req, res) => {
        // Access the authenticated user ID from req.user
        const userId = req.user.id;
        const { name, email, reason_for_contact, message } = req.body; // Destructure form fields from the request body

        if (!name || !email || !reason_for_contact || !message) {
            return res.status(400).json({
                error: 'All fields are required.'
            });
        }

        try {
            // Insert the contact form data into the 'contact_submissions' table
            // using the Supabase client passed to this module.
            const {
                data,
                error
            } = await supabase
                .from('contact_submissions') // Reference your Supabase table name
                .insert([{
                    user_id: userId, // Link the submission to the authenticated user
                    name: name,
                    email: email,
                    reason_for_contact: reason_for_contact,
                    message: message,
                    // created_at will be set by the database default (now())
                }])
                .select(); // Select the inserted row to return its data

            if (error) {
                console.error('Error inserting contact submission into Supabase:', error);
                return res.status(500).json({
                    error: 'Failed to submit contact form.'
                });
            }

            // Return a success message
            res.status(200).json({
                message: 'Contact form submitted successfully.'
            });

        } catch (error) {
            console.error('Unexpected error submitting contact form:', error);
            res.status(500).json({
                error: 'An error occurred while submitting the contact form.'
            });
        }
    });

    return router;
};