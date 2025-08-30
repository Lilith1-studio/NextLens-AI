import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const router = express.Router();

// This module now exports a function that accepts the Supabase client
export default function(supabase) {

    // Configure Multer for file uploads
    const upload = multer({ storage: multer.memoryStorage() });

    const authenticate = async (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.sendStatus(401);
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.sendStatus(401);
        }
        req.user = user;
        next();
    };

    const authorizeRoleMiddleware = (requiredRole) => {
        return async (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required.' });
            }

            const { data: profile, error } = await supabase
                .from('users')
                .select('role')
                .eq('id', req.user.id)
                .single();

            if (error || !profile || profile.role !== requiredRole) {
                return res.status(403).json({ error: 'Forbidden: Insufficient role.' });
            }
            next();
        };
    };

    async function uploadFileToSupabase(file, bucketName, filePath) {
        try {
            const { data, error } = await supabase.storage
                .from(bucketName)
                .upload(filePath, file.buffer, {
                    contentType: file.mimetype,
                });

            if (error) {
                console.error(`Supabase file upload error to bucket "${bucketName}" for path "${filePath}":`, error);
                return { error };
            }

            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(data.path);

            if (!publicUrlData || !publicUrlData.publicUrl) {
                 console.error(`Supabase getPublicUrl failed for path "${filePath}"`);
                 return { error: 'Failed to get public URL after upload.' };
            }

            return { publicUrl: publicUrlData.publicUrl };

        } catch (error) {
            console.error('Error in uploadFileToSupabase:', error);
            return { error: error.message };
        }
    }

    router.post('/post-job', authenticate, authorizeRoleMiddleware('company'), upload.single('companyLogo'), async (req, res) => {
         try {
        const userId = req.user.id;
        const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', userId).single();
        const userRole = profile ? profile.role : null;
        if (userRole !== 'company') {
             return res.status(403).json({ error: 'Forbidden: Only company accounts can post jobs.' });
        }

        const {
            companyName,
            websiteLink,
            jobTitle,
            positionType,
            experienceLevel,
            industry,
            jobDescription,
            responsibilities,
            locationType,
            locationInput,
            salaryCompensation,
            negotiable,
            howToApply,
            applicationDeadline,
            maxApplicants,
            notifyMe,
            requirements
        } = req.body;

        if (!companyName || !jobTitle || !jobDescription || !responsibilities || !locationType || !salaryCompensation || !requirements) {
             return res.status(400).json({ error: 'Missing required job details.' });
        }

        let companyLogoUrl = null;
        if (req.file) {
            const file = req.file;
            const fileExtension = path.extname(file.originalname);
            const uniqueFileName = `${uuidv4()}${fileExtension}`;
            const filePath = `${userId}/job_logos/${uniqueFileName}`;
            const { publicUrl, error: uploadError } = await uploadFileToSupabase(file, 'company_logos', filePath);

            if (uploadError) {
                console.error('Failed to upload company logo:', uploadError);
                return res.status(500).json({ error: 'Failed to upload company logo.' });
            }
            companyLogoUrl = publicUrl;
        }

        let parsedRequirements = [];
        try {
            parsedRequirements = JSON.parse(requirements);
            if (!Array.isArray(parsedRequirements)) {
                 parsedRequirements = [];
                 console.warn('Received requirements were not a valid array.');
            } else {
                parsedRequirements = parsedRequirements.filter(req =>
                     req && typeof req === 'object' && req.description && typeof req.required === 'boolean' && req.type && ['Text Input', 'File Upload'].includes(req.type)
                );
                 if (parsedRequirements.length !== JSON.parse(requirements).length) {
                     console.warn('Some requirements were filtered out due to invalid structure.');
                 }
            }
        } catch (parseError) {
            console.error('Failed to parse requirements JSON:', parseError);
            parsedRequirements = [];
        }

        const { data, error } = await supabase
            .from('jobs')
            .insert([
                {
                    user_id: userId,
                    company_name: companyName,
                    company_website: websiteLink,
                    company_logo_url: companyLogoUrl,
                    job_title: jobTitle,
                    position_type: positionType,
                    experience_level: experienceLevel,
                    industry: industry,
                    location_type: locationType,
                    location_input: locationInput,
                    salary_compensation: salaryCompensation,
                    negotiable: negotiable,
                    job_description: jobDescription,
                    responsibilities: responsibilities,
                    how_to_apply: howToApply,
                    application_deadline: applicationDeadline || null,
                    max_applicants: maxApplicants || null,
                    notify_me: notifyMe,
                    requirements: parsedRequirements
                },
            ])
            .select();

        if (error) {
            console.error('Supabase insert job error:', error);
            return res.status(500).json({ error: 'Failed to post job to database.' });
        }

        res.status(201).json({ message: 'Job posted successfully!', job: data[0] });

    } catch (error) {
        console.error('Error posting job:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
    });

    router.get('/', async (req, res) => {
        try {
        const { data: jobsData, error: fetchError } = await supabase
            .from('jobs')
            .select('id, user_id, company_name, company_website, company_logo_url, job_title, position_type, experience_level, industry, location_type, location_input, salary_compensation, negotiable, job_description, responsibilities, how_to_apply, application_deadline, max_applicants, notify_me, requirements, created_at, profiles(id, name, profile_picture_url)')
            .order('created_at', { ascending: false });

        if (fetchError) { // Corrected this from 'error' to 'fetchError'
            console.error('Supabase fetch jobs error:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch jobs.' });
        }

        const formattedJobs = jobsData.map(job => ({
            companyProfile: job.profiles ? { name: job.profiles.name, profilePictureUrl: job.profiles.profile_picture_url } : null,
            id: job.id,
            companyId: job.user_id,
            companyName: job.company_name,
            websiteLink: job.company_website,
            logoUrl: job.company_logo_url,
            jobTitle: job.job_title,
            positionType: job.position_type,
            experienceLevel: job.experience_level,
            industry: job.industry,
            locationType: job.location_type,
            location: job.location_input,
            salaryCompensation: job.salary_compensation,
            negotiable: job.negotiable,
            description: job.job_description,
            responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : (typeof job.responsibilities === 'string' ? job.responsibilities.split('\n').filter(line => line.trim() !== '') : []),
            howToApply: job.how_to_apply,
            applicationDeadline: job.application_deadline,
            maxApplicants: job.max_applicants,
            notifyMe: job.notify_me,
            requirements: Array.isArray(job.requirements) ? job.requirements : [],
            postedDate: job.created_at
        }));

        res.status(200).json(formattedJobs);

    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
    });

    router.post('/apply-job', authenticate, authorizeRoleMiddleware('talent'), upload.any(), async (req, res) => {
        try {
        const userId = req.user.id;
        const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', userId).single();
        const userRole = profile ? profile.role : null;
         if (userRole !== 'talent') {
              return res.status(403).json({ error: 'Forbidden: Only talent accounts can apply for jobs.' });
         }

        const { jobId } = req.body;

        if (!jobId) {
            return res.status(400).json({ error: 'Job ID is required for application.' });
        }

        const { data: jobData, error: jobError } = await supabase
            .from('jobs')
            .select('id, requirements')
            .eq('id', jobId)
            .single();

        if (jobError || !jobData) {
            console.error('Error fetching job for application:', jobError);
            return res.status(404).json({ error: 'Job not found or could not be retrieved.' });
        }

        const jobRequirements = Array.isArray(jobData.requirements) ? jobData.requirements : [];
         const requiredRequirements = jobRequirements.filter(req => req.required);

        const applicationContent = {};
        const uploadedFileUrls = {};

        for (const key in req.body) {
            const matchingRequirement = requiredRequirements.find(req =>
                req.type === 'Text Input' && `requirement_TextInput_${req.description}` === key
             );

            if (matchingRequirement) {
                 if (!req.body[key].trim()) {
                      return res.status(400).json({ error: `Required text input "${matchingRequirement.description}" is missing.` });
                 }
                applicationContent[matchingRequirement.description] = {
                    type: 'Text Input',
                    value: req.body[key].trim()
                };
            } else if (key === 'jobId') {
                continue;
            } else {
                console.warn(`Received unexpected form field in application: ${key}`);
            }
        }

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const matchingRequirement = requiredRequirements.find(req =>
                    req.type === 'File Upload' && `requirement_FileUpload_${req.description}` === file.fieldname
                 );

                if (matchingRequirement) {
                    const fileExtension = path.extname(file.originalname);
                    const uniqueFileName = `${uuidv4()}${fileExtension}`;
                    const filePath = `applications/${userId}/${jobId}/${uniqueFileName}`;
                    const { publicUrl, error: uploadError } = await uploadFileToSupabase(file, 'application_files', filePath);

                    if (uploadError) {
                         console.error('Failed to upload application file:', uploadError);
                         return res.status(500).json({ error: `Failed to upload file for requirement "${matchingRequirement.description}".` });
                    }

                    applicationContent[matchingRequirement.description] = {
                         type: 'File Upload',
                         value: publicUrl
                    };
                    uploadedFileUrls[matchingRequirement.description] = publicUrl;
                } else {
                     console.warn(`Received file for unexpected field in application: ${file.fieldname}`);
                }
            }
        }

         const missingRequirements = requiredRequirements.filter(req => !applicationContent.hasOwnProperty(req.description));

         if (missingRequirements.length > 0) {
             const missingDescriptions = missingRequirements.map(req => req.description).join(', ');
             return res.status(400).json({ error: `Missing required application information: ${missingDescriptions}.` });
         }

        const { data, error } = await supabase
            .from('applications')
 .insert([
                {
                    user_id: userId,
                    job_id: jobId,
                    type: 'application',
                    content: applicationContent,
                },
            ])
            .select();

        if (error) {
            console.error('Supabase insert application error:', error);
            return res.status(500).json({ error: 'Failed to submit application to database.' });
        }

        res.status(201).json({ message: 'Application submitted successfully!', application: data[0] });

    } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
    });

    router.get('/my-applications', authenticate, authorizeRoleMiddleware('talent'), async (req, res) => {
        try {
        const userId = req.user.id;

        const { data: applications, error: fetchError } = await supabase
            .from('applications')
            .select(`
 id:application_id,
                job_id,
                created_at,
                content,
                jobs (
                    id,
                    job_title,
                    company_name,
                    company_logo_url,
                    location_type,
                    location_input,
                    position_type
                )
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (fetchError) {
            console.error('Supabase fetch user applications error:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch user applications.' });
        }

        const formattedApplications = applications.map(app => {
            const job = app.jobs;
            return {
                id: app.id,
                jobId: app.job_id,
                applicationDate: app.created_at,
                status: 'Submitted',
                jobTitle: job ? job.job_title : 'Unknown Job',
                companyName: job ? job.company_name : 'Unknown Company',
                companyLogo: job ? job.company_logo_url : null,
                location: job ? `${job.location_type}: ${job.location_input}` : 'Unknown Location',
                positionType: job ? job.position_type : 'Unknown Type',
                applicationDetails: app.content || {}
            };
        });

        res.status(200).json(formattedApplications);

    } catch (error) {
        console.error('Error fetching user applications:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
    });

    return router; // Return the router for the main app to use
}
