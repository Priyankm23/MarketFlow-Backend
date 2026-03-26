import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";
import { Prisma } from "../../../generated/prisma/index.js";

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

type ProductImageInput = Express.Multer.File | Express.Multer.File[];

const PRODUCTS_CACHE_KEY = "products:catalog:v2";

export class VendorService {
  private static async invalidateProductCache() {
    try {
      const keys = await redis.keys(`${PRODUCTS_CACHE_KEY}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error("⚠️ Redis Cache Invalidation Failed:", error);
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
}
