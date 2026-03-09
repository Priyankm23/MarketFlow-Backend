import { z } from "zod";

export const addToCartSchema = z.object({
  body: z.object({
    productId: z.string().uuid("Invalid Product ID"),
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
  }),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
  }),
  params: z.object({
    productId: z.string().uuid("Invalid Product ID"),
  })
});

export const removeCartItemSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid Product ID"),
  })
});
