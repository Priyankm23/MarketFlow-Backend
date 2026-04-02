import { z } from "zod";
import { OrderStatus } from "../../../generated/prisma/index.js";

const paymentModeSchema = z.enum(["ONLINE", "COD"]);

const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().email("Invalid email address"),
  phoneNumber: z.string().trim().min(7, "Invalid phone number").max(10),
  addressLine1: z.string().trim().min(3, "Address Line 1 is required").max(180),
  addressLine2: z.string().trim().max(180).optional(),
  city: z.string().trim().min(2, "City is required").max(80),
  state: z.string().trim().min(2, "State is required").max(80),
  postalCode: z
    .string()
    .trim()
    .min(4, "Invalid postal code length")
    .max(12, "Invalid postal code length")
    .regex(/^[A-Za-z0-9 -]+$/, "Invalid postal code format"),
});

export const checkoutSchema = z.object({
  body: z.object({
    shippingAddress: shippingAddressSchema,
    paymentMode: paymentModeSchema.default("ONLINE"),
    platformFee: z.coerce
      .number()
      .refine((value) => value === 29, "Platform fee must be 29"),
    deliveryFee: z.coerce.number().min(0, "Delivery fee cannot be negative"),
    gst: z.coerce.number().min(0, "GST cannot be negative"),
    offerDiscount: z.coerce
      .number()
      .min(0, "Offer discount cannot be negative"),
  }),
});

export const updateOrderStatusSchema = z.object({
  params: z.object({
    orderId: z.string().uuid("Invalid Order ID"),
  }),
  body: z.object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().optional(),
  }),
});

export const vendorMarkReadySchema = z.object({
  params: z.object({
    orderId: z.string().uuid("Invalid Order ID"),
  }),
});
