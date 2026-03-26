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
}
