import { z } from "zod";

export const reviewVendorSchema = z.object({
  body: z.object({
    status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
  }),
  params: z.object({
    vendorId: z.string().uuid(),
  }),
});
