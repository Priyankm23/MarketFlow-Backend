import { z } from "zod";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
} from "./auth.validation.js";

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
