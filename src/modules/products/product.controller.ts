import { Request, Response } from "express";
import { ProductService } from "./product.service.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";

export class ProductController {
  static async createProduct(req: Request, res: Response) {
    let imageUrl: string | undefined = undefined;

    // Handle optional image upload
    if (req.file) {
      // Stream buffer to Cloudinary
      imageUrl = await uploadToCloudinary(req.file.buffer, "products");
    }

    const setProductData = {
      ...req.body,
      imageUrl,
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

  static async getProductById(req: Request, res: Response) {
    const product = await ProductService.getProductById(req.params.id);
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
