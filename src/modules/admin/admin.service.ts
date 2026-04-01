import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";

export class AdminService {
  static async getPendingVendors() {
    return prisma.vendor.findMany({
      where: { status: "PENDING" },
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    });
  }

  static async getApprovedVendors() {
    return prisma.vendor.findMany({
      where: { status: "APPROVED" },
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    });
  }

  static async reviewVendor(
    vendorId: string,
    status: "APPROVED" | "REJECTED" | "SUSPENDED",
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    if (!vendor) {
      throw new ApiError(404, "Vendor not found");
    }

    const updatedVendor = await prisma.$transaction(async (tx: any) => {
      const v = await tx.vendor.update({
        where: { id: vendorId },
        data: { status },
      });

      if (status === "APPROVED") {
        await tx.user.update({
          where: { id: v.userId },
          data: { role: "VENDOR" },
        });
      }

      return v;
    });

    return updatedVendor;
  }

  static async getAnalytics() {
    const lowStockThreshold = 5;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalVendors,
      vendorStatusGroups,
      totalProducts,
      lowStockProducts,
      totalOrders,
      ordersByStatusGroups,
      paymentSum,
      ordersToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.product.count(),
      prisma.product.count({ where: { stock: { lt: lowStockThreshold } } }),
      prisma.order.count(),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: "SUCCESS" },
      }),
      prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
    ]);

    const vendorStatusCounts: Record<string, number> = {};
    for (const g of vendorStatusGroups) {
      // @ts-ignore
      vendorStatusCounts[g.status] = g._count._all ?? 0;
    }

    const ordersByStatus: Record<string, number> = {};
    for (const g of ordersByStatusGroups) {
      // @ts-ignore
      ordersByStatus[g.status] = g._count._all ?? 0;
    }

    const totalRevenue = paymentSum._sum?.amount
      ? paymentSum._sum.amount.toString()
      : "0";

    return {
      totalUsers,
      totalVendors,
      vendorStatusCounts,
      totalProducts,
      lowStockProducts,
      totalOrders,
      ordersByStatus,
      totalRevenue,
      ordersToday,
      lowStockThreshold,
    };
  }
}
