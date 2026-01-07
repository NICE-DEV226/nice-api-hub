/**
 * User routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as userController from './user.controller.js';
import { requireAuth, requireAuthAllowSuspended } from '../../middleware/requireAuth.js';

const router = Router();

// Status check (allows suspended users to check their status)
router.get('/status', requireAuthAllowSuspended, userController.checkAccountStatus);

// All other routes require active account
router.use(requireAuth);

// Profile
router.get('/profile', userController.getProfile);
router.patch('/profile', userController.updateProfile);

// Usage stats
router.get('/usage', userController.getUsageStats);
router.get('/usage/history', userController.getUsageHistory);

export default router;
