/**
 * API Key management routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as apiKeyController from './apiKey.controller.js';
import { requireAuth } from '../../middleware/requireAuth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// CRUD operations
router.get('/', apiKeyController.listApiKeys);
router.post('/', apiKeyController.createApiKey);
router.get('/:id', apiKeyController.getApiKey);
router.patch('/:id', apiKeyController.updateApiKey);
router.delete('/:id', apiKeyController.deleteApiKey);

// Actions
router.post('/:id/regenerate', apiKeyController.regenerateApiKey);
router.post('/:id/revoke', apiKeyController.revokeApiKey);

export default router;
