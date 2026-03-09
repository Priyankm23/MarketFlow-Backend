import { z } from "zod";
import { OrderStatus } from "../../../generated/prisma/index.js";

export const checkoutSchema = z.object({
  body: z.object({
    deliveryPincode: z.string().min(4, "Invalid pincode length").max(10, "Invalid pincode length"),
  })
});

export const updateOrderStatusSchema = z.object({
  params: z.object({
    orderId: z.string().uuid("Invalid Order ID"),
  }),
  body: z.object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().optional(),
  })
});
