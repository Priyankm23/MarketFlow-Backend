import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { env } from '../../config/env.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (Should match REFRESH_TOKEN_EXPIRES_IN)
};

export class AuthController {
  static async register(req: Request, res: Response) {
    const { accessToken, refreshToken, user } = await AuthService.register(req.body);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.status(201).json({
      status: 'success',
      data: {
        accessToken,
        user,
      },
    });
  }

  static async login(req: Request, res: Response) {
    const { accessToken, refreshToken, user } = await AuthService.login(req.body);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.status(200).json({
      status: 'success',
      data: {
        accessToken,
        user,
      },
    });
  }

  static async refreshToken(req: Request, res: Response) {
    const incomingToken = req.cookies.refreshToken;
    const { accessToken, refreshToken, user } = await AuthService.refreshToken(incomingToken);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.status(200).json({
      status: 'success',
      data: {
        accessToken,
        user,
      },
    });
  }

  static async logout(req: Request, res: Response) {
    const token = req.cookies.refreshToken;
    if (token) {
      await AuthService.logout(token);
    }
    res.clearCookie('refreshToken');
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  }
}
