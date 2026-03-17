import { z } from "zod";

// Because we're using multipart/form-data, the inputs will come as strings in req.body.
// We only validate the text fields here. Files are checked by the controller manually.
export const registerVendorBaseSchema = z.object({
  body: z.object({
    businessName: z
      .string()
      .min(3, "Business name must be at least 3 characters"),
    storeCategory: z.string().min(2, "Store category is required"),
    taxId: z.string().optional(),
    addressLine1: z.string().min(5, "Address Line 1 is required"),
    addressLine2: z.string().optional(),
    city: z.string().min(2, "City is required"),
    state: z.string().min(2, "State is required"),
    country: z.string().min(2, "Country is required"),
    pincode: z.string().min(4, "Invalid pincode length"),
  }),
});

export const updateVendorProductStockSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid product ID"),
  }),
  body: z.object({
    action: z.enum(["increment", "decrement"]),
    quantity: z.coerce
      .number()
      .refine(
        (value) => Number.isInteger(value) && value > 0,
        "Quantity must be a positive integer",
      ),
  }),
});

export const updateVendorProductDetailsSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid product ID"),
  }),
  body: z
    .object({
      name: z
        .string()
        .min(2, "Product name must be at least 2 characters")
        .optional(),
      description: z
        .string()
        .min(10, "Description must be at least 10 characters")
        .optional(),
      price: z.coerce
        .number()
        .positive("Price must be a positive number")
        .optional(),
    })
    .refine(
      (body) =>
        body.name !== undefined ||
        body.description !== undefined ||
        body.price !== undefined,
      {
        message:
          "At least one field (name, description, price) must be provided for update",
      },
    ),
});

export const addVendorProductImagesSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid product ID"),
  }),
  body: z.object({}).strict(),
});

export const createVendorProductOfferSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid product ID"),
  }),
  body: z.object({
    offerName: z.string().min(2, "Offer name must be at least 2 characters"),
    discountPercentage: z.coerce
      .number()
      .int("Discount percentage must be an integer")
      .min(1, "Discount percentage must be at least 1")
      .max(100, "Discount percentage cannot exceed 100"),
    couponCode: z
      .string()
      .trim()
      .min(3, "Coupon code must be at least 3 characters")
      .max(30, "Coupon code cannot exceed 30 characters")
      .optional(),
    termsAndConditions: z
      .string()
      .trim()
      .max(1000, "Terms and conditions cannot exceed 1000 characters")
      .optional(),
    isActive: z.coerce.boolean().optional(),
  }),
});

export const getVendorProductOffersSchema = z.object({
  params: z.object({
    productId: z.string().uuid("Invalid product ID"),
  }),
});
