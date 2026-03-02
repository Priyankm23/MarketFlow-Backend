import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden: Insufficient permissions'));
    }
    next();
  };
};
