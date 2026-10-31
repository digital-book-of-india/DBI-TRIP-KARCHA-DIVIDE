import { z } from "zod";

export const SignupSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters").max(50),
  email: z.string().email("Invalid email format").toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  termsAccepted: z.boolean().default(true),
});

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export const CreateTripSchema = z.object({
  name: z.string().min(2, "Trip name must be at least 2 characters").max(100),
  destination: z.string().max(100).optional().default(""),
  currency: z.enum(["INR", "USD", "EUR", "GBP", "AED"]).default("INR"),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
}).refine(data => {
  if (data.startDate && data.endDate) {
    return new Date(data.endDate) >= new Date(data.startDate);
  }
  return true;
}, {
  message: "End date must be greater than or equal to start date",
  path: ["endDate"]
});

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;