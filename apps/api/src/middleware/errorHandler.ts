/**
 * Global error handler middleware
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // Log error
  logger.error(`[${statusCode}] ${err.message}`, {
    stack: err.stack,
    code: err.code,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message: isProduction && statusCode === 500 
        ? 'Internal Server Error' 
        : err.message,
      code: err.code || 'INTERNAL_ERROR',
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

/**
 * Create an operational error
 */
export function createError(
  message: string,
  statusCode: number = 500,
  code?: string
): ApiError {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.isOperational = true;
  return error;
}
