import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { Prisma } from "../../../generated/prisma/index.js";

const REDIS_KEY = "flashDeals:active";

export class FlashDealsService {
  private static isMissingColumnError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2022"
    );
  }

  static async getActiveFlashDeals(limit = 10) {
    // Try cache first
    try {
      const cached = await redis.get(REDIS_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error("Redis read failed for flash deals:", err);
    }

    const now = new Date();

    let offers: any[] = [];
    try {
      offers = await prisma.offer.findMany({
        where: {
          isFlashDeal: true,
          approvalStatus: "APPROVED",
          isActive: true,
          startAt: { lte: now },
          endAt: { gt: now },
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              stock: true,
              imageUrl: true,
              imageUrls: true,
              vendorId: true,
              vendor: { select: { businessName: true } },
              ratingSummary: true,
            },
          },
        },
        orderBy: [{ endAt: "asc" }, { createdAt: "desc" }],
        take: limit,
      });
    } catch (error) {
      if (!this.isMissingColumnError(error)) throw error;

      console.error(
        "Flash deals disabled due to schema drift (P2022). Run prisma migrate deploy on production.",
      );
      return [];
    }

    // Transform for frontend
    const nowMs = Date.now();

    const result = offers.map((o: any) => {
      const originalPrice = Number(o.product.price ?? 0);
      const pct = Number(o.discountPercentage ?? 0);
      const discountedPrice =
        Math.round(originalPrice * (1 - pct / 100) * 100) / 100;
      const computedPct =
        originalPrice > 0
          ? Math.round(
              ((originalPrice - discountedPrice) / originalPrice) * 10000,
            ) / 100
          : 0;
      const timeTillValidSec = o.endAt
        ? Math.max(0, Math.floor((o.endAt.getTime() - nowMs) / 1000))
        : 0;

      return {
        id: o.id,
        offerName: o.offerName,
        discountPercentage: pct,
        computedDiscountPercentage: computedPct,
        startAt: o.startAt,
        endAt: o.endAt,
        timeTillValidSeconds: timeTillValidSec,
        product: {
          id: o.product.id,
          name: o.product.name,
          originalPrice,
          priceAfterFlashDeal: discountedPrice,
          stock: o.product.stock,
          imageUrl: o.product.imageUrl,
          imageUrls: o.product.imageUrls,
          ratingBreakdown: o.product.ratingSummary
            ? {
                oneStarCount: o.product.ratingSummary.oneStarCount,
                twoStarCount: o.product.ratingSummary.twoStarCount,
                threeStarCount: o.product.ratingSummary.threeStarCount,
                fourStarCount: o.product.ratingSummary.fourStarCount,
                fiveStarCount: o.product.ratingSummary.fiveStarCount,
              }
            : null,
          vendorId: o.product.vendorId,
          vendorBusinessName: o.product.vendor?.businessName ?? null,
        },
      };
    });

    // Set cache TTL to nearest endAt
    try {
      const nearestEnd = offers.reduce<number | null>((acc, cur) => {
        const t = cur.endAt ? cur.endAt.getTime() : null;
        if (t == null) return acc;
        return acc == null ? t : Math.min(acc, t);
      }, null);

      if (nearestEnd) {
        const ttlSec = Math.max(
          10,
          Math.floor((nearestEnd - Date.now()) / 1000),
        );
        await redis.set(REDIS_KEY, JSON.stringify(result), "EX", ttlSec);
      } else {
        await redis.set(REDIS_KEY, JSON.stringify(result), "EX", 30);
      }
    } catch (err) {
      console.error("Redis write failed for flash deals:", err);
    }

    return result;
  }

  static async invalidateCache() {
    try {
      await redis.del(REDIS_KEY);
    } catch (err) {
      console.error("Redis delete failed for flash deals:", err);
    }
  }

  static async createOffer(
    vendorUserId: string,
    data: {
      productId: string;
      discountPercentage: number;
      startAt: Date;
      endAt: Date;
      offerName?: string;
      couponCode?: string | null;
      termsAndConditions?: string | null;
    },
  ) {
    // Verify vendor exists and owns the product
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });
    if (!vendor) throw new Error("Vendor profile not found");

    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) throw new Error("Product not found");
    if (product.vendorId !== vendor.id)
      throw new Error("You can only create offers for your own products");

    // Preflight checks
    if (!product.isActive)
      throw new Error("Cannot create flash deal for inactive product");
    if (product.stock <= 0)
      throw new Error("Cannot create flash deal for out-of-stock product");
    if (data.discountPercentage <= 0 || data.discountPercentage > 60)
      throw new Error("discountPercentage must be between 1 and 60");
    if (data.startAt >= data.endAt)
      throw new Error("startAt must be before endAt");
    const maxDurationMs = 120 * 60 * 60 * 1000; // 5 days
    if (data.endAt.getTime() - data.startAt.getTime() > maxDurationMs)
      throw new Error("Flash deal duration cannot exceed 120 hours / 5 days");

    // Determine auto-approval using vendor status + rating thresholds
    // Fetch vendor product ids
    const vendorProducts = await prisma.product.findMany({
      where: { vendorId: vendor.id },
      select: { id: true },
    });
    const vendorProductIds = vendorProducts.map((p) => p.id);

    // Aggregate ratings for vendor's products
    let avgRating: number | null = null;
    let ratingCount = 0;
    if (vendorProductIds.length > 0) {
      const agg = await prisma.productReview.aggregate({
        where: { productId: { in: vendorProductIds } },
        _avg: { rating: true },
        _count: { rating: true },
      });
      avgRating = agg._avg.rating ?? null;
      ratingCount = agg._count.rating ?? 0;
    }

    const minRating = env.FLASH_DEAL_AUTO_APPROVE_MIN_RATING ?? 3.5;
    const minReviews = env.FLASH_DEAL_AUTO_APPROVE_MIN_REVIEWS ?? 3;

    const autoApprove =
      vendor.status === "APPROVED" &&
      avgRating !== null &&
      avgRating >= minRating &&
      ratingCount >= minReviews;

    const approvalStatus = autoApprove ? "APPROVED" : "PENDING";

    const created = await prisma.offer.create({
      data: {
        productId: data.productId,
        offerName: data.offerName ?? "Flash Deal",
        discountPercentage: data.discountPercentage,
        couponCode: data.couponCode ?? null,
        termsAndConditions: data.termsAndConditions ?? null,
        isActive: approvalStatus === "APPROVED",
        isFlashDeal: true,
        startAt: data.startAt,
        endAt: data.endAt,
        approvalStatus: approvalStatus as any,
      },
    });

    // If auto-approved, invalidate cache and warm it
    if (approvalStatus === "APPROVED") {
      await this.invalidateCache();
      try {
        await this.refreshCache();
      } catch (err) {
        console.error("Failed to warm cache after auto-approve:", err);
      }
    } else {
      // log reason for manual review (helps admins)
      console.log("FlashDeal queued for approval", {
        vendorId: vendor.id,
        avgRating,
        ratingCount,
        minRating,
        minReviews,
      });
    }

    return created;
  }

  static async createNonFlashOffer(
    vendorUserId: string,
    data: {
      productId: string;
      discountPercentage: number;
      startAt: Date;
      endAt: Date;
      offerName?: string;
      couponCode?: string | null;
      termsAndConditions?: string | null;
    },
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });
    if (!vendor) throw new Error("Vendor profile not found");

    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) throw new Error("Product not found");
    if (product.vendorId !== vendor.id) {
      throw new Error("You can only create offers for your own products");
    }

    if (data.discountPercentage <= 0 || data.discountPercentage > 60) {
      throw new Error("discountPercentage must be between 1 and 60");
    }
    if (data.startAt >= data.endAt) {
      throw new Error("startAt must be before endAt");
    }

    const maxDurationMs = 14 * 24 * 60 * 60 * 1000; // 14 days
    if (data.endAt.getTime() - data.startAt.getTime() > maxDurationMs) {
      throw new Error("Offer duration cannot exceed 14 days");
    }

    return prisma.offer.create({
      data: {
        productId: data.productId,
        offerName: data.offerName ?? "Offer",
        discountPercentage: data.discountPercentage,
        couponCode: data.couponCode ?? null,
        termsAndConditions: data.termsAndConditions ?? null,
        isActive: true,
        isFlashDeal: false,
        startAt: data.startAt,
        endAt: data.endAt,
        approvalStatus: "APPROVED",
      },
    });
  }

  static async getNonFlashOffersByProduct(productId: string) {
    const now = new Date();

    return prisma.offer.findMany({
      where: {
        productId,
        isFlashDeal: false,
        isActive: true,
        startAt: { lte: now },
        endAt: { gt: now },
      },
      orderBy: [{ endAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        offerName: true,
        discountPercentage: true,
        couponCode: true,
        termsAndConditions: true,
        startAt: true,
        endAt: true,
        isActive: true,
        isFlashDeal: true,
        productId: true,
      },
    });
  }

  static async listPendingOffers() {
    const offers = await prisma.offer.findMany({
      where: { isFlashDeal: true, approvalStatus: "PENDING" },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
            stock: true,
            vendorId: true,
            vendor: {
              select: {
                id: true,
                userId: true,
                status: true,
                businessName: true,
              },
            },
            reviewCount: true,
            ratingSummary: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const minRating = env.FLASH_DEAL_AUTO_APPROVE_MIN_RATING ?? 3.5;
    const minReviews = env.FLASH_DEAL_AUTO_APPROVE_MIN_REVIEWS ?? 3;

    const mapped = await Promise.all(
      offers.map(async (o: any) => {
        const product = o.product;

        // gather vendor product ids to compute vendor rating
        let vendorProductIds: string[] = [];
        if (product?.vendorId) {
          const vprods = await prisma.product.findMany({
            where: { vendorId: product.vendorId },
            select: { id: true },
          });
          vendorProductIds = vprods.map((p) => p.id);
        }

        let avgRating: number | null = null;
        let ratingCount = 0;
        if (vendorProductIds.length > 0) {
          const agg = await prisma.productReview.aggregate({
            where: { productId: { in: vendorProductIds } },
            _avg: { rating: true },
            _count: { rating: true },
          });
          avgRating = agg._avg.rating ?? null;
          ratingCount = agg._count.rating ?? 0;
        }

        const criteria = {
          productIsActive: Boolean(product?.isActive),
          productHasStock:
            typeof product?.stock === "number" ? product.stock > 0 : false,
          discountValid:
            typeof o.discountPercentage === "number" &&
            o.discountPercentage > 0 &&
            o.discountPercentage <= 60,
          startBeforeEnd:
            o.startAt && o.endAt
              ? new Date(o.startAt) < new Date(o.endAt)
              : false,
          durationOk:
            o.startAt && o.endAt
              ? new Date(o.endAt).getTime() - new Date(o.startAt).getTime() <=
                120 * 60 * 60 * 1000
              : false,
          vendorStatusApproved: Boolean(product?.vendor?.status === "APPROVED"),
          avgRating: avgRating,
          ratingCount: ratingCount,
          minRating,
          minReviews,
        };

        const failingReasons: string[] = [];
        if (!criteria.productIsActive) failingReasons.push("product_inactive");
        if (!criteria.productHasStock) failingReasons.push("out_of_stock");
        if (!criteria.discountValid) failingReasons.push("invalid_discount");
        if (!criteria.startBeforeEnd) failingReasons.push("invalid_time_range");
        if (!criteria.durationOk) failingReasons.push("duration_too_long");
        if (!criteria.vendorStatusApproved)
          failingReasons.push("vendor_not_approved");
        if (criteria.avgRating === null || criteria.avgRating < minRating)
          failingReasons.push("insufficient_rating");
        if (criteria.ratingCount < minReviews)
          failingReasons.push("insufficient_reviews");

        const passed = failingReasons.length === 0;

        return {
          offer: {
            id: o.id,
            offerName: o.offerName,
            discountPercentage: o.discountPercentage,
            couponCode: o.couponCode ?? null,
            termsAndConditions: o.termsAndConditions ?? null,
            startAt: o.startAt,
            endAt: o.endAt,
            createdAt: o.createdAt,
            isActive: o.isActive,
          },
          product: {
            id: product?.id,
            name: product?.name,
            price: product?.price,
            isActive: product?.isActive,
            stock: product?.stock,
          },
          vendor: {
            id: product?.vendor?.id ?? null,
            userId: product?.vendor?.userId ?? null,
            status: product?.vendor?.status ?? null,
            businessName: product?.vendor?.businessName ?? null,
          },
          criteria: {
            ...criteria,
            passed,
            failingReasons,
          },
        };
      }),
    );

    return mapped;
  }

  static async approveOffer(adminUserId: string, offerId: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new Error("Offer not found");

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: {
        approvalStatus: "APPROVED",
        approvedById: adminUserId,
        approvedAt: new Date(),
        isActive: true,
      },
    });

    await this.invalidateCache();
    try {
      await this.refreshCache();
    } catch (err) {
      console.error("Failed to warm flash deals cache after approve:", err);
    }
    return updated;
  }

  static async rejectOffer(
    adminUserId: string,
    offerId: string,
    reason?: string,
  ) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new Error("Offer not found");

    const updated = await prisma.offer.update({
      where: { id: offerId },
      data: {
        approvalStatus: "REJECTED",
        approvedById: adminUserId,
        approvedAt: new Date(),
        isActive: false,
      },
    });

    // Note: we could store rejection reason in a separate audit table. For now, we simply mark rejected.
    await this.invalidateCache();
    try {
      await this.refreshCache();
    } catch (err) {
      console.error("Failed to warm flash deals cache after reject:", err);
    }
    return updated;
  }

  static async refreshCache(limit = 10) {
    // Query DB for active offers and set Redis cache (bypass existing cache read)
    const now = new Date();

    let offers: any[] = [];
    try {
      offers = await prisma.offer.findMany({
        where: {
          isFlashDeal: true,
          approvalStatus: "APPROVED",
          isActive: true,
          startAt: { lte: now },
          endAt: { gt: now },
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              stock: true,
              imageUrl: true,
              imageUrls: true,
              vendorId: true,
              vendor: { select: { businessName: true } },
              ratingSummary: true,
            },
          },
        },
        orderBy: [{ endAt: "asc" }, { createdAt: "desc" }],
        take: limit,
      });
    } catch (error) {
      if (!this.isMissingColumnError(error)) throw error;

      console.error(
        "Flash deals cache refresh skipped due to schema drift (P2022). Run prisma migrate deploy on production.",
      );
      return [];
    }

    const nowMs = Date.now();

    const result = offers.map((o: any) => {
      const originalPrice = Number(o.product.price ?? 0);
      const pct = Number(o.discountPercentage ?? 0);
      const discountedPrice =
        Math.round(originalPrice * (1 - pct / 100) * 100) / 100;
      const computedPct =
        originalPrice > 0
          ? Math.round(
              ((originalPrice - discountedPrice) / originalPrice) * 10000,
            ) / 100
          : 0;
      const timeTillValidSec = o.endAt
        ? Math.max(0, Math.floor((o.endAt.getTime() - nowMs) / 1000))
        : 0;

      return {
        id: o.id,
        offerName: o.offerName,
        discountPercentage: pct,
        computedDiscountPercentage: computedPct,
        startAt: o.startAt,
        endAt: o.endAt,
        timeTillValidSeconds: timeTillValidSec,
        product: {
          id: o.product.id,
          name: o.product.name,
          originalPrice,
          priceAfterFlashDeal: discountedPrice,
          stock: o.product.stock,
          imageUrl: o.product.imageUrl,
          imageUrls: o.product.imageUrls,
          ratingBreakdown: o.product.ratingSummary
            ? {
                oneStarCount: o.product.ratingSummary.oneStarCount,
                twoStarCount: o.product.ratingSummary.twoStarCount,
                threeStarCount: o.product.ratingSummary.threeStarCount,
                fourStarCount: o.product.ratingSummary.fourStarCount,
                fiveStarCount: o.product.ratingSummary.fiveStarCount,
              }
            : null,
          vendorId: o.product.vendorId,
          vendorBusinessName: o.product.vendor?.businessName ?? null,
        },
      };
    });

    try {
      const nearestEnd = offers.reduce<number | null>((acc, cur) => {
        const t = cur.endAt ? cur.endAt.getTime() : null;
        if (t == null) return acc;
        return acc == null ? t : Math.min(acc, t);
      }, null);

      if (nearestEnd) {
        const ttlSec = Math.max(
          10,
          Math.floor((nearestEnd - Date.now()) / 1000),
        );
        await redis.set(REDIS_KEY, JSON.stringify(result), "EX", ttlSec);
        return { nearestEnd, ttlSec };
      } else {
        await redis.set(REDIS_KEY, JSON.stringify(result), "EX", 30);
        return { nearestEnd: null, ttlSec: 30 };
      }
    } catch (err) {
      console.error("Redis write failed for flash deals during refresh:", err);
      return { nearestEnd: null, ttlSec: 30 };
    }
  }
}

export default FlashDealsService;
