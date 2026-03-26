import { Router } from "express";
import { VendorController } from "./vendor.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";
import { requireRole } from "../../core/middlewares/requireRole.js";
import { upload } from "../../core/middlewares/upload.js";
import { validate } from "../../core/middlewares/validate.js";
import {
  addVendorProductImagesSchema,
  createVendorProductOfferSchema,
  getVendorProductOffersSchema,
  registerVendorBaseSchema,
  updateVendorProductDetailsSchema,
  updateVendorProductStockSchema,
} from "./vendor.validation.js";

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

router.post(
  "/products/:productId/stock",
  requireRole(["VENDOR"]),
  validate(updateVendorProductStockSchema),
  VendorController.updateProductStock,
);

router.post(
  "/products/:productId/update",
  requireRole(["VENDOR"]),
  validate(updateVendorProductDetailsSchema),
  VendorController.updateProductDetails,
);

router.post(
  "/products/:productId/images",
  requireRole(["VENDOR"]),
  upload.fields([
    { name: "images", maxCount: 8 },
    { name: "image", maxCount: 1 },
  ]),
  validate(addVendorProductImagesSchema),
  VendorController.addProductImages,
);

router.post(
  "/products/:productId/offers",
  requireRole(["VENDOR"]),
  validate(createVendorProductOfferSchema),
  VendorController.createProductOffer,
);

router.get(
  "/products/:productId/offers",
  requireRole(["VENDOR"]),
  validate(getVendorProductOffersSchema),
  VendorController.getProductOffers,
);

router.get("/profile", VendorController.getProfile);

router.post(
  "/profile/logo",
  requireRole(["VENDOR"]),
  upload.single("logo"),
  VendorController.updateLogo,
);

export default router;
