import jwt from "jsonwebtoken";
import { getJwtSecret } from "../lib/jwtSecret";

export function signMainAppAccessToken(userId: string): string {
  return jwt.sign(
    { role: "USER", typ: "access" },
    getJwtSecret(),
    { algorithm: "HS256", subject: userId, expiresIn: "7d" }
  );
}
