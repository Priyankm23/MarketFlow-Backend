import { Router } from "express";
import { DeliveryController } from "./delivery.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";

export const deliveryRoutes = Router();

deliveryRoutes.get(
  "/profile",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getProfile,
);

deliveryRoutes.get(
  "/coverage-pincodes",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getCoveragePincodes,
);

// Partners can update their coverage areas and capacity
deliveryRoutes.post(
  "/profile",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.updateProfile,
);

deliveryRoutes.get(
  "/tasks/assigned",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getAssignedTasks,
);

deliveryRoutes.post(
  "/orders/:orderId/respond",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.respondToAssignment,
);

// Partners can mark an order as delivered
deliveryRoutes.post(
  "/orders/:orderId/complete",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.markDelivered,
);

// Admin trigger for assignment (optional, for testing)
deliveryRoutes.post(
  "/orders/:orderId/assign",
  requireAuth,
  requireRole(["VENDOR"]),
  DeliveryController.triggerAssignment,
);
