import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { env } from "../../config/env.js";
import { emailQueue } from "../../jobs/queues/queue.js";
import { logger } from "../../core/utils/logger.js";

const authLogger = logger.child({ component: "auth-controller" });

const getCookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  expires: expiresAt,
});

export class AuthController {
  static async register(req: Request, res: Response) {
    const { accessToken, refreshToken, sessionExpiresAt, user } =
      await AuthService.register(req.body);

    const job = await emailQueue.add("welcome-email", {
      name: req.body.name,
      email: req.body.email,
      userId: user.id,
    });

    authLogger.info({ jobId: job.id, userId: user.id }, "Welcome email queued");

    res.cookie(
      "refreshToken",
      refreshToken,
      getCookieOptions(sessionExpiresAt),
    );
    res.status(201).json({
      status: "success",
      data: {
        accessToken,
        user,
      },
    });
  }

  static async login(req: Request, res: Response) {
    const { accessToken, refreshToken, sessionExpiresAt, user } =
      await AuthService.login(req.body);

    res.cookie(
      "refreshToken",
      refreshToken,
      getCookieOptions(sessionExpiresAt),
    );
    res.status(200).json({
      status: "success",
      data: {
        accessToken,
        user,
      },
    });
  }

  static async refreshToken(req: Request, res: Response) {
    const incomingToken = req.cookies.refreshToken;
    if (!incomingToken) {
      res
        .status(401)
        .json({ status: "error", message: "No refresh token provided" });
      return;
    }

    const { accessToken, refreshToken, sessionExpiresAt, user } =
      await AuthService.refreshToken(incomingToken);

    res.cookie(
      "refreshToken",
      refreshToken,
      getCookieOptions(sessionExpiresAt),
    );
    res.status(200).json({
      status: "success",
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
    res.clearCookie("refreshToken");
    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  }
}
