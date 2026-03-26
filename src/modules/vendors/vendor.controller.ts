import { Request, Response } from "express";
import { VendorService } from "./vendor.service.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";

export class VendorController {
  static async register(req: Request, res: Response) {
    if (
      !req.files ||
      Array.isArray(req.files) ||
      !req.files["govId"] ||
      !req.files["businessDoc"]
    ) {
      throw new ApiError(
        400,
        "Both 'govId' and 'businessDoc' files are required.",
      );
    }
    console.log(req.files);
    const govIdFile = req.files["govId"][0];
    const businessDocFile = req.files["businessDoc"][0];

    if (!govIdFile || !businessDocFile) {
      throw new ApiError(
        400,
        "Both 'govId' and 'businessDoc' files are required.",
      );
    }

    // Upload parallel for performance
    const [govIdUrl, businessDocUrl] = await Promise.all([
      uploadToCloudinary(govIdFile.buffer, "vendor_docs"),
      uploadToCloudinary(businessDocFile.buffer, "vendor_docs"),
    ]);

    const vendorData = {
      ...req.body,
      govIdUrl,
      businessDocUrl,
    };

    const vendor = await VendorService.registerVendor(
      req.user!.userId,
      vendorData,
    );
    res.status(201).json({ status: "success", data: vendor });
  }

  static async getProfile(req: Request, res: Response) {
    const vendor = await VendorService.getVendorProfile(req.user!.userId);
    res.status(200).json({ status: "success", data: vendor });
  }

  static async updateLogo(req: Request, res: Response) {
    if (!req.file) {
      throw new ApiError(400, "Logo image file is required");
    }

    if (!req.file.mimetype.startsWith("image/")) {
      throw new ApiError(400, "Only image files are allowed");
    }

    const vendor = await VendorService.updateLogo(
      req.user!.userId,
      req.file.buffer,
    );

    res.status(200).json({ status: "success", data: vendor });
  }

  static async updateProductStock(req: Request, res: Response) {
    const rawProductId = req.params.productId;
    const productId = Array.isArray(rawProductId)
      ? rawProductId[0]
      : rawProductId;

    if (!productId) {
      throw new ApiError(400, "Product ID is required");
    }

    const product = await VendorService.updateProductStock(req.user!.userId, {
      productId,
      action: req.body.action,
      quantity: req.body.quantity,
    });

    res.status(200).json({ status: "success", data: product });
  }

  static async updateProductDetails(req: Request, res: Response) {
    const rawProductId = req.params.productId;
    const productId = Array.isArray(rawProductId)
      ? rawProductId[0]
      : rawProductId;

    if (!productId) {
      throw new ApiError(400, "Product ID is required");
    }

    const product = await VendorService.updateProductDetails(
      req.user!.userId,
      productId,
      {
        name: req.body.name,
        description: req.body.description,
        price: req.body.price,
      },
    );

    res.status(200).json({ status: "success", data: product });
  }

  static async addProductImages(req: Request, res: Response) {
    const rawProductId = req.params.productId;
    const productId = Array.isArray(rawProductId)
      ? rawProductId[0]
      : rawProductId;

    if (!productId) {
      throw new ApiError(400, "Product ID is required");
    }

    if (!req.files || Array.isArray(req.files)) {
      throw new ApiError(400, "At least one image file is required");
    }

    const files = [
      ...(req.files["images"] ?? []),
      ...(req.files["image"] ?? []),
    ];

    if (files.length === 0) {
      throw new ApiError(400, "At least one image file is required");
    }

    const hasNonImageFile = files.some(
      (file) => !file.mimetype.startsWith("image/"),
    );
    if (hasNonImageFile) {
      throw new ApiError(400, "Only image files are allowed");
    }

    let payload: Express.Multer.File | Express.Multer.File[];
    if (files.length === 1) {
      const [singleFile] = files;
      if (!singleFile) {
        throw new ApiError(400, "At least one image file is required");
      }
      payload = singleFile;
    } else {
      payload = files;
    }

    const product = await VendorService.addProductImages(
      req.user!.userId,
      productId,
      payload,
    );

    res.status(200).json({ status: "success", data: product });
  }

  static async createProductOffer(req: Request, res: Response) {
    const rawProductId = req.params.productId;
    const productId = Array.isArray(rawProductId)
      ? rawProductId[0]
      : rawProductId;

    if (!productId) {
      throw new ApiError(400, "Product ID is required");
    }

    const offer = await VendorService.createProductOffer(
      req.user!.userId,
      productId,
      {
        offerName: req.body.offerName,
        discountPercentage: req.body.discountPercentage,
        couponCode: req.body.couponCode,
        termsAndConditions: req.body.termsAndConditions,
        isActive: req.body.isActive,
      },
    );

    res.status(201).json({ status: "success", data: offer });
  }

  static async getProductOffers(req: Request, res: Response) {
    const rawProductId = req.params.productId;
    const productId = Array.isArray(rawProductId)
      ? rawProductId[0]
      : rawProductId;

    if (!productId) {
      throw new ApiError(400, "Product ID is required");
    }

    const offers = await VendorService.getProductOffers(
      req.user!.userId,
      productId,
    );

    res.status(200).json({ status: "success", data: offers });
  }
}
