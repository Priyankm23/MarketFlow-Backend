import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { OrderStatus, Prisma } from "../../../generated/prisma/index.js";
import { redis } from "../../config/redis.js";

export class DeliveryService {
  private static pickupOtpKey(orderId: string) {
    return `delivery:pickup-otp:${orderId}`;
  }

  private static pickupOtpAttemptsKey(orderId: string) {
    return `delivery:pickup-otp-attempts:${orderId}`;
  }

  private static generateFourDigitOtp() {
    return `${Math.floor(1000 + Math.random() * 9000)}`;
  }
  private static extractPincode(value: string) {
    const match = value.match(/\b\d{6}\b/);
    return match ? match[0] : value.trim();
  }

  private static hasPincodeCoverage(
    coveragePincodes: string[],
    targetPincode: string,
  ) {
    return coveragePincodes.some(
      (coverage) => this.extractPincode(coverage) === targetPincode,
    );
  }

  private static normalizeText(value?: string | null) {
    return (value ?? "").trim().toLowerCase();
  }

  private static isInterCity(
    vendorCity?: string | null,
    customerCity?: string | null,
  ) {
    return this.normalizeText(vendorCity) !== this.normalizeText(customerCity);
  }

  private static estimatePickupEtaMinutes(activeDeliveries: number) {
    return Math.min(60, 15 + activeDeliveries * 5);
  }

  private static startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private static startOfWeek(date: Date) {
    const start = this.startOfDay(date);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    return start;
  }

  private static formatDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private static sumDeliveryFees(
    events: Array<{ order: { deliveryFee: unknown } }>,
  ) {
    return events.reduce(
      (sum, event) => sum + Number(event.order.deliveryFee ?? 0),
      0,
    );
  }

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

