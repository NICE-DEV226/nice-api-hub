/**
 * Admin routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as adminController from './admin.controller.js';
import * as adminAuthController from './adminAuth.controller.js';
import { requireAuth, requireAdmin, requireAdminSession } from '../../middleware/requireAuth.js';

const router = Router();

// ==================== PIN Authentication Routes ====================
// These routes require auth + admin role but NOT admin session
router.get('/pin/status', requireAuth, requireAdmin, adminAuthController.checkAdminPinStatus);
router.post('/pin/setup', requireAuth, requireAdmin, adminAuthController.setupAdminPin);
router.post('/pin/verify', requireAuth, requireAdmin, adminAuthController.verifyAdminPin);
router.post('/pin/reset', requireAuth, requireAdmin, adminAuthController.resetAdminPin);

// ==================== Protected Admin Routes ====================
// All routes below require auth + admin role + valid admin session
router.use(requireAuth);
router.use(requireAdmin);
router.use(requireAdminSession);

// Dashboard overview
router.get('/dashboard', adminController.getDashboard);

// Users management
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/suspend', adminController.suspendUser);
router.post('/users/:id/activate', adminController.activateUser);

// Plan change history
router.get('/plan-history', adminController.getPlanChangeHistory);

// Analytics
router.get('/analytics/overview', adminController.getAnalyticsOverview);
router.get('/analytics/usage', adminController.getUsageAnalytics);
router.get('/analytics/platforms', adminController.getPlatformAnalytics);
router.get('/analytics/geographic', adminController.getGeographicAnalytics);

// Monitoring
router.get('/monitoring/latency', adminController.getLatencyMetrics);
router.get('/monitoring/health', adminController.getApiHealth);
router.get('/monitoring/health/detailed', adminController.getDetailedHealth);
router.post('/monitoring/health/:platform/maintenance', adminController.setPlatformMaintenance);
router.post('/monitoring/health/:platform/reset', adminController.resetPlatformHealth);
router.get('/monitoring/errors', adminController.getErrorMetrics);

// Logs
router.get('/logs', adminController.getLogs);
router.get('/logs/realtime', adminController.getRealtimeLogs);

// Subscriptions
router.get('/subscriptions', adminController.getSubscriptions);
router.get('/subscriptions/stats', adminController.getSubscriptionStats);

export default router;
