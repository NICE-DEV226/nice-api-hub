/**
 * Feedback Routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/requireAuth.js';
import {
  submitFeedback,
  getUserFeedbacks,
  getAllFeedbacks,
  updateFeedbackStatus,
  getFeedbackStats,
} from './feedback.controller.js';

const router = Router();

// User routes
router.post('/', requireAuth, submitFeedback);
router.get('/me', requireAuth, getUserFeedbacks);

// Admin routes
router.get('/admin', requireAuth, requireAdmin, getAllFeedbacks);
router.get('/admin/stats', requireAuth, requireAdmin, getFeedbackStats);
router.patch('/admin/:id', requireAuth, requireAdmin, updateFeedbackStatus);

export default router;
