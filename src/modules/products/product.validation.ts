import { z } from "zod";

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Product name must be at least 2 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    price: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Price must be a positive number"),
    stock: z.string().refine((val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0, "Stock must be a non-negative integer"),
    categoryId: z.string().uuid("Invalid Category ID"),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    description: z.string().min(10).optional(),
    price: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0).optional(),
    stock: z.string().refine((val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0).optional(),
    categoryId: z.string().uuid().optional(),
    isActive: z.enum(["true", "false", "true", "false"]).optional() // boolean as string in form-data
  }),
});
