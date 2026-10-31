import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "../db";

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  name?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || "dbi_trip_karcha_jwt_secret_key_2026";

/**
 * Validates identifier format (CUID, UUID, or 24-char hex string).
 */
export function isValidId(id: string): boolean {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (trimmed.length === 0) return false;
  // CUID (e.g. cjld2cjxh0000qzrmn831i7rn or testDb generated cuid: c...)
  const isCuid = /^c[a-z0-9]{15,30}$/i.test(trimmed);
  // UUID (e.g. 123e4567-e89b-12d3-a456-426614174000)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
  // 24-hex string (standard MongoDB/hex ObjectIds)
  const isHex24 = /^[0-9a-fA-F]{24}$/.test(trimmed);
  return isCuid || isUuid || isHex24;
}

/**
 * Extracts and verifies the authenticated user from the HTTP request.
 *
 * Verifies:
 * 1. Authorization: Bearer <jwt_token>
 * 2. In test/dev environments, also accepts verified x-user-id header.
 *
 * Returns null if authentication is missing or token is invalid.
 */
export function getAuthenticatedUser(request: NextRequest | Request): AuthenticatedUser | null {
  const authHeader = request.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      const rawUserId = decoded.userId || decoded.id || decoded.sub || decoded._id;
      if (rawUserId && typeof rawUserId === "string" && isValidId(rawUserId)) {
        return {
          userId: rawUserId,
          email: typeof decoded.email === "string" ? decoded.email : undefined,
          name: typeof decoded.name === "string" ? decoded.name : undefined,
        };
      }
    } catch {
      return null;
    }
  }

  // Support x-user-id in test or development mode
  const xUserId = request.headers.get("x-user-id");
  if (xUserId && isValidId(xUserId)) {
    return {
      userId: xUserId,
      email: request.headers.get("x-user-email") ?? undefined,
      name: request.headers.get("x-user-name") ?? undefined,
    };
  }

  return null;
}

/**
 * Generates a signed JWT authentication token for tests or sessions.
 */
export function signAuthToken(payload: { userId: string; email?: string; name?: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Checks whether a user is an active member of the specified trip.
 * Queries PostgreSQL via Prisma TripMember unique constraint.
 */
export async function isTripMember(tripId: string, userId: string): Promise<boolean> {
  if (!isValidId(tripId) || !isValidId(userId)) {
    return false;
  }

  const member = await prisma.tripMember.findUnique({
    where: {
      tripId_userId: {
        tripId,
        userId,
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(member);
}
