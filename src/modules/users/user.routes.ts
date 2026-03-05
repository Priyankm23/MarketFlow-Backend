import { Router } from "express";
import { UserController } from "./user.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { validate } from "../../core/middlewares/validate.js";
import { updateProfileSchema } from "./user.validation.js";

const router = Router();

router.use(requireAuth);

router.get("/profile", UserController.getProfile);
router.put("/profile", validate(updateProfileSchema), UserController.updateProfile);

export default router;
