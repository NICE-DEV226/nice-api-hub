/**
 * Announcement Routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as announcementController from './announcement.controller.js';
import { requireAuth, requireAdminSession } from '../../middleware/requireAuth.js';

const router = Router();

// Public route - get active announcements
router.get('/active', announcementController.getActiveAnnouncements);

// Admin routes (require admin session)
router.use(requireAuth);
router.use(requireAdminSession);

router.get('/', announcementController.getAllAnnouncements);
router.post('/', announcementController.createAnnouncement);
router.patch('/:id', announcementController.updateAnnouncement);
router.post('/:id/toggle', announcementController.toggleAnnouncement);
router.delete('/:id', announcementController.deleteAnnouncement);

export default router;
