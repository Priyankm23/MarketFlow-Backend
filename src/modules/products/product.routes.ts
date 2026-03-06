import { Router } from "express";
import { ProductController } from "./product.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { upload } from "../../core/middlewares/upload.js";
import { validate } from "../../core/middlewares/validate.js";
import { createProductSchema } from "./product.validation.js";

const router = Router();

// --- Categories ---
// Note: We might want only ADMIN to create categories, we will add that constraint.
router.post(
  "/categories",
  requireAuth,
  requireRole(["ADMIN"]),
  // Simple inline validation for category, or add to validation file if it grows
  ProductController.createCategory
);

router.get("/categories", ProductController.getCategories);

// --- Products --- 

// Public endpoints to browse products (Cached via Redis)
router.get("/", ProductController.getProducts);
router.get("/:id", ProductController.getProductById);

// Protected endpoints for vendors
// Only VENDORs can create products
router.post(
  "/",
  requireAuth,
  requireRole(["VENDOR"]),
  upload.single("image"), // Expected name attribute in multipart form data
  validate(createProductSchema),
  ProductController.createProduct
);

export default router;
