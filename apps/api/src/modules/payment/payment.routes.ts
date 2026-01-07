/**
 * Payment Routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as paymentController from './payment.controller.js';
import { requireAuth } from '../../middleware/requireAuth.js';

const router = Router();

// Public routes
router.get('/plans', paymentController.getPlans);
router.post('/webhook', paymentController.handleWebhook);

// Protected routes
router.post('/initiate', requireAuth, paymentController.initiatePayment);
router.get('/subscription', requireAuth, paymentController.getSubscriptionStatus);
router.post('/subscription/cancel', requireAuth, paymentController.cancelSubscription);
router.get('/verify/:reference', requireAuth, paymentController.verifyPayment);

export default router;
