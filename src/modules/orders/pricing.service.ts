import { OfferApprovalStatus } from "../../../generated/prisma/index.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { prisma } from "../../db/prisma.js";

interface PricingItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  categoryName: string;
}

interface PricingOfferSelectionInput {
  productId: string;
  offerId?: string;
  couponCode?: string;
}

interface OfferDiscountConfig {
  offerId: string;
  discountPercentage: number;
  couponCode: string | null;
  offerName: string;
}

export interface ItemPricingBreakdown {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  lineTotal: number;
}

export interface CartPricingSummary {
  subtotal: number;
  platformFee: number;
  deliveryFee: number;
  gst: number;
  offerDiscount: number;
  grandTotal: number;
}

export interface CartPricingResult {
  summary: CartPricingSummary;
  itemBreakdown: ItemPricingBreakdown[];
  appliedOffers: Record<string, OfferDiscountConfig>;
}

const PLATFORM_FEE = 29;
const BASE_DELIVERY_FEE = 49;
const FREE_DELIVERY_THRESHOLD = 499;

const GST_RATE_BY_CATEGORY: Record<string, number> = {
  Electronics: 18,
  Fashion: 12,
  Beauty: 12,
  "Food & Gourmet": 5,
  Books: 5,
  "Toys & Games": 5,
  "Home & Living": 12,
  Sports: 5,
};

function roundTo2(value: number) {
  return Number(value.toFixed(2));
}

function getGstRateForCategory(categoryName: string) {
  const normalized = categoryName.trim().toLowerCase();
  return GST_RATE_BY_CATEGORY[normalized] ?? 12;
}

export class OrderPricingService {
  static getPlatformFee() {
    return PLATFORM_FEE;
  }

  static async getLiveOffersForProducts(productIds: string[]) {
    if (productIds.length === 0) {
      return [];
    }

    const now = new Date();

    return prisma.offer.findMany({
      where: {
        productId: { in: productIds },
        isActive: true,
        approvalStatus: OfferApprovalStatus.APPROVED,
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
      orderBy: [{ discountPercentage: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        productId: true,
        offerName: true,
        discountPercentage: true,
        couponCode: true,
        termsAndConditions: true,
      },
    });
  }

  static async resolveAppliedOffers(
    productIds: string[],
    selections: PricingOfferSelectionInput[] = [],
  ): Promise<Record<string, OfferDiscountConfig>> {
    if (selections.length === 0 || productIds.length === 0) {
      return {};
    }

    const selectionByProduct = new Map<string, PricingOfferSelectionInput>();

    for (const selection of selections) {
      if (!productIds.includes(selection.productId)) {
        throw new ApiError(
          400,
          `Invalid offer selection for product ${selection.productId}`,
        );
      }

      if (!selection.offerId && !selection.couponCode) {
        throw new ApiError(
          400,
          "Each offer selection must include either offerId or couponCode",
        );
      }

      if (selectionByProduct.has(selection.productId)) {
        throw new ApiError(
          400,
          `Multiple offer selections found for product ${selection.productId}`,
        );
      }

      selectionByProduct.set(selection.productId, {
        ...selection,
        couponCode: selection.couponCode?.trim().toUpperCase(),
      });
    }

    const activeOffers = await this.getLiveOffersForProducts(productIds);
    const offersByProduct = activeOffers.reduce<
      Record<string, typeof activeOffers>
    >((acc, offer) => {
      if (!acc[offer.productId]) {
        acc[offer.productId] = [];
      }
      acc[offer.productId]!.push(offer);
      return acc;
    }, {});

    const applied: Record<string, OfferDiscountConfig> = {};

    for (const [productId, selection] of selectionByProduct) {
      const productOffers = offersByProduct[productId] ?? [];

      const matchedOffer = productOffers.find((offer) => {
        if (selection.offerId && offer.id === selection.offerId) {
          if (
            selection.couponCode &&
            offer.couponCode !== selection.couponCode
          ) {
            return false;
          }
          return true;
        }

        if (selection.couponCode && offer.couponCode === selection.couponCode) {
          return true;
        }

        return false;
      });

      if (!matchedOffer) {
        throw new ApiError(
          400,
          `No valid active offer found for product ${productId} using provided offer selection`,
        );
      }

      applied[productId] = {
        offerId: matchedOffer.id,
        discountPercentage: matchedOffer.discountPercentage,
        couponCode: matchedOffer.couponCode,
        offerName: matchedOffer.offerName,
      };
    }

    return applied;
  }

  static calculateFromCartItems(
    items: PricingItemInput[],
    offerByProductId: Record<string, OfferDiscountConfig> = {},
  ): CartPricingResult {
    const subtotal = roundTo2(
      items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    );

    const deliveryFee =
      subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : BASE_DELIVERY_FEE;
    const platformFee = PLATFORM_FEE;

    const itemBreakdown: ItemPricingBreakdown[] = items.map((item) => {
      const lineSubtotal = roundTo2(item.unitPrice * item.quantity);
      const selectedOffer = offerByProductId[item.productId];
      const discountAmount = selectedOffer
        ? roundTo2((lineSubtotal * selectedOffer.discountPercentage) / 100)
        : 0;

      const taxableAmount = roundTo2(
        Math.max(lineSubtotal - discountAmount, 0),
      );
      const gstRate = getGstRateForCategory(item.categoryName);
      const gstAmount = roundTo2((taxableAmount * gstRate) / 100);
      const lineTotal = roundTo2(taxableAmount + gstAmount);

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: roundTo2(item.unitPrice),
        lineSubtotal,
        discountAmount,
        taxableAmount,
        gstRate,
        gstAmount,
        lineTotal,
      };
    });

    const offerDiscount = roundTo2(
      itemBreakdown.reduce((sum, item) => sum + item.discountAmount, 0),
    );

    const gst = roundTo2(
      itemBreakdown.reduce((sum, item) => sum + item.gstAmount, 0),
    );

    const grandTotal = roundTo2(
      Math.max(subtotal - offerDiscount + gst + platformFee + deliveryFee, 0),
    );

    return {
      summary: {
        subtotal,
        platformFee,
        deliveryFee,
        gst,
        offerDiscount,
        grandTotal,
      },
      itemBreakdown,
      appliedOffers: offerByProductId,
    };
  }
}
