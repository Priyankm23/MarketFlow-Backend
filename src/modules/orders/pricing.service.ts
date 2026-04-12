import { OfferApprovalStatus } from "../../../generated/prisma/index.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { prisma } from "../../db/prisma.js";

interface PricingItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
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
const BASE_DELIVERY_FEE = 40;

function roundTo2(value: number) {
  return Number(value.toFixed(2));
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

    const deliveryFee = BASE_DELIVERY_FEE;
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
      // GST is treated as already included in the listed product price.
      const gstRate = 0;
      const gstAmount = 0;
      const lineTotal = taxableAmount;

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

    const gst = 0;

    const grandTotal = roundTo2(
      Math.max(subtotal - offerDiscount + platformFee + deliveryFee, 0),
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
