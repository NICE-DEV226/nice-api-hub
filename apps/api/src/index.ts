/**
 * NICE-API'HUB - API Server Entry Point
 * Author: NICE-DEV
 */

import app from './app.js';
import { logger } from './utils/logger.js';
import { initSubscriptionChecker } from './services/subscriptionManager.service.js';

const PORT = process.env.PORT || 3001;
const isVercel = process.env.VERCEL === '1';

// For Vercel serverless, export the app directly
if (isVercel) {
  logger.info('🚀 Running in Vercel serverless mode');
} else {
  // Traditional server mode
  const server = app.listen(PORT, () => {
    logger.info(`🚀 NICE-API'HUB API running on port ${PORT}`);
    logger.info(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Initialize background services only in non-serverless mode
    initSubscriptionChecker();
  });

  // Graceful shutdown
  const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Export for Vercel
export default app;