  static async generatePickupOtp(orderId: string, vendorUserId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        vendor: {
          select: {
            userId: true,
          },
        },
        status: true,
        deliveryPartnerId: true,
      },
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.vendor?.userId !== vendorUserId) {
      throw new ApiError(403, "You are not authorized to generate OTP");
    }

    if (!order.deliveryPartnerId) {
      throw new ApiError(400, "Order has not been assigned to a partner");
    }

    if (order.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new ApiError(
        400,
        "OTP can only be generated for READY_FOR_PICKUP orders",
      );
    }

    const otp = this.generateFourDigitOtp();
    const ttlSeconds = 10 * 60;
    const key = this.pickupOtpKey(orderId);
    const attemptsKey = this.pickupOtpAttemptsKey(orderId);

    await redis.set(key, otp, "EX", ttlSeconds);
    await redis.del(attemptsKey);

    return {
      otp,
      expiresInSeconds: ttlSeconds,
    };
  }

  static async getPartnerDashboard(userId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId },
      select: {
        id: true,
        dailyCapacity: true,
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    const now = new Date();
    const todayStart = this.startOfDay(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(todayStart.getDate() - 1);
    const weekStart = this.startOfWeek(now);
    const lookbackStart = new Date(todayStart);
    lookbackStart.setDate(todayStart.getDate() - 29);

    const [todayEvents, yesterdayEvents, weekEvents, recentEvents] =
      await Promise.all([
        prisma.orderEvent.findMany({
          where: {
            status: OrderStatus.DELIVERED,
            createdAt: { gte: todayStart, lt: now },
            order: { deliveryPartnerId: partner.id },
          },
          select: {
            order: { select: { deliveryFee: true } },
            createdAt: true,
          },
        }),
        prisma.orderEvent.findMany({
          where: {
            status: OrderStatus.DELIVERED,
            createdAt: { gte: yesterdayStart, lt: todayStart },
            order: { deliveryPartnerId: partner.id },
          },
          select: {
            order: { select: { deliveryFee: true } },
            createdAt: true,
          },
        }),
        prisma.orderEvent.findMany({
          where: {
            status: OrderStatus.DELIVERED,
            createdAt: { gte: weekStart, lt: now },
            order: { deliveryPartnerId: partner.id },
          },
          select: {
            order: { select: { deliveryFee: true } },
            createdAt: true,
          },
        }),
        prisma.orderEvent.findMany({
          where: {
            status: OrderStatus.DELIVERED,
            createdAt: { gte: lookbackStart, lt: now },
            order: { deliveryPartnerId: partner.id },
          },
          select: {
            order: { select: { deliveryFee: true } },
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    const todayEarnings = this.sumDeliveryFees(todayEvents);
    const yesterdayEarnings = this.sumDeliveryFees(yesterdayEvents);
    const weekToDateEarnings = this.sumDeliveryFees(weekEvents);

    const growthPercentage =
      yesterdayEarnings > 0
        ? Number(
            (
              ((todayEarnings - yesterdayEarnings) / yesterdayEarnings) *
              100
            ).toFixed(2),
          )
        : 0;

    const recentTotalFees = this.sumDeliveryFees(recentEvents);
    const avgDeliveryFee =
      recentEvents.length > 0 ? recentTotalFees / recentEvents.length : 0;
    const dailyTarget = Math.round(avgDeliveryFee * partner.dailyCapacity);

    const deliveredDates = new Set(
      recentEvents.map((event) => this.formatDateKey(event.createdAt)),
    );

    let activeStreakDays = 0;
    for (let offset = 0; offset < 30; offset += 1) {
      const date = new Date(todayStart);
      date.setDate(todayStart.getDate() - offset);
      if (!deliveredDates.has(this.formatDateKey(date))) {
        break;
      }
      activeStreakDays += 1;
    }

    return {
      earnings: {
        today: Number(todayEarnings.toFixed(2)),
        dailyTarget,
        weekToDate: Number(weekToDateEarnings.toFixed(2)),
        growthPercentage,
      },
      performance: {
        ordersCompletedToday: todayEvents.length,
        averageRating: 0,
        activeStreakDays,
      },
    };
  }

  static async getCoveragePincodes(userId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId },
      select: {
        coveragePincodes: true,
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    return partner.coveragePincodes;
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
  static async assignOrderToPartner(
    orderId: string,
    excludePartnerId?: string,
    stage: "PICKUP" | "LAST_MILE" = "PICKUP",
  ) {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Get the Order
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          vendor: {
            select: {
              pincode: true,
              city: true,
            },
          },
        },
      });

      if (!order) throw new ApiError(404, "Order not found");

      if (order.status !== OrderStatus.PACKED) {
        throw new ApiError(
          400,
          "Order must be PACKED before assigning a delivery partner.",
        );
      }

      if (order.deliveryPartnerId) {
        return {
          success: true,
          message: "Order is already assigned to a delivery partner",
          partnerId: order.deliveryPartnerId,
        };
      }

      const targetPincode =
        stage === "LAST_MILE"
          ? order.shippingPostalCode || order.deliveryPincode
          : order.vendor.pincode;

      if (!targetPincode) {
        throw new ApiError(400, "Target pincode unavailable for assignment");
      }

      // 2. Locality Match: Find partners and then match by parsed pincode
      const potentialPartners = await tx.deliveryPartner.findMany({
        where: {
          ...(excludePartnerId
            ? {
                id: {
                  not: excludePartnerId,
                },
              }
            : {}),
        },
      });

      // 3. Constraint Check: Filter out partners at or over capacity
      const availablePartners = potentialPartners.filter(
        (p: any) =>
          p.activeDeliveries < p.dailyCapacity &&
          this.hasPincodeCoverage(p.coveragePincodes, targetPincode),
      );

      if (availablePartners.length === 0) {
        // Fallback Mechanism: +1 day ETA extension if all busy (or no coverage)
        // We log this as an OrderEvent and keep the order in PACKED state to retry later.
        await tx.orderEvent.create({
          data: {
            orderId,
            status: OrderStatus.PACKED,
            note:
              stage === "LAST_MILE"
                ? "No nearby free last-mile partner found for customer location. Will retry assignment."
                : "No nearby free pickup partner found for vendor location. Will retry assignment.",
          },
        });

        return {
          success: false,
          message: "No partners available. ETA extended.",
        };
      }

      // 4. Proximity & Load Balance: Sort by those with the lowest active deliveries first
      availablePartners.sort(
        (a: any, b: any) => a.activeDeliveries - b.activeDeliveries,
      );

      const selectedPartner = availablePartners[0];
      if (!selectedPartner) {
        throw new ApiError(500, "Failed to select a delivery partner");
      }

      const pickupEtaMinutes = this.estimatePickupEtaMinutes(
        selectedPartner.activeDeliveries,
      );

      // 5. Assignment: Link partner to order and wait for partner acceptance
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryPartnerId: selectedPartner.id,
        },
      });

      await tx.deliveryPartner.update({
        where: { id: selectedPartner.id },
        data: { activeDeliveries: { increment: 1 } },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          status: OrderStatus.PACKED,
          note: `[${stage}] Task assigned to delivery partner (ID: ${selectedPartner.id}) and waiting for acceptance. Estimated pickup ETA: ${pickupEtaMinutes} minutes.`,
        },
      });

      return {
        success: true,
        message:
          stage === "LAST_MILE"
            ? "Last-mile task assigned and waiting for partner acceptance"
            : "Pickup task assigned and waiting for partner acceptance",
        partnerId: selectedPartner.id,
        pickupEtaMinutes,
        stage,
      };
    });
  }

  static async getAssignedTasks(partnerUserId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId: partnerUserId },
      select: {
        id: true,
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    return prisma.order.findMany({
      where: {
        deliveryPartnerId: partner.id,
        status: OrderStatus.PACKED,
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true,
              },
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

  static async getCurrentDeliveries(partnerUserId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId: partnerUserId },
      select: {
        id: true,
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    return prisma.order.findMany({
      where: {
        deliveryPartnerId: partner.id,
        status: OrderStatus.READY_FOR_PICKUP,
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true,
              },
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

  static async getDeliveredToday(partnerUserId: string) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId: partnerUserId },
      select: {
        id: true,
      },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    const now = new Date();
    const todayStart = this.startOfDay(now);

    return prisma.order.findMany({
      where: {
        deliveryPartnerId: partner.id,
        status: OrderStatus.DELIVERED,
        events: {
          some: {
            status: OrderStatus.DELIVERED,
            createdAt: { gte: todayStart, lt: now },
          },
        },
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true,
              },
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

  static async respondToAssignment(
    orderId: string,
    partnerUserId: string,
    accept: boolean,
  ) {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const partner = await tx.deliveryPartner.findUnique({
          where: { userId: partnerUserId },
        });

        if (!partner) {
          throw new ApiError(404, "Delivery partner profile not found");
        }

        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            deliveryPartnerId: true,
          },
        });

        if (!order) {
          throw new ApiError(404, "Order not found");
        }

        if (order.deliveryPartnerId !== partner.id) {
          throw new ApiError(403, "You are not assigned to this order");
        }

        if (order.status !== OrderStatus.PACKED) {
          throw new ApiError(
            400,
            "This task is no longer waiting for delivery partner response",
          );
        }

        const latestEvent = await tx.orderEvent.findFirst({
          where: { orderId },
          orderBy: { createdAt: "desc" },
        });

        const stage: "PICKUP" | "LAST_MILE" = latestEvent?.note?.includes(
          "[LAST_MILE]",
        )
          ? "LAST_MILE"
          : "PICKUP";

        if (accept) {
          const pickupEtaMinutes = this.estimatePickupEtaMinutes(
            partner.activeDeliveries,
          );

          await tx.order.update({
            where: { id: orderId },
            data: {
              status:
                stage === "LAST_MILE"
                  ? OrderStatus.OUT_FOR_DELIVERY
                  : OrderStatus.READY_FOR_PICKUP,
            },
          });

          await tx.orderEvent.create({
            data: {
              orderId,
              status:
                stage === "LAST_MILE"
                  ? OrderStatus.OUT_FOR_DELIVERY
                  : OrderStatus.READY_FOR_PICKUP,
              note:
                stage === "LAST_MILE"
                  ? `[LAST_MILE] Delivery partner accepted the task. Customer delivery ETA: ${pickupEtaMinutes} minutes.`
                  : `[PICKUP] Delivery partner accepted the task. Pickup ETA: ${pickupEtaMinutes} minutes.`,
            },
          });

          return {
            accepted: true,
            pickupEtaMinutes,
            stage,
          };
        }

        await tx.order.update({
          where: { id: orderId },
          data: {
            deliveryPartnerId: null,
          },
        });

        if (partner.activeDeliveries > 0) {
          await tx.deliveryPartner.update({
            where: { id: partner.id },
            data: {
              activeDeliveries: { decrement: 1 },
            },
          });
        }

        await tx.orderEvent.create({
          data: {
            orderId,
            status: OrderStatus.PACKED,
            note: `[${stage}] Delivery partner rejected the task (ID: ${partner.id}). Reassigning to another partner.`,
          },
        });

        return {
          accepted: false,
          rejectedPartnerId: partner.id,
          stage,
        };
      },
    );

    if (result.accepted) {
      return {
        success: true,
        message:
          result.stage === "LAST_MILE"
            ? "Last-mile task accepted. Order is out for delivery."
            : "Pickup task accepted. Vendor can prepare for pickup.",
        pickupEtaMinutes: result.pickupEtaMinutes,
        stage: result.stage,
      };
    }

    const reassigned = await this.assignOrderToPartner(
      orderId,
      result.rejectedPartnerId,
      result.stage,
    );

    return {
      success: true,
      message: "Task rejected and reassignment attempted",
      reassigned,
    };
  }

  static async verifyPickupOtp(
    orderId: string,
    partnerUserId: string,
    otp: string,
  ) {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { userId: partnerUserId },
      select: { id: true },
    });

    if (!partner) {
      throw new ApiError(404, "Delivery partner profile not found");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        deliveryPartnerId: true,
      },
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.deliveryPartnerId !== partner.id) {
      throw new ApiError(403, "You are not assigned to this order");
    }

    if (order.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new ApiError(400, "Order is not awaiting pickup verification");
    }

    if (!otp || !/^[0-9]{4}$/.test(otp)) {
      throw new ApiError(400, "OTP must be a 4 digit code");
    }

    const key = this.pickupOtpKey(orderId);
    const attemptsKey = this.pickupOtpAttemptsKey(orderId);

    const storedOtp = await redis.get(key);
    if (!storedOtp) {
      throw new ApiError(400, "OTP expired or not generated");
    }

    if (storedOtp !== otp) {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) {
        await redis.expire(attemptsKey, 10 * 60);
      }

      if (attempts >= 5) {
        await redis.del(key);
        throw new ApiError(400, "OTP attempts exceeded. Generate a new OTP");
      }

      throw new ApiError(400, "Invalid OTP");
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });

    await prisma.orderEvent.create({
      data: {
        orderId,
        status: OrderStatus.OUT_FOR_DELIVERY,
        note: "[PICKUP] Package handoff verified via OTP.",
      },
    });

    await redis.del(key);
    await redis.del(attemptsKey);

    return {
      success: true,
      message: "Pickup verified. Order is out for delivery.",
    };
  }

  /**
   * Called by the delivery partner when they successfully deliver the item.
   */
  static async completeDelivery(orderId: string, partnerUserId: string) {
    return prisma
      .$transaction(async (tx: Prisma.TransactionClient) => {
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

        const orderWithRoute = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            vendor: {
              select: {
                city: true,
              },
            },
          },
        });

        if (!orderWithRoute) {
          throw new ApiError(404, "Order not found");
        }

        const interCity = this.isInterCity(
          orderWithRoute.vendor.city,
          orderWithRoute.shippingCity,
        );

        // Pickup leg completion for inter-city orders
        if (interCity && order.status === OrderStatus.READY_FOR_PICKUP) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              status: OrderStatus.READY_FOR_PICKUP,
              note: "[PICKUP] Parcel picked up from vendor.",
            },
          });

          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              status: OrderStatus.OUT_FOR_DELIVERY,
              note: "[LINEHAUL] Parcel is in inter-city transit.",
            },
          });

          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              status: OrderStatus.OUT_FOR_DELIVERY,
              note: "[LINEHAUL] Parcel reached destination city hub.",
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PACKED,
              deliveryPartnerId: null,
            },
          });

          await tx.deliveryPartner.update({
            where: { id: partner.id },
            data: { activeDeliveries: { decrement: 1 } },
          });

          return {
            success: true,
            message:
              "Pickup completed and shipment moved to inter-city transit. Last-mile assignment will start.",
            interCity: true,
            needsLastMileAssignment: true,
          };
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
      })
      .then(async (result: unknown) => {
        if (
          result &&
          typeof result === "object" &&
          "needsLastMileAssignment" in result &&
          result.needsLastMileAssignment
        ) {
          const reassigned = await this.assignOrderToPartner(
            orderId,
            undefined,
            "LAST_MILE",
          );

          return {
            ...result,
            reassigned,
          };
        }

        return result;
      });
  }
}
