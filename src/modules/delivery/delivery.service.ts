import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { OrderStatus, Prisma } from "../../../generated/prisma/index.js";

export class DeliveryService {
  static async getPartnerProfile(userId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    return partner;
  }

  /**
   * Register a user as a delivery partner
   */
  static async registerPartner(
    userId: string,
    coveragePincodes: string[],
    dailyCapacity: number = 10,
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (user.role !== "DELIVERY_PARTNER") {
      throw new ApiError(403, "User role must be DELIVERY_PARTNER");
    }

    const partner = await prisma.deliveryPartner.upsert({
      where: { userId },
      update: { coveragePincodes, dailyCapacity },
      create: { userId, coveragePincodes, dailyCapacity, activeDeliveries: 0 },
    });

    return partner;
  }

  /**
   * The core Assignment Algorithm.
   * Triggered when an order is packed by the vendor.
   */
  static async assignOrderToPartner(orderId: string) {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Get the Order
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) throw new ApiError(404, "Order not found");

      if (order.status !== OrderStatus.PACKED) {
        throw new ApiError(
          400,
          "Order must be PACKED before assigning a delivery partner.",
        );
      }

      // 2. Locality Match: Find partners covering this pincode
      const potentialPartners = await tx.deliveryPartner.findMany({
        where: {
          coveragePincodes: { has: order.deliveryPincode },
        },
      });

      // 3. Constraint Check: Filter out partners at or over capacity
      const availablePartners = potentialPartners.filter(
        (p) => p.activeDeliveries < p.dailyCapacity,
      );

      if (availablePartners.length === 0) {
        // Fallback Mechanism: +1 day ETA extension if all busy (or no coverage)
        // We log this as an OrderEvent and keep the order in PACKED state to retry later.
        await tx.orderEvent.create({
          data: {
            orderId,
            status: OrderStatus.PACKED,
            note: "No delivery partners available. System extending ETA by +1 day. Will retry assignment.",
          },
        });

        return {
          success: false,
          message: "No partners available. ETA extended.",
        };
      }

      // 4. Proximity & Load Balance: Sort by those with the lowest active deliveries first
      availablePartners.sort((a, b) => a.activeDeliveries - b.activeDeliveries);

      const selectedPartner = availablePartners[0];
      if (!selectedPartner) {
        throw new ApiError(500, "Failed to select a delivery partner");
      }

      // 5. Assignment: Link partner to order, increment active deliveries
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryPartnerId: selectedPartner.id,
          status: OrderStatus.READY_FOR_PICKUP,
        },
      });

      await tx.deliveryPartner.update({
        where: { id: selectedPartner.id },
        data: { activeDeliveries: { increment: 1 } },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          status: OrderStatus.READY_FOR_PICKUP,
          note: `Assigned to delivery partner (ID: ${selectedPartner.id})`,
        },
      });

      return {
        success: true,
        message: "Order assigned successfully",
        partnerId: selectedPartner.id,
      };
    });
  }

  /**
   * Called by the delivery partner when they successfully deliver the item.
   */
  static async completeDelivery(orderId: string, partnerUserId: string) {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const partner = await tx.deliveryPartner.findUnique({
        where: { userId: partnerUserId },
      });

      if (!partner)
        throw new ApiError(404, "Delivery partner profile not found");

      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order || order.deliveryPartnerId !== partner.id) {
        throw new ApiError(403, "You are not assigned to this order");
      }

      if (
        order.status !== OrderStatus.OUT_FOR_DELIVERY &&
        order.status !== OrderStatus.READY_FOR_PICKUP
      ) {
        throw new ApiError(
          400,
          "Order is not in a valid state for delivery completion",
        );
      }

      // 1. Mark order as delivered
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.DELIVERED },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.DELIVERED,
          note: "Package successfully delivered to customer.",
        },
      });

      // 2. Free up the partner's capacity!
      await tx.deliveryPartner.update({
        where: { id: partner.id },
        data: { activeDeliveries: { decrement: 1 } },
      });

      return { success: true, message: "Delivery completed successfully" };
    });
  }
}
