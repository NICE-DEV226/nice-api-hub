/**
 * Public Status Routes
 * Author: NICE-DEV
 */

import { Router } from 'express';
import * as statusController from './status.controller.js';

const router = Router();

// Public endpoints - no auth required
router.get('/', statusController.getPublicStatus);
router.get('/:platform', statusController.getPlatformStatus);

export default router;
