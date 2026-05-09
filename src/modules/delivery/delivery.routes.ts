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
  "/dashboard",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getDashboard,
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

deliveryRoutes.get(
  "/current",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getCurrentDeliveries,
);

deliveryRoutes.get(
  "/deliveries/today",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.getDeliveredToday,
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

// vendor trigger for assignment (optional, for testing)
deliveryRoutes.post(
  "/orders/:orderId/assign",
  requireAuth,
  requireRole(["VENDOR"]),
  DeliveryController.triggerAssignment,
);

deliveryRoutes.post(
  "/orders/:orderId/pickup-otp",
  requireAuth,
  requireRole(["VENDOR"]),
  DeliveryController.generatePickupOtp,
);

deliveryRoutes.post(
  "/orders/:orderId/pickup-otp/verify",
  requireAuth,
  requireRole(["DELIVERY_PARTNER"]),
  DeliveryController.verifyPickupOtp,
);
