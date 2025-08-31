import express from 'express';
import { createClient } from '@supabase/supabase-js';
import authRoutes from './authRoutes.js';
import jobRoutes from './jobRoutes.js';
import chatRoutes from './chatRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import contactRoutes from './contactRoutes.js';

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware for parsing JSON bodies
app.use(express.json());

// --- Centralized Supabase Client Initialization ---
const supabaseUrl = process.env.SUPABASE_URL || 'https://fwlzbipxuaibbgdnhwbk.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bHpiaXB4dWFpYmJnZG5od2JrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjEzMDMyOSwiZXhwIjoyMDcxNzA2MzI5fQ.UtW-v-1gClI2N2aXyBl2hBvTf2i2g1O2f4W2Lz_2k5A';

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Supabase URL and Service Role Key are required.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Route Definitions ---
if (typeof authRoutes === 'function') {
    app.use('/api/auth', authRoutes(supabase));
} else {
    console.error('authRoutes is not a function. Check the export in authRoutes.js.');
}
if (typeof jobRoutes === 'function') {
    app.use('/api/jobs', jobRoutes(supabase));
} else {
    console.error('jobRoutes is not a function. Check the export in jobRoutes.js.');
}
if (typeof chatRoutes === 'function') {
    app.use('/api/chat', chatRoutes(supabase));
} else {
    console.error('chatRoutes is not a function. Check the export in chatRoutes.js.');
}
if (typeof notificationRoutes === 'function') {
    app.use('/api/notifications', notificationRoutes(supabase));
} else {
    console.error('notificationRoutes is not a function. Check the export in notificationRoutes.js.');
}
if (typeof contactRoutes === 'function') {
    app.use('/api/contact', contactRoutes(supabase));
} else {
    console.error('contactRoutes is not a function. Check the export in contactRoutes.js.');
}

// Basic error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
