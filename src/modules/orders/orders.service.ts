import { prisma } from "../../db/prisma.js";
import { redis } from "../../config/redis.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { OrderStatus, Prisma } from "../../../generated/prisma/index.js";
import { OrderStateMachine } from "./orderStateMachine.js";
import { CartService } from "../cart/cart.service.js";
import { DeliveryService } from "../delivery/delivery.service.js";

interface CheckoutShippingAddress {
  fullName: string;
  email: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
}

type CheckoutPaymentMode = "ONLINE" | "COD";

export class OrderService {
  /**
   * Convert Redis Cart into one or more Postgres Orders (grouped by Vendor).
   */
  static async checkoutCart(
    userId: string,
    shippingAddress: CheckoutShippingAddress,
    paymentMode: CheckoutPaymentMode = "ONLINE",
  ) {
    const cart = await CartService.getCart(userId);

    if (cart.items.length === 0) {
      throw new ApiError(400, "Cannot checkout an empty cart");
    }

    // Group items by vendorId
    type GroupedCart = Record<string, typeof cart.items>;
    const itemsByVendor = cart.items.reduce((acc, item) => {
      if (!acc[item.vendorId]) {
        acc[item.vendorId] = [];
      }
      acc[item.vendorId]!.push(item);
      return acc;
    }, {} as GroupedCart);

    // Sort Product IDs to avoid deadlocks when locking
    const productIds = cart.items.map((item) => item.productId).sort();

    // Create a transaction to lock inventory, build orders, & clear cart
    const finalOrders = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Lock Products (Row-Level Locking to prevent race conditions)
        const lockedProducts = await tx.$queryRaw<
          Array<{ id: string; stock: number }>
        >`
        SELECT id, stock FROM "Product"
        WHERE id IN (${Prisma.join(productIds)})
        FOR UPDATE
      `;

        const stockMap = lockedProducts.reduce<Record<string, number>>(
          (acc, product) => {
            acc[product.id] = product.stock;
            return acc;
          },
          {},
        );

        // 2. Validate Stock
        for (const item of cart.items) {
          const available = stockMap[item.productId] || 0;
          if (available < item.quantity) {
            throw new ApiError(
              400,
              `Insufficient stock for product ${item.productId}`,
            );
          }
        }

        const createdOrders = [];
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000); // 15 mins from now

        for (const vendorId of Object.keys(itemsByVendor)) {
          const vendorItems = itemsByVendor[vendorId];
          if (!vendorItems || vendorItems.length === 0) {
            continue;
          }
          const initialStatus =
            paymentMode === "COD"
              ? OrderStatus.CONFIRMED
              : OrderStatus.PAYMENT_PENDING;

          const vendorTotal = vendorItems.reduce(
            (sum, item) => sum + item.itemTotal,
            0,
          );

          // 3. Create the order
          const order = await tx.order.create({
            data: {
              userId,
              vendorId,
              deliveryPincode: shippingAddress.postalCode,
              shippingFullName: shippingAddress.fullName,
              shippingEmail: shippingAddress.email,
              shippingPhoneNumber: shippingAddress.phoneNumber,
              shippingAddressLine1: shippingAddress.addressLine1,
              shippingAddressLine2: shippingAddress.addressLine2 || null,
              shippingCity: shippingAddress.city,
              shippingState: shippingAddress.state,
              shippingPostalCode: shippingAddress.postalCode,
              totalAmount: vendorTotal,
              status: initialStatus,
              items: {
                create: vendorItems.map((item) => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  price: item.price,
                })),
              },
              events: {
                create: [
                  {
                    status: initialStatus,
                    note:
                      paymentMode === "COD"
                        ? "Order placed with Cash on Delivery. Inventory locked."
                        : "Order placed, payment pending. Inventory locked.",
                  },
                ],
              },
            },
            include: {
              items: true,
            },
          });

          // 4. Decrement Stock & Create Inventory Reservations
          for (const item of vendorItems) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { decrement: item.quantity } },
            });

            await tx.inventoryReservation.create({
              data: {
                orderId: order.id,
                productId: item.productId,
                quantity: item.quantity,
                expiresAt: expirationTime,
                status: "RESERVED",
              },
            });
          }

          createdOrders.push(order);
        }

        return createdOrders;
      },
    );

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

    const updatedOrder = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Update the order
        const updated = await tx.order.update({
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

        return updated;
      },
    );

    // 3. Post-Transition Triggers
    if (newStatus === OrderStatus.PACKED) {
      // Automatically attempt to assign a delivery partner
      // We don't block the response, we catch & log if it fails.
      DeliveryService.assignOrderToPartner(orderId).catch(console.error);
    }

    return updatedOrder;
  }

  static async markReadyForDelivery(orderId: string, vendorUserId: string) {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: vendorUserId },
      select: { id: true },
    });

    if (!vendor) {
      throw new ApiError(403, "Vendor profile not found");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, vendorId: true, status: true },
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.vendorId !== vendor.id) {
      throw new ApiError(403, "You can only handle your own orders");
    }

    return this.updateOrderStatus(
      orderId,
      OrderStatus.PACKED,
      "Vendor marked order ready for delivery pickup",
    );
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

  static async getLastOrderShippingAddress(userId: string) {
    const latestOrder = await prisma.order.findFirst({
      where: { userId },
      select: {
        shippingFullName: true,
        shippingEmail: true,
        shippingPhoneNumber: true,
        shippingAddressLine1: true,
        shippingAddressLine2: true,
        shippingCity: true,
        shippingState: true,
        shippingPostalCode: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestOrder) {
      throw new ApiError(404, "No previous orders found");
    }

    const {
      shippingFullName,
      shippingEmail,
      shippingPhoneNumber,
      shippingAddressLine1,
      shippingAddressLine2,
      shippingCity,
      shippingState,
      shippingPostalCode,
    } = latestOrder;

    if (
      !shippingFullName ||
      !shippingEmail ||
      !shippingPhoneNumber ||
      !shippingAddressLine1 ||
      !shippingCity ||
      !shippingState ||
      !shippingPostalCode
    ) {
      throw new ApiError(
        404,
        "No complete shipping address found in your last order",
      );
    }

    return {
      fullName: shippingFullName,
      email: shippingEmail,
      phoneNumber: shippingPhoneNumber,
      addressLine1: shippingAddressLine1,
      addressLine2: shippingAddressLine2,
      city: shippingCity,
      state: shippingState,
      postalCode: shippingPostalCode,
    };
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
        user: { select: { name: true, email: true, phone: true } },
        items: {
          include: {
            product: {
              select: { name: true, price: true, stock: true, imageUrl: true },
            },
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
