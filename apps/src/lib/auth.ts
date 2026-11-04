/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./jwtSecret";

export interface AuthUser {
  userId: string;
  email?: string;
}

/**
 * Extracts authenticated user from request:
 * 1. Bearer Token in `Authorization` header
 * 2. `x-user-id` header (for internal testing / seed scripts)
 */
export function getAuthenticatedUser(req: NextRequest): AuthUser | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded && (decoded.userId || decoded.id || decoded.sub)) {
        return {
          userId: decoded.userId || decoded.id || decoded.sub,
          email: decoded.email,
        };
      }
    } catch {
      return null;
    }
  }

  // SECURITY: the x-user-id bypass is for local/test/dev use only. It must
  // never be honored in production, or any caller could impersonate any user.
  if (process.env.NODE_ENV !== "production") {
    const devUserId = req.headers.get("x-user-id");
    if (devUserId) {
      return { userId: devUserId };
    }
  }

  return null;
}

/**
 * Extracts authenticated user from Next.js server context without requiring a request parameter:
 * Used by Developer 1 routes.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const reqHeaders = await headers();
  const authHeader = reqHeaders.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded && (decoded.userId || decoded.id || decoded.sub)) {
        return {
          userId: decoded.userId || decoded.id || decoded.sub,
          email: decoded.email,
        };
      }
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const devUserId = reqHeaders.get("x-user-id");
    if (devUserId) {
      return { userId: devUserId };
    }
  }

  return null;
}

export function signToken(payload: { userId: string; email?: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
