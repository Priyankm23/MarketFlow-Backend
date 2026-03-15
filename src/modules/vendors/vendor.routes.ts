import { Router } from "express";
import { VendorController } from "./vendor.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { upload } from "../../core/middlewares/upload.js";
import { validate } from "../../core/middlewares/validate.js";
import { registerVendorBaseSchema } from "./vendor.validation.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/register",
  requireRole(["VENDOR"]),
  upload.fields([
    { name: "govId", maxCount: 1 },
    { name: "businessDoc", maxCount: 1 },
  ]),
  validate(registerVendorBaseSchema),
  VendorController.register,
);
router.get("/profile", VendorController.getProfile);

export default router;
