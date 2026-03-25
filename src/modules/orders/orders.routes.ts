import { Router } from "express";
import { OrderController } from "./orders.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { validate } from "../../core/middlewares/validate.js";
import {
  checkoutSchema,
  updateOrderStatusSchema,
  vendorMarkReadySchema,
} from "./orders.validation.js";

const router = Router();

router.use(requireAuth);

// --- Customer Routes ---
router.post(
  "/checkout",
  requireRole(["CUSTOMER"]),
  validate(checkoutSchema),
  OrderController.checkout,
);

router.get(
  "/my-orders",
  requireRole(["CUSTOMER"]),
  OrderController.getMyOrders,
);

router.get(
  "/my-orders/last-shipping-address",
  requireRole(["CUSTOMER"]),
  OrderController.getLastShippingAddress,
);

// --- Vendor Routes ---
router.get(
  "/vendor-orders",
  requireRole(["VENDOR"]),
  OrderController.getVendorOrders,
);

router.post(
  "/:orderId/ready-for-delivery",
  requireRole(["VENDOR"]),
  validate(vendorMarkReadySchema),
  OrderController.markReadyForDelivery,
);

// --- Shared (Customer & Vendor) ---
router.get(
  "/:id",
  requireRole(["CUSTOMER", "VENDOR", "ADMIN"]),
  OrderController.getOrderDetails,
);

// --- Status Updates ---
router.patch(
  "/:orderId/status",
  requireRole(["VENDOR", "ADMIN", "DELIVERY_PARTNER"]), // Admins and Vendors can update status for now
  validate(updateOrderStatusSchema),
  OrderController.updateOrderStatus,
);

export const orderRoutes = router;
