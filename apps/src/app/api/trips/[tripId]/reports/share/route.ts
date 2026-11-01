import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { UUID_REGEX } from "@/lib/validation";

/**
 * POST /api/trips/[tripId]/reports/share
 * Creates (or refreshes) an unguessable, time-limited public share link for
 * this trip's settlement summary card -- the PDF spec's "Optional branded
 * settlement summary card that users choose to share" growth feature. Only
 * the summary (totals, per-person net balances) is ever exposed publicly;
 * individual expense line items and member emails are never included (see
 * GET /api/share/[shareCode]).
 */
export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID format" }, { status: 400 });
  }

  const memberCheck = await query(
    "SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (memberCheck.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Only trip members can share this trip" }, { status: 403 });
  }

  const shareCode = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await query("UPDATE trips SET share_code = $1, share_expires_at = $2 WHERE id = $3", [shareCode, expiresAt, tripId]);

  return NextResponse.json({
    success: true,
    data: {
      shareCode,
      shareUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/share/${shareCode}`,
      expiresAt,
    },
  });
}

/**
 * DELETE /api/trips/[tripId]/reports/share
 * Revokes the current share link.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID format" }, { status: 400 });
  }

  const memberCheck = await query(
    "SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (memberCheck.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Only trip members can revoke this trip's share link" }, { status: 403 });
  }

  await query("UPDATE trips SET share_code = NULL, share_expires_at = NULL WHERE id = $1", [tripId]);
  return NextResponse.json({ success: true, message: "Share link revoked" });
}
