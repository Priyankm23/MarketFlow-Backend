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
