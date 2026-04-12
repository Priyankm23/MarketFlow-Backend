import { Router } from "express";
import FlashDealsController from "./flashDeals.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";

const router = Router();

// Public endpoint used on homepage to fetch active flash deals
router.get("/", FlashDealsController.getActive);

// Public endpoint to fetch active non-flash offers for a specific product
router.get(
  "/non-flash/product/:productId",
  FlashDealsController.getNonFlashByProduct,
);

// Vendor creates a flash deal (may be auto-approved or PENDING)
router.post(
  "/",
  requireAuth,
  requireRole(["VENDOR"]),
  FlashDealsController.create,
);

// Vendor creates non-flash offers (up to 14 days)
router.post(
  "/non-flash",
  requireAuth,
  requireRole(["VENDOR"]),
  FlashDealsController.createNonFlash,
);

// Admin endpoints to review and moderate flash deals
router.get(
  "/pending",
  requireAuth,
  requireRole(["ADMIN"]),
  FlashDealsController.listPending,
);
router.post(
  "/:id/approve",
  requireAuth,
  requireRole(["ADMIN"]),
  FlashDealsController.approve,
);
router.post(
  "/:id/reject",
  requireAuth,
  requireRole(["ADMIN"]),
  FlashDealsController.reject,
);

export default router;
