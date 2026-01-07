/**
 * Authentication routes (Google OAuth)
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as authController from './auth.controller.js';

const router = Router();

// Google OAuth
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);

// Session management
router.get('/me', authController.getCurrentUser);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refreshToken);

export default router;
