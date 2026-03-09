import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { OrderStatus, Prisma } from "../../../generated/prisma/index.js";
import { OrderStateMachine } from "./orderStateMachine.js";
import { CartService } from "../cart/cart.service.js";

export class OrderService {
  /**
   * Convert Redis Cart into one or more Postgres Orders (grouped by Vendor).
   */
  static async checkoutCart(userId: string, deliveryPincode: string) {
    const cart = await CartService.getCart(userId);

    if (cart.items.length === 0) {
      throw new ApiError(400, "Cannot checkout an empty cart");
    }

    // Group items by vendorId
    type GroupedCart = Record<string, typeof cart.items>;
    const itemsByVendor = cart.items.reduce((acc, item) => {
      if (!acc[item.vendorId]) acc[item.vendorId] = [];
      acc[item.vendorId].push(item);
      return acc;
    }, {} as GroupedCart);

    // Create a transaction to build orders & clear cart
    const finalOrders = await prisma.$transaction(async (tx) => {
      const createdOrders = [];

      for (const vendorId of Object.keys(itemsByVendor)) {
        const vendorItems = itemsByVendor[vendorId];
        const initialStatus = OrderStatus.CREATED;

        const vendorTotal = vendorItems.reduce(
          (sum, item) => sum + item.itemTotal,
          0,
        );

        // 1. Create the order
        const order = await tx.order.create({
          data: {
            userId,
            vendorId,
            deliveryPincode,
            totalAmount: vendorTotal,
            status: initialStatus,
            items: {
              create: vendorItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                price: item.price,
              })),
            },
            // Also create the first audit event automatically
            events: {
              create: [
                {
                  status: initialStatus,
                  note: "Order placed from Cart",
                },
              ],
            },
          },
          include: {
            items: true,
          },
        });

        createdOrders.push(order);
      }

      return createdOrders;
    });

    // Clear the cart on successful order creation
    await CartService.clearCart(userId);

    return finalOrders;
  }

  /**
   * Universal method to update Order Status.
   * Handles validation through the state machine and creates an audit log.
   */
  static async updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    note?: string,
  ) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Validate the transition
    OrderStateMachine.validateTransition(order.status, newStatus);

    return prisma.$transaction(async (tx) => {
      // 1. Update the order
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: newStatus },
      });

      // 2. Append to the Audit Logger
      await tx.orderEvent.create({
        data: {
          orderId,
          status: newStatus,
          note,
        },
      });

      return updatedOrder;
    });
  }

  static async getCustomerOrders(userId: string) {
    return prisma.order.findMany({
      where: { userId },
      include: {
        vendor: { select: { businessName: true } },
        items: {
          include: {
            product: { select: { name: true, imageUrl: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getVendorOrders(vendorUserId: string) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
    });

    if (!vendor) {
      throw new ApiError(403, "Vendor profile not found");
    }

    return prisma.order.findMany({
      where: { vendorId: vendor.id },
      include: {
        user: { select: { name: true, email: true } },
        items: {
          include: {
            product: { select: { name: true } },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getOrderDetails(orderId: string, userId: string, role: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { product: { select: { name: true, imageUrl: true } } },
        },
        vendor: { select: { businessName: true, userId: true } },
        events: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Basic Access Control
    if (role === "CUSTOMER" && order.userId !== userId) {
      throw new ApiError(403, "Unauthorized access to this order");
    }

    if (role === "VENDOR" && order.vendor.userId !== userId) {
      throw new ApiError(403, "Unauthorized access to this order");
    }

    return order;
  }
}
