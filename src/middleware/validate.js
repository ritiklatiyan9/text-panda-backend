// ---------------------------------------------------------------------------
// Request body validation using zod. `validateBody(schema)` returns an Express
// middleware that parses req.body, replaces it with the typed/clean result,
// or responds 400 with readable field errors.
// ---------------------------------------------------------------------------
import { z } from "zod";

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "validation_error",
        details: result.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

// E.164-ish phone number: a leading + and 7–15 digits.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone number must be in E.164 format, e.g. +14155552671");

export const sendOtpSchema = z.object({
  phoneNumber: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phoneNumber: phoneSchema,
  code: z.string().trim().regex(/^\d{4,10}$/, "Code must be 4–10 digits"),
});

export const sendSmsSchema = z.object({
  phoneNumbers: z.array(phoneSchema).min(1, "At least one phone number is required").max(50),
  message: z.string().trim().min(1, "Message cannot be empty").max(1000),
});
