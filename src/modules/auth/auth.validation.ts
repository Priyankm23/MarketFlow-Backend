import { z } from "zod";
import { Role } from "../../../generated/prisma/index.js";

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(2),
    role: z.nativeEnum(Role).optional().default(Role.CUSTOMER),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});

export const refreshTokenSchema = z.object({
  cookies: z.object({
    refreshToken: z.string().min(1, "Refresh token missing"),
  }),
});
