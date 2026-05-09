import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";
import { Prisma, OrderStatus } from "../../../generated/prisma/index.js";
import { logger, serializeError } from "../../core/utils/logger.js";

export interface RegisterVendorData {
  businessName: string;
  storeCategory: string;
  taxId?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  govIdUrl: string;
  businessDocUrl: string;
}

interface UpdateProductStockInput {
  productId: string;
  action: "increment" | "decrement";
  quantity: number;
}

interface UpdateProductDetailsInput {
  name?: string;
  description?: string;
  price?: number;
}

interface CreateProductOfferInput {
  offerName: string;
  discountPercentage: number;
  couponCode?: string;
  termsAndConditions?: string;
  isActive?: boolean;
}

interface VendorDashboardOptions {
  recentOrdersLimit?: number;
  lowStockThreshold?: number;
}

type ProductImageInput = Express.Multer.File | Express.Multer.File[];

const PRODUCTS_CACHE_KEY = "products:catalog:v2";
const vendorLogger = logger.child({ component: "vendor-service" });

export class VendorService {
  private static async invalidateProductCache() {
    try {
      const keys = await redis.keys(`${PRODUCTS_CACHE_KEY}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      vendorLogger.warn(
        { err: serializeError(error) },
        "Redis cache invalidation failed",
      );
    }
  }

  static async registerVendor(userId: string, data: RegisterVendorData) {
    const existingVendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (existingVendor) {
      throw new ApiError(400, "User is already registered as a vendor");
    }

    const vendor = await prisma.vendor.create({
      data: {
        userId,
        status: "PENDING",
        ...data,
      },
    });

    return vendor;
  }

  static async getVendorProfile(userId: string) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    return vendor;
  }

  static async updateLogo(userId: string, logoBuffer: Buffer) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    const logoUrl = await uploadToCloudinary(logoBuffer, "vendor_logos");

    const updatedVendor = await prisma.vendor.update({
      where: { id: vendor.id },
      data: { logoUrl },
    });

    return updatedVendor;
  }

  static async updateProductStock(
    vendorUserId: string,
    data: UpdateProductStockInput,
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    if (vendor.status !== "APPROVED") {
      throw new ApiError(403, "Only approved vendors can update product stock");
    }

    if (data.action === "increment") {
      const incrementResult = await prisma.product.updateMany({
        where: {
          id: data.productId,
          vendorId: vendor.id,
        },
        data: {
          stock: {
            increment: data.quantity,
          },
        },
      });

      if (incrementResult.count === 0) {
        throw new ApiError(404, "Product not found for this vendor");
      }
    }

    if (data.action === "decrement") {
      const decrementResult = await prisma.product.updateMany({
        where: {
          id: data.productId,
          vendorId: vendor.id,
          stock: {
            gte: data.quantity,
          },
        },
        data: {
          stock: {
            decrement: data.quantity,
          },
        },
      });

      if (decrementResult.count === 0) {
        const product = await prisma.product.findUnique({
          where: { id: data.productId },
          select: { id: true, vendorId: true, stock: true },
        });

        if (!product) {
          throw new ApiError(404, "Product not found");
        }

        if (product.vendorId !== vendor.id) {
          throw new ApiError(
            403,
            "You can only update stock for your own products",
          );
        }

        throw new ApiError(400, "Insufficient stock for decrement");
      }
    }

    const updatedProduct = await prisma.product.findUnique({
      where: { id: data.productId },
      select: {
        id: true,
        name: true,
        stock: true,
        updatedAt: true,
      },
    });

    if (!updatedProduct) {
      throw new ApiError(404, "Product not found");
    }

    await this.invalidateProductCache();

    return updatedProduct;
  }

  static async updateProductDetails(
    vendorUserId: string,
    productId: string,
    data: UpdateProductDetailsInput,
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    if (vendor.status !== "APPROVED") {
      throw new ApiError(
        403,
        "Only approved vendors can update product details",
      );
    }

    const updateData: UpdateProductDetailsInput = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    if (data.price !== undefined) {
      updateData.price = data.price;
    }

    if (Object.keys(updateData).length === 0) {
      throw new ApiError(
        400,
        "At least one field (name, description, price) is required",
      );
    }

    const updateResult = await prisma.product.updateMany({
      where: {
        id: productId,
        vendorId: vendor.id,
      },
      data: updateData,
    });

    if (updateResult.count === 0) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, vendorId: true },
      });

      if (!product) {
        throw new ApiError(404, "Product not found");
      }

      if (product.vendorId !== vendor.id) {
        throw new ApiError(403, "You can only update your own products");
      }

      throw new ApiError(400, "No product updates were applied");
    }

    const updatedProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        updatedAt: true,
      },
    });

    if (!updatedProduct) {
      throw new ApiError(404, "Product not found");
    }

    await this.invalidateProductCache();

    return updatedProduct;
  }

  static async addProductImages(
    vendorUserId: string,
    productId: string,
    images: ProductImageInput,
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    if (vendor.status !== "APPROVED") {
      throw new ApiError(403, "Only approved vendors can add product images");
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        vendorId: true,
        name: true,
        imageUrl: true,
        imageUrls: true,
      },
    });

    if (!product) {
      throw new ApiError(404, "Product not found");
    }

    if (product.vendorId !== vendor.id) {
      throw new ApiError(403, "You can only update your own products");
    }

    const imageFiles = Array.isArray(images) ? images : [images];
    if (imageFiles.length === 0) {
      throw new ApiError(400, "At least one image file is required");
    }

    const uploadedUrls = await Promise.all(
      imageFiles.map((file) => uploadToCloudinary(file.buffer, "products")),
    );

    const mergedUrls = [...product.imageUrls, ...uploadedUrls];
    const primaryImage = product.imageUrl ?? mergedUrls[0] ?? null;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        imageUrl: primaryImage,
        imageUrls: mergedUrls,
      },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        imageUrls: true,
        updatedAt: true,
      },
    });

    await this.invalidateProductCache();

    return updatedProduct;
  }

  static async createProductOffer(
    vendorUserId: string,
    productId: string,
    data: CreateProductOfferInput,
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    if (vendor.status !== "APPROVED") {
      throw new ApiError(
        403,
        "Only approved vendors can create product offers",
      );
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        vendorId: true,
      },
    });

    if (!product) {
      throw new ApiError(404, "Product not found");
    }

    if (product.vendorId !== vendor.id) {
      throw new ApiError(
        403,
        "You can only create offers for your own products",
      );
    }

    const normalizedCouponCode = data.couponCode?.trim().toUpperCase();

    try {
      const offer = await prisma.offer.create({
        data: {
          productId,
          offerName: data.offerName.trim(),
          discountPercentage: data.discountPercentage,
          couponCode: normalizedCouponCode,
          termsAndConditions: data.termsAndConditions?.trim(),
          isActive: data.isActive ?? true,
        },
        select: {
          id: true,
          productId: true,
          offerName: true,
          discountPercentage: true,
          couponCode: true,
          termsAndConditions: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return offer;
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ApiError(
          409,
          "An offer with this coupon code already exists for this product",
        );
      }
      throw error;
    }
  }

  static async getProductOffers(vendorUserId: string, productId: string) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        vendorId: true,
      },
    });

    if (!product) {
      throw new ApiError(404, "Product not found");
    }

    if (product.vendorId !== vendor.id) {
      throw new ApiError(403, "You can only view offers for your own products");
    }

    const offers = await prisma.offer.findMany({
      where: { productId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        offerName: true,
        discountPercentage: true,
        couponCode: true,
        termsAndConditions: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      productId: product.id,
      productName: product.name,
      offers,
    };
  }

  static async getDashboard(
    vendorUserId: string,
    options: VendorDashboardOptions = {},
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
      select: { id: true },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor profile not found");
    }

    const lowStockThreshold = options.lowStockThreshold ?? 5;
    const recentOrdersLimit = Math.min(options.recentOrdersLimit ?? 5, 20);

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const startOfThisWeek = new Date(startOfToday);
    const dayOfWeek = startOfThisWeek.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    startOfThisWeek.setDate(startOfThisWeek.getDate() - diffToMonday);

    const startOfLastWeek = new Date(startOfThisWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    const activeStatuses = [OrderStatus.PAID, OrderStatus.CONFIRMED];

    const [
      totalProducts,
      lowStockItems,
      activeOrders,
      activeOrdersToday,
      activeOrdersYesterday,
      recentOrders,
      stockAlerts,
      totalRevenueAllTime,
      revenueThisWeek,
      revenueLastWeek,
    ] = await Promise.all([
      prisma.product.count({
        where: { vendorId: vendor.id },
      }),
      prisma.product.count({
        where: {
          vendorId: vendor.id,
          stock: { lt: lowStockThreshold },
        },
      }),
      prisma.order.count({
        where: {
          vendorId: vendor.id,
          status: { in: activeStatuses },
        },
      }),
      prisma.order.count({
        where: {
          vendorId: vendor.id,
          status: { in: activeStatuses },
          createdAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
      prisma.order.count({
        where: {
          vendorId: vendor.id,
          status: { in: activeStatuses },
          createdAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),
      prisma.order.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
        take: recentOrdersLimit,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          user: { select: { name: true } },
          items: { select: { id: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          vendorId: vendor.id,
          stock: { lte: lowStockThreshold },
        },
        orderBy: { stock: "asc" },
        take: 5,
        select: {
          id: true,
          name: true,
          imageUrl: true,
          stock: true,
        },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: "SUCCESS",
          order: { vendorId: vendor.id },
        },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: "SUCCESS",
          order: {
            vendorId: vendor.id,
            createdAt: { gte: startOfThisWeek, lt: now },
          },
        },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: "SUCCESS",
          order: {
            vendorId: vendor.id,
            createdAt: { gte: startOfLastWeek, lt: startOfThisWeek },
          },
        },
      }),
    ]);

    const totalRevenue = totalRevenueAllTime._sum.amount
      ? totalRevenueAllTime._sum.amount.toString()
      : "0";

    const lastWeekRevenue = revenueLastWeek._sum.amount
      ? Number(revenueLastWeek._sum.amount)
      : 0;

    const thisWeekRevenue = revenueThisWeek._sum.amount
      ? Number(revenueThisWeek._sum.amount)
      : 0;

    const revenueChangePctThisWeek =
      lastWeekRevenue > 0
        ? Number(
            (
              ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) *
              100
            ).toFixed(2),
          )
        : 0;

    return {
      summary: {
        totalRevenue,
        revenueChangePctThisWeek,
        activeOrders,
        activeOrdersDeltaSinceYesterday:
          activeOrdersToday - activeOrdersYesterday,
        totalProducts,
        lowStockItems,
        lowStockThreshold,
      },
      recentOrders: recentOrders.map((order) => ({
        orderId: order.id,
        customerName: order.user?.name ?? "Customer",
        itemCount: order.items.length,
        amount: Number(order.totalAmount),
        status: order.status,
        createdAt: order.createdAt,
      })),
      stockAlerts: stockAlerts.map((product) => ({
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        stock: product.stock,
        isOutOfStock: product.stock === 0,
      })),
    };
  }
}
