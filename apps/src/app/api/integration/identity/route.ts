import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { getIntegrationJwtSecret } from "../../../../lib/jwtSecret";

const MAIN_APP_ID_PATTERN = /^[0-9a-f]{24}$/i;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let identity: jwt.JwtPayload;
  let secret: string;
  try {
    secret = getIntegrationJwtSecret();
  } catch {
    return NextResponse.json({ success: false, error: "Integration authentication is not configured" }, { status: 500 });
  }

  try {
    identity = jwt.verify(match[1], secret, {
      algorithms: ["HS256"],
      audience: "trip-kharcha",
    }) as jwt.JwtPayload;
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (
    identity.typ !== "trip-identity" ||
    typeof identity.sub !== "string" ||
    !MAIN_APP_ID_PATTERN.test(identity.sub) ||
    typeof identity.email !== "string" ||
    !identity.email.trim() ||
    typeof identity.name !== "string" ||
    typeof identity.exp !== "number" ||
    !Number.isInteger(identity.exp) ||
    identity.exp <= Math.floor(Date.now() / 1000)
  ) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const subject = identity.sub;
  const email = identity.email.trim().toLowerCase();
  const name = identity.name.trim();

  try {
    const existingMapping = await prisma.mainAppIdentity.findUnique({
      where: { subject },
      select: { userId: true },
    });
    if (existingMapping) {
      return NextResponse.json({ success: true, data: { userId: existingMapping.userId } });
    }

    const userId = await prisma.$transaction(async (transaction) => {
      const matchingUsers = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM users
        WHERE LOWER(email) = ${email}
        LIMIT 2
      `;
      if (matchingUsers.length > 1) {
        throw Object.assign(new Error("Ambiguous email match"), { code: "IDENTITY_CONFLICT" });
      }
      const existingUser = matchingUsers[0];
      const createdUsers = existingUser ? [] : await transaction.$queryRaw<Array<{ id: string }>>`
        INSERT INTO users (display_name, email, password_hash)
        VALUES (${name}, ${email}, NULL)
        RETURNING id::text AS id
      `;
      const tripUserId = existingUser?.id || createdUsers[0]?.id;
      if (!tripUserId) throw new Error("Trip user could not be created");
      const mapping = await transaction.mainAppIdentity.upsert({
        where: { subject },
        create: { subject, userId: tripUserId },
        update: {},
        select: { userId: true },
      });
      return mapping.userId;
    });

    return NextResponse.json({ success: true, data: { userId } });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2002" || error.code === "IDENTITY_CONFLICT")
    ) {
      return NextResponse.json(
        { success: false, error: "Main application identity conflicts with an existing Trip Kharcha account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: "Unable to resolve user identity" }, { status: 500 });
  }
}