import jwt from "jsonwebtoken";
import { getIntegrationJwtSecret } from "../lib/jwtSecret";

export function signTripKharchaAccessToken(userId: string): string {
  return jwt.sign(
    { typ: "access", aud: "trip-kharcha", userId },
    getIntegrationJwtSecret(),
    { algorithm: "HS256", subject: userId, expiresIn: "7d" }
  );
}
