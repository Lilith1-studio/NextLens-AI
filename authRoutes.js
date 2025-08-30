// authRoutes.js - Handles all authentication-related API endpoints.

import express from 'express';

const router = express.Router();

// This function is designed to be called from your main server file,
// where you will pass the initialized Supabase client.
export default (supabase) => {

    // Supabase signup endpoint
    // POST /api/auth/supabase-signup
    router.post('/supabase-signup', async (req, res) => {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Email, password, and role are required.' });
        }

        try {
            // Create user in Supabase Auth
            const { data: { user, session }, error: authError } = await supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (authError) {
                console.error('Supabase Auth signup error:', authError);
                return res.status(400).json({ error: authError.message });
            }

            // If signup is successful, user will not be null.
            if (user) {
                // Store user profile in the 'users' table
                const { error: dbError } = await supabase
                    .from('users')
                    .insert([
                        { user_id: user.id, email: user.email, role: role } // Assumes table has user_id, email, role
                    ]);

                if (dbError) {
                    console.error('Supabase DB insert error:', dbError);
                    // IMPORTANT: If saving the profile fails, delete the user from Auth to prevent orphaned accounts.
                    // This requires the service_role key, which is used when initializing the client in index.js.
                    await supabase.auth.admin.deleteUser(user.id);
                    return res.status(500).json({ error: 'Error saving user profile.' });
                }
            }


            // Return success message and user info
            res.status(201).json({ message: 'User created successfully!', user: user, session: session });
        } catch (error) {
            console.error('Error creating user:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Supabase login endpoint
    // POST /api/auth/supabase-login
    router.post('/supabase-login', async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        try {
            // Sign in user with Supabase Auth
            const { data: { user, session }, error: authError } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (authError) {
                console.error('Supabase Auth login error:', authError);
                return res.status(401).json({ error: authError.message });
            }

            // Return session token and user data
            res.status(200).json({ message: 'Login successful!', user: user, session: session });
        } catch (error) {
            console.error('Error logging in user:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
