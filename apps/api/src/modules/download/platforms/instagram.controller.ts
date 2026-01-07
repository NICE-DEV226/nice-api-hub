/**
 * Instagram download controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { createError } from '../../../middleware/errorHandler.js';

export async function download(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
      throw createError('Missing or invalid "url" query parameter', 400, 'MISSING_URL');
    }

    // TODO: Implement Instagram service
    res.json({
      success: true,
      platform: 'instagram',
      data: {
        message: 'Instagram download - implementation pending',
        url,
      },
    });
  } catch (error) {
    next(error);
  }
}
