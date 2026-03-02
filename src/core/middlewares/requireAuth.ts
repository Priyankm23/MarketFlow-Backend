import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Unauthorized: No token provided'));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new ApiError(401, 'Unauthorized: Token missing'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error) {
    return next(new ApiError(401, 'Unauthorized: Invalid or expired token'));
  }
};
