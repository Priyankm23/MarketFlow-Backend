import { Request, Response } from "express";
import { ProductService } from "./product.service.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";

export class ProductController {
  static async createProduct(req: Request, res: Response) {
    let imageUrls: string[] = [];

    if (req.files && !Array.isArray(req.files)) {
      const productImages = req.files["images"] ?? [];
      const legacyImage = req.files["image"] ?? [];
      const filesToUpload = [...productImages, ...legacyImage];

      if (filesToUpload.length > 0) {
        imageUrls = await Promise.all(
          filesToUpload.map((file) =>
            uploadToCloudinary(file.buffer, "products"),
          ),
        );
      }
    }

    const setProductData = {
      ...req.body,
      imageUrl: imageUrls[0],
      imageUrls,
    };

    const product = await ProductService.createProduct(
      req.user!.userId,
      setProductData,
    );
    res.status(201).json({ status: "success", data: product });
  }

  static async getProducts(req: Request, res: Response) {
    const filters = {
      categoryName: req.query.categoryName as string,
      businessName: req.query.businessName as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined,
    };

    const products = await ProductService.getProducts(filters);
    res.status(200).json({ status: "success", ...products });
  }

  static async getProductsByCategoryName(req: Request, res: Response) {
    const rawCategoryName = Array.isArray(req.params.categoryName)
      ? req.params.categoryName[0]
      : req.params.categoryName;
    const categoryName = rawCategoryName?.trim();

    if (!categoryName) {
      res
        .status(400)
        .json({ status: "fail", message: "Category name is required" });
      return;
    }

    const products =
      await ProductService.getProductsByCategoryName(categoryName);
    res.status(200).json({
      status: "success",
      data: products,
      meta: {
        total: products.length,
        categoryName,
      },
    });
  }

  static async getTrendingProduct(req: Request, res: Response) {
    const trendingProducts = await ProductService.getTrendingProduct();
    res.status(200).json({
      status: "success",
      products: trendingProducts,
    });
  }

  static async getProductById(req: Request, res: Response) {
    const productId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!productId) {
      res
        .status(400)
        .json({ status: "fail", message: "Product ID is required" });
      return;
    }

    const product = await ProductService.getProductById(productId);
    res.status(200).json({ status: "success", data: product });
  }

  // --- Categories --- (Usually done via Admin routes, placing here for convenience)
  static async createCategory(req: Request, res: Response) {
    const category = await ProductService.createCategory(req.body.name);
    res.status(201).json({ status: "success", data: category });
  }

  static async getCategories(req: Request, res: Response) {
    const categories = await ProductService.getCategories();
    res.status(200).json({ status: "success", data: categories });
  }
}
