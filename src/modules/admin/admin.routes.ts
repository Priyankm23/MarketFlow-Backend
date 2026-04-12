import { Router } from "express";
import { AdminController } from "./admin.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { validate } from "../../core/middlewares/validate.js";
import { reviewVendorSchema } from "./admin.validation.js";

const router = Router();

router.use(requireAuth, requireRole(["ADMIN"]));

router.get("/vendors/pending", AdminController.getPendingVendors);
router.get("/vendors/approved", AdminController.getApprovedVendors);
router.get("/analytics", AdminController.getAnalytics);
router.patch(
  "/vendors/:vendorId/review",
  validate(reviewVendorSchema),
  AdminController.reviewVendor,
);

export default router;
