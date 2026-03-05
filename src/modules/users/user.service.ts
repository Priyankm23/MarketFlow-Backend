import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";

export class UserService {
  static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return user;
  }

  static async updateProfile(
    userId: string,
    data: { name?: string; phone?: string },
  ) {
    if (data.phone) {
      const existingPhone = await prisma.user.findUnique({
        where: { phone: data.phone },
      });
      if (existingPhone && existingPhone.id !== userId) {
        throw new ApiError(
          400,
          "Phone number is already in use by another account",
        );
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
      },
    });

    return updatedUser;
  }
}
