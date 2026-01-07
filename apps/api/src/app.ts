/**
 * NICE-API'HUB - Express Application
 * Author: NICE-DEV
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import passport from 'passport';

// Config
import { configurePassport } from './config/passport.js';

// Routes
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/user/user.routes.js';
import apiKeyRoutes from './modules/api-keys/apiKey.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import feedbackRoutes from './modules/feedback/feedback.routes.js';
import ratingRoutes from './modules/rating/rating.routes.js';
import announcementRoutes from './modules/announcement/announcement.routes.js';
import statusRoutes from './modules/status/status.routes.js';
import paymentRoutes from './modules/payment/payment.routes.js';

// Download API routes
import downloadRoutes from './modules/download/download.routes.js';

// Middleware
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { latencyTracker } from './middleware/latencyTracker.js';
import { apiUsageLogger, captureErrorDetails } from './middleware/apiUsageLogger.js';

// Utils
import { logger } from './utils/logger.js';

const app: Express = express();

// Configure Passport
configurePassport();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport initialization
app.use(passport.initialize());

// Logging
app.use(morgan('combined', {
  stream: { write: (message: string) => logger.http(message.trim()) }
}));

// JSON formatting
app.set('json spaces', 2);

// Latency tracking for all requests
app.use(latencyTracker);

// API usage logging (for /api/* routes)
app.use(apiUsageLogger);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'NICE-API\'HUB'
  });
});

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    name: "NICE-API'HUB",
    version: '1.0.0',
    author: 'NICE-DEV',
    description: 'Universal Media Downloader API Platform',
    documentation: '/docs',
    endpoints: {
      auth: '/auth',
      user: '/user',
      apiKeys: '/api-keys',
      admin: '/admin',
      download: '/api'
    }
  });
});

// Auth routes (Google OAuth)
app.use('/auth', authRoutes);

// User routes (profile, settings)
app.use('/user', userRoutes);

// API Key management
app.use('/api-keys', apiKeyRoutes);

// Admin routes
app.use('/admin', adminRoutes);

// Feedback routes
app.use('/feedback', feedbackRoutes);

// Rating routes
app.use('/ratings', ratingRoutes);

// Announcement routes
app.use('/announcements', announcementRoutes);

// Public status page
app.use('/status', statusRoutes);

// Payment routes
app.use('/payments', paymentRoutes);

// Download API routes (the core functionality)
// API Key authentication is applied inside download.routes.ts
app.use('/api', downloadRoutes);

// Error handling
app.use(captureErrorDetails);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
