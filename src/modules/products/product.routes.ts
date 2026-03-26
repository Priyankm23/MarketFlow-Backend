import { Router } from "express";
import { ProductController } from "./product.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { upload } from "../../core/middlewares/upload.js";
import { validate } from "../../core/middlewares/validate.js";
import { createProductSchema, rateProductSchema } from "./product.validation.js";

const router = Router();

// --- Categories ---
// Note: We might want only ADMIN to create categories, we will add that constraint.
router.post(
  "/categories",
  requireAuth,
  requireRole(["ADMIN"]),
  // Simple inline validation for category, or add to validation file if it grows
  ProductController.createCategory,
);

router.get("/categories", ProductController.getCategories);

// --- Products ---

// Public endpoints to browse products (Cached via Redis)
router.get("/trending", ProductController.getTrendingProduct);

router.get("/", ProductController.getProducts);
router.get(
  "/category/:categoryName",
  ProductController.getProductsByCategoryName,
);
router.get("/:id", ProductController.getProductById);

router.post(
  "/:id/rate",
  requireAuth,
  validate(rateProductSchema),
  ProductController.rateProduct
);

// Protected endpoints for vendors
// Only VENDORs can create products
router.post(
  "/",
  requireAuth,
  requireRole(["VENDOR"]),
  upload.fields([
    { name: "images", maxCount: 8 },
    { name: "image", maxCount: 1 },
  ]), // `images` supports multi-upload; `image` keeps legacy clients working
  validate(createProductSchema),
  ProductController.createProduct,
);

export default router;
