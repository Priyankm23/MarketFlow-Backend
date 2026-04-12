import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { Prisma } from "../../../generated/prisma/index.js";

const PRODUCTS_CACHE_KEY = "products:catalog:v2";

export interface CreateProductData {
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: string | number;
  stock: string | number;
  warranty?: string;
  returnPolicy?: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePublicId?: string;
}

export class ProductService {
  private static mapProductWithRatings(
    product: any,
    options: { includeComments?: boolean } = {},
  ) {
    const summary = product.ratingSummary;
    const one = Number(summary?.oneStarCount ?? 0);
    const two = Number(summary?.twoStarCount ?? 0);
    const three = Number(summary?.threeStarCount ?? 0);
    const four = Number(summary?.fourStarCount ?? 0);
    const five = Number(summary?.fiveStarCount ?? 0);
    const total = one + two + three + four + five;

    const averageRating =
      total > 0
        ? Number(
            (
              (1 * one + 2 * two + 3 * three + 4 * four + 5 * five) /
              total
            ).toFixed(2),
          )
        : 0;

    const asStringArray = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }

      return [];
    };

    const commentsByStar = options.includeComments
      ? {
          oneStar: asStringArray(summary?.oneStarComments).length,
          twoStar: asStringArray(summary?.twoStarComments).length,
          threeStar: asStringArray(summary?.threeStarComments).length,
          fourStar: asStringArray(summary?.fourStarComments).length,
          fiveStar: asStringArray(summary?.fiveStarComments).length,
        }
      : undefined;

    const { ratingSummary: _ratingSummary, ...productWithoutSummary } = product;

    return {
      ...productWithoutSummary,
      averageRating,
      ratingBreakdown: {
        oneStarCount: one,
        twoStarCount: two,
        threeStarCount: three,
        fourStarCount: four,
        fiveStarCount: five,
      },
      ...(options.includeComments ? { commentsByStar } : {}),
    };
  }

  private static isMissingColumnError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2022"
    );
  }

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
        warranty: data.warranty?.trim() || undefined,
        returnPolicy: data.returnPolicy?.trim() || undefined,
        imageUrl: data.imageUrl,
        imageUrls: data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : []),
        imagePublicId: data.imagePublicId,
      },
    });

    await this.invalidateCache();

    return this.mapProductWithRatings(product);
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

    let products: any[] = [];
    let total = 0;

    try {
      [products, total] = await Promise.all([
        prisma.product.findMany({
          where: whereClause,
          include: {
            category: { select: { id: true, name: true } },
            vendor: { select: { businessName: true, id: true } },
            ratingSummary: true,
          },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.product.count({ where: whereClause }),
      ]);
    } catch (error) {
      if (!this.isMissingColumnError(error)) throw error;

      console.error(
        "Product query fallback activated due to schema drift (P2022). Run prisma migrate deploy on production.",
      );

      [products, total] = await Promise.all([
        prisma.product.findMany({
          where: whereClause,
          include: {
            category: { select: { id: true, name: true } },
            vendor: { select: { businessName: true, id: true } },
            ratingSummary: true,
            offers: {
              where: { isActive: true },
              take: 1,
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.product.count({ where: whereClause }),
      ]);
    }

    const result = {
      data: products.map((product) =>
        this.mapProductWithRatings(product, { includeComments: true }),
      ),
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
        ratingSummary: true,
        reviews: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        },
      },
    });

    if (!product) {
      throw new ApiError(404, "Product not found");
    }

    return this.mapProductWithRatings(product, { includeComments: true });
  }

  static async rateProduct(
    productId: string,
    userId: string,
    newRating: number,
    comment?: string,
    imageUrls?: string[],
  ) {
    const updatedProduct = await prisma.$transaction(async (tx: any) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new ApiError(404, "Product not found");
      }

      // Upsert a single user review per product to keep review history authoritative.
      await tx.productReview.upsert({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
        update: {
          rating: newRating,
          comment: comment?.trim() || null,
          imageUrls: Array.isArray(imageUrls) ? imageUrls : undefined,
        },
        create: {
          userId,
          productId,
          rating: newRating,
          comment: comment?.trim() || null,
          imageUrls: Array.isArray(imageUrls) ? imageUrls : undefined,
        },
      });

      const reviews = await tx.productReview.findMany({
        where: { productId },
        select: {
          rating: true,
          comment: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      const oneStarCount = reviews.filter(
        (review: any) => review.rating === 1,
      ).length;
      const twoStarCount = reviews.filter(
        (review: any) => review.rating === 2,
      ).length;
      const threeStarCount = reviews.filter(
        (review: any) => review.rating === 3,
      ).length;
      const fourStarCount = reviews.filter(
        (review: any) => review.rating === 4,
      ).length;
      const fiveStarCount = reviews.filter(
        (review: any) => review.rating === 5,
      ).length;

      const oneStarComments = reviews
        .filter((review: any) => review.rating === 1 && review.comment)
        .map((review: any) => review.comment);
      const twoStarComments = reviews
        .filter((review: any) => review.rating === 2 && review.comment)
        .map((review: any) => review.comment);
      const threeStarComments = reviews
        .filter((review: any) => review.rating === 3 && review.comment)
        .map((review: any) => review.comment);
      const fourStarComments = reviews
        .filter((review: any) => review.rating === 4 && review.comment)
        .map((review: any) => review.comment);
      const fiveStarComments = reviews
        .filter((review: any) => review.rating === 5 && review.comment)
        .map((review: any) => review.comment);

      await tx.productRatingSummary.upsert({
        where: { productId },
        update: {
          oneStarCount,
          twoStarCount,
          threeStarCount,
          fourStarCount,
          fiveStarCount,
          oneStarComments,
          twoStarComments,
          threeStarComments,
          fourStarComments,
          fiveStarComments,
        },
        create: {
          productId,
          oneStarCount,
          twoStarCount,
          threeStarCount,
          fourStarCount,
          fiveStarCount,
          oneStarComments,
          twoStarComments,
          threeStarComments,
          fourStarComments,
          fiveStarComments,
        },
      });

      const reviewCount = reviews.length;

      await tx.product.update({
        where: { id: productId },
        data: {
          reviewCount,
        },
      });

      return tx.product.findUnique({
        where: { id: productId },
        include: {
          ratingSummary: true,
          reviews: {
            include: {
              user: { select: { id: true, name: true } },
            },
            orderBy: { updatedAt: "desc" },
            take: 50,
          },
        },
      });
    });

    await this.invalidateCache();
    // Invalidate product's individual cache if we add it in the future

    return this.mapProductWithRatings(updatedProduct, {
      includeComments: true,
    });
  }

  static async getProductsByCategoryName(categoryName: string) {
    return prisma.product
      .findMany({
        where: {
          isActive: true,
          category: {
            name: {
              equals: categoryName,
              mode: "insensitive",
            },
          },
        },
        include: {
          category: { select: { id: true, name: true } },
          vendor: { select: { businessName: true, id: true } },
          ratingSummary: true,
        },
        orderBy: { createdAt: "desc" },
      })
      .then((products) =>
        products.map((product) => this.mapProductWithRatings(product)),
      );
  }

  static async getProductsByVendorId(
    vendorId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.ProductWhereInput = {
      vendorId,
      isActive: true,
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        include: {
          category: { select: { id: true, name: true } },
          vendor: { select: { businessName: true, id: true } },
          ratingSummary: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.count({ where: whereClause }),
    ]);

    return {
      data: products.map((product) => this.mapProductWithRatings(product)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getTrendingProduct(limit = 10) {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        reviewCount: { gt: 0 },
      },
      include: {
        category: { select: { id: true, name: true } },
        vendor: { select: { businessName: true, id: true } },
        ratingSummary: true,
      },
      take: Math.max(limit * 2, limit),
    });

    const ranked = products
      .map((product) => this.mapProductWithRatings(product))
      .filter((product) => product.averageRating > 3.5)
      .sort((a, b) => b.averageRating - a.averageRating)
      .slice(0, limit);

    return ranked;
  }

  static async getNewArrivalsProducts(limit = 20) {
    return prisma.product
      .findMany({
        where: {
          isActive: true,
          stock: { gt: 0 },
        },
        include: {
          category: { select: { id: true, name: true } },
          vendor: { select: { businessName: true, id: true } },
          ratingSummary: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      })
      .then((products) =>
        products.map((product) => this.mapProductWithRatings(product)),
      );
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
