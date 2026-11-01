import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { UUID_REGEX } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rateLimit";
import { notifyUsersIndividually } from "@/lib/notifications/notifyTrip";

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

  // Optional: invite a specific friend by email. If they already have an
  // account, notify them immediately ("Trip invitation" in the PDF spec's
  // notification table). If not, they will only learn about the trip when
  // they open the shared link, same as before -- there is no account to
  // notify yet.
  let inviteeEmail: string | undefined;
  try {
    const body = await req.json();
    if (body?.inviteeEmail && typeof body.inviteeEmail === "string") {
      inviteeEmail = body.inviteeEmail.trim().toLowerCase();
    }
  } catch {
    // Body is optional for this endpoint.
  }

  // High-entropy 12 bytes = 24 hex chars (96 bits of security)
  const rawCode = crypto.randomBytes(12).toString("hex").toUpperCase();
  const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const result = await query(
    `INSERT INTO trip_invites (trip_id, invite_code_hash, invitee_email, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, $5, 50) RETURNING id, expires_at`,
    [tripId, codeHash, inviteeEmail || null, auth.userId, expiresAt]
  );

  if (inviteeEmail) {
    const inviterRes = await query("SELECT display_name FROM users WHERE id = $1", [auth.userId]);
    const tripRes = await query("SELECT name FROM trips WHERE id = $1", [tripId]);
    const inviteeRes = await query("SELECT id FROM users WHERE LOWER(email) = $1 AND account_status = 'ACTIVE'", [inviteeEmail]);
    if (inviteeRes.rows.length > 0) {
      const inviterName = inviterRes.rows[0]?.display_name || "A friend";
      const tripName = tripRes.rows[0]?.name || "a trip";
      await notifyUsersIndividually(
        [{ userId: inviteeRes.rows[0].id, message: `${inviterName} invited you to ${tripName}. Join to view and add expenses.` }],
        "Trip invitation"
      );
    }
  }

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