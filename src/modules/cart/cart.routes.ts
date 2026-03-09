import { Router } from "express";
import { CartController } from "./cart.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { validate } from "../../core/middlewares/validate.js";
import { addToCartSchema, updateCartItemSchema } from "./cart.validation.js";

const router = Router();

// All cart routes require a logged-in user with the CUSTOMER role
router.use(requireAuth, requireRole(["CUSTOMER"]));

router.get("/", CartController.getCart);
router.post("/items", validate(addToCartSchema), CartController.addItem);
router.patch(
  "/items/:productId",
  validate(updateCartItemSchema),
  CartController.updateItem,
);
router.delete("/items/:productId", CartController.removeItem);
router.delete("/", CartController.clearCart);

export const cartRoutes = router;
