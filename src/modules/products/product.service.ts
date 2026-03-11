import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { Prisma } from "../../../generated/prisma/index.js";

const PRODUCTS_CACHE_KEY = "products:catalog";

export interface CreateProductData {
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: string | number;
  stock: string | number;
  imageUrl?: string;
  imagePublicId?: string;
}

export class ProductService {
  /**
   * Automatically clears cached product listings
   */
  private static async invalidateCache() {
    try {
      // Delete the root key or pattern. For pagination, sweeping by pattern is best
      const keys = await redis.keys(`${PRODUCTS_CACHE_KEY}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error("⚠️ Redis Cache Invalidation Failed:", error);
      // We don't want a cache failure to stop the user from getting a successful response
    }
  }

  static async createProduct(vendorUserId: string, data: CreateProductData) {
    // Need to verify if the user is an APPROVED vendor
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor || vendor.status !== "APPROVED") {
      throw new ApiError(403, "Only approved vendors can create products");
    }

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description,
        price: data.price,
        stock: parseInt(data.stock as string, 10),
        imageUrl: data.imageUrl,
        imagePublicId: data.imagePublicId,
      },
    });

    await this.invalidateCache();

    return product;
  }

  static async getProducts(filters: {
    categoryName?: string;
    businessName?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const cacheKey = `${PRODUCTS_CACHE_KEY}:${filters.categoryName || "all"}:${filters.businessName || "all"}:${page}:${limit}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const whereClause: Prisma.ProductWhereInput = {
      isActive: true,
    };

    if (filters.categoryName) {
      whereClause.category = {
        name: {
          equals: filters.categoryName,
          mode: "insensitive", // case-insensitive match (e.g., "electronics" matches "Electronics")
        },
      };
    }

    if (filters.businessName) {
      whereClause.vendor = {
        businessName: {
          equals: filters.businessName,
          mode: "insensitive",
        },
      };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        include: {
          category: { select: { id: true, name: true } },
          vendor: { select: { businessName: true, id: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.count({ where: whereClause }),
    ]);

    const result = {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    // Cache the result for 10 minutes (300 seconds)
    await redis.setex(cacheKey, 600, JSON.stringify(result));

    return result;
  }

  static async getProductById(productId: string) {
    // Individual products can also be cached, but let's just query DB to keep it simple and fresh
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        vendor: { select: { id: true, businessName: true } },
        category: true,
      },
    });

    if (!product) {
      throw new ApiError(404, "Product not found");
    }

    return product;
  }

  static async createCategory(name: string) {
    return prisma.category.create({
      data: { name },
    });
  }

  static async getCategories() {
    const cached = await redis.get("categories");
    if (cached) return JSON.parse(cached);

    const categories = await prisma.category.findMany();
    await redis.setex("categories", 3600, JSON.stringify(categories)); // cache 1 hour
    return categories;
  }
}
