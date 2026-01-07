/**
 * TikTok download controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { fetchTikTokData } from '../services/tiktok.service.js';
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

    const data = await fetchTikTokData(url);

    res.json({
      success: true,
      platform: 'tiktok',
      data,
    });
  } catch (error) {
    next(error);
  }
}
