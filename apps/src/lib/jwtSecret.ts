// Single source of truth for the JWT signing/verification secret.
//
// BUG FIX: auth.ts and auth/authMiddleware.ts previously each hardcoded their
// own *different* fallback secret. When JWT_SECRET was not set in the
// environment, tokens signed at login (via auth.ts) would fail verification
// on every expense/settlement/balance/notification/report route (which
// verified via authMiddleware.ts's different fallback secret), breaking
// authentication across the whole API. Both modules now import this value.
export const JWT_SECRET: string =
  process.env.JWT_SECRET || "dbi-trip-karcha-divide-secret-key-2026";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.warn(
    "[security] JWT_SECRET is not set in production. Falling back to an insecure default secret."
  );
}
