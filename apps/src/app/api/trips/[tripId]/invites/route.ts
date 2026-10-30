import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { UUID_REGEX } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID format" }, { status: 400 });
  }

  const { allowed } = checkRateLimit(`invite_${auth.userId}`, 20, 60000);
  if (!allowed) {
    return NextResponse.json({ success: false, error: "Rate limit exceeded. Please wait a moment." }, { status: 429 });
  }

  const tripCheck = await query("SELECT status FROM trips WHERE id = $1", [tripId]);
  if (tripCheck.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Trip not found" }, { status: 404 });
  }
  if (tripCheck.rows[0].status === "CLOSED") {
    return NextResponse.json({ success: false, error: "Cannot create invites for a closed trip" }, { status: 400 });
  }

  const checkMember = await query(
    "SELECT id, role FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (checkMember.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Only trip members can create invite codes" }, { status: 403 });
  }

  // High-entropy 12 bytes = 24 hex chars (96 bits of security)
  const rawCode = crypto.randomBytes(12).toString("hex").toUpperCase();
  const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const result = await query(
    `INSERT INTO trip_invites (trip_id, invite_code_hash, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, 50) RETURNING id, expires_at`,
    [tripId, codeHash, auth.userId, expiresAt]
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        inviteId: result.rows[0].id,
        inviteCode: rawCode,
        expiresAt: result.rows[0].expires_at,
        joinUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/trips/join?code=${rawCode}`,
      },
    },
    { status: 201 }
  );
}