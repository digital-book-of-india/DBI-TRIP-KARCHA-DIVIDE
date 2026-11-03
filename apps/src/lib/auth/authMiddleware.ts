import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { getIntegrationJwtSecret } from "../jwtSecret";

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  name?: string;
}

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
 * Verifies a short-lived access token minted by the main application's gateway.
 *
 * Returns null if authentication is missing or token is invalid.
 */
export async function getAuthenticatedUser(request: Pick<Request, "headers"> | NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (!token) return null;

    const secret = getIntegrationJwtSecret();
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        audience: "trip-kharcha",
      });
      if (
        typeof decoded === "string" ||
        decoded.typ !== "access" ||
        typeof decoded.userId !== "string" ||
        !isValidId(decoded.userId) ||
        typeof decoded.sub !== "string" ||
        !isValidId(decoded.sub) ||
        typeof decoded.exp !== "number" ||
        !Number.isInteger(decoded.exp) ||
        decoded.exp <= Math.floor(Date.now() / 1000)
      ) {
        return null;
      }

      return { userId: decoded.userId };
    } catch {
      return null;
    }
  }

  return null;
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
