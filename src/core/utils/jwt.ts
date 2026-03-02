import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export interface TokenPayload {
  userId: string;
  role: string;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
  });
};

export const generateRefreshToken = (payload: { userId: string; sessionId: string }): string => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN,
  });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): { userId: string; sessionId: string } => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string; sessionId: string };
};
