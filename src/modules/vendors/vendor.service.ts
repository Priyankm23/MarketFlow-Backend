import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";

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

export class VendorService {
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
}
