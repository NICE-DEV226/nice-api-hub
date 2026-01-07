/**
 * YouTube download controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { fetchYouTubeData } from '../services/youtube.service.js';
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

    const data = await fetchYouTubeData(url);

    res.json({
      success: true,
      platform: 'youtube',
      data,
    });
  } catch (error) {
    next(error);
  }
}
