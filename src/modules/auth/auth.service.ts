import { prisma } from '../../db/prisma.js';
import { ApiError } from '../../core/errors/ApiError.js';
import { hashPassword, comparePassword } from '../../core/utils/password.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../core/utils/jwt.js';
import { RegisterInput, LoginInput } from './auth.types.js';
import { env } from '../../config/env.js';

// MS dependency mapping logic for calculating expiresAt simply
const msToNum = (val: string): number => {
  if (val.endsWith('m')) return parseInt(val) * 60 * 1000;
  if (val.endsWith('h')) return parseInt(val) * 60 * 60 * 1000;
  if (val.endsWith('d')) return parseInt(val) * 24 * 60 * 60 * 1000;
  return parseInt(val);
};

export class AuthService {
  static async register(data: RegisterInput) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ApiError(409, 'Email already in use');
    }

    const hashedPassword = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash: hashedPassword,
        name: data.name,
        role: data.role,
      },
    });

    return this.createSessionAndTokens(user.id, user.role);
  }

  static async login(data: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const isMatch = await comparePassword(data.password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid credentials');
    }

    if (!user.isActive) {
      throw new ApiError(403, 'Account is inactive or banned');
    }

    return this.createSessionAndTokens(user.id, user.role);
  }

  static async refreshToken(token: string) {
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch (e) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || session.refreshToken !== token) {
      throw new ApiError(401, 'Session invalid or intercepted');
    }

    if (session.isRevoked) {
      // Possible replay attack, revoke ALL user sessions
      await prisma.session.updateMany({
        where: { userId: session.userId },
        data: { isRevoked: true },
      });
      throw new ApiError(401, 'Token reuse detected. All sessions revoked for security.');
    }

    if (new Date() > session.expiresAt) {
      throw new ApiError(401, 'Refresh token expired');
    }

    // Rotate: Revoke the old token and create a new session
    await prisma.session.update({
      where: { id: session.id },
      data: { isRevoked: true },
    });

    return this.createSessionAndTokens(session.userId, session.user.role);
  }

  static async logout(token: string) {
    try {
      const payload = verifyRefreshToken(token);
      await prisma.session.update({
        where: { id: payload.sessionId },
        data: { isRevoked: true },
      });
    } catch (e) {
      // If the token is invalid, they are effectively logged out anyway
    }
  }

  private static async createSessionAndTokens(userId: string, role: string) {
    const accessToken = generateAccessToken({ userId, role });
    
    // Create new session entity FIRST without token to get session ID
    const session = await prisma.session.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + msToNum(env.REFRESH_TOKEN_EXPIRES_IN)),
        refreshToken: '', // Placeholder
      },
    });

    const refreshToken = generateRefreshToken({ userId, sessionId: session.id });

    // Update session with the real token
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: userId,
        role,
      }
    };
  }
}
