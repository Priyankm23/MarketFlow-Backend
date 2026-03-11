import { prisma } from "../db/prisma.js";

export const runInventoryCleanup = async () => {
  try {
    const expiredReservations = await prisma.inventoryReservation.findMany({
      where: {
        status: "RESERVED",
        expiresAt: { lt: new Date() },
      },
    });

    if (expiredReservations.length === 0) {
      return;
    }

    console.log(
      `[Inventory Cleanup] Found ${expiredReservations.length} expired reservations. Running rollback...`,
    );

    // We process each order cancellation inside a transaction.
    // However, reservations could span multiple orders. Let's group by orderId.
    const orderIds = [...new Set(expiredReservations.map((r) => r.orderId))];

    for (const orderId of orderIds) {
      try {
        await prisma.$transaction(async (tx) => {
          // 1. Get the order
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { inventoryReservations: true },
          });

          if (!order) return;

          // If the order was explicitly paid/confirmed/delivered, the stock is permanently theirs.
          // We mark the reservation as CONFIRMED.
          const successStatuses = [
            "PAID",
            "CONFIRMED",
            "PACKED",
            "READY_FOR_PICKUP",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
          ];
          if (successStatuses.includes(order.status)) {
            await tx.inventoryReservation.updateMany({
              where: { orderId: orderId, status: "RESERVED" },
              data: { status: "CONFIRMED" },
            });
            return;
          }

          // If the order is explicitly CANCELLED or REFUNDED already,
          // we don't want to double-increment the stock. We just mark the reservation as EXPIRED.
          if (order.status === "CANCELLED" || order.status === "REFUNDED") {
            await tx.inventoryReservation.updateMany({
              where: { orderId: orderId, status: "RESERVED" },
              data: { status: "EXPIRED" },
            });
            return;
          }

          // At this point, the order MUST be PAYMENT_PENDING or CREATED and unpaid. Roll it back.
          const resToRollback = await tx.inventoryReservation.findMany({
            where: { orderId: orderId, status: "RESERVED" },
          });

          // Restore stock
          for (const res of resToRollback) {
            await tx.product.update({
              where: { id: res.productId },
              data: { stock: { increment: res.quantity } },
            });

            // Mark reservation as expired
            await tx.inventoryReservation.update({
              where: { id: res.id },
              data: { status: "EXPIRED" },
            });
          }

          // Cancel the order
          if (order.status !== "CANCELLED") {
            await tx.order.update({
              where: { id: orderId },
              data: { status: "CANCELLED" },
            });

            await tx.orderEvent.create({
              data: {
                orderId,
                status: "CANCELLED",
                note: "Automatically cancelled due to payment timeout (inventory released)",
              },
            });
          }
        });

        console.log(
          `[Inventory Cleanup] Successfully rolled back & cancelled order: ${orderId}`,
        );
      } catch (err) {
        console.error(
          `[Inventory Cleanup] Failed to process order: ${orderId}`,
          err,
        );
      }
    }
  } catch (error) {
    console.error("[Inventory Cleanup] Global error:", error);
  }
};

// // If run directly:
// if (require.main === module) {
//   runInventoryCleanup().then(() => process.exit(0));
// }
