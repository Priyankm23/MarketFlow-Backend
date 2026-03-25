import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { validate } from "../../core/middlewares/validate.js";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  authenticateSchema,
} from "./auth.validation.js";

const router = Router();

router.post("/register", validate(registerSchema), AuthController.register);
router.post("/login", validate(loginSchema), AuthController.login);
router.post(
  "/refresh",
  validate(refreshTokenSchema),
  AuthController.refreshToken,
);
router.post("/logout", AuthController.logout);

export default router;
