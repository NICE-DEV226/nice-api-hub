/**
 * Rating Routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/requireAuth.js';
import {
  submitRating,
  getUserRating,
  getPublicRatings,
  getAllRatings,
  moderateRating,
  deleteRating,
} from './rating.controller.js';

const router = Router();

// Public route (no auth)
router.get('/public', getPublicRatings);

// User routes
router.post('/', requireAuth, submitRating);
router.get('/me', requireAuth, getUserRating);

// Admin routes
router.get('/admin', requireAuth, requireAdmin, getAllRatings);
router.patch('/admin/:id', requireAuth, requireAdmin, moderateRating);
router.delete('/admin/:id', requireAuth, requireAdmin, deleteRating);

export default router;
