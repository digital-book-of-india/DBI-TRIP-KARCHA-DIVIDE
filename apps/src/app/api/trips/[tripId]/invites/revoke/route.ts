import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { UUID_REGEX } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID" }, { status: 400 });
  }

  const adminCheck = await query(
    "SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND role = 'ADMIN' AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (adminCheck.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Only trip admins can revoke invites" }, { status: 403 });
  }

  const { inviteId } = await req.json();
  if (!inviteId) {
    return NextResponse.json({ success: false, error: "inviteId is required" }, { status: 400 });
  }

  await query("UPDATE trip_invites SET status = 'REVOKED' WHERE id = $1 AND trip_id = $2", [inviteId, tripId]);
  return NextResponse.json({ success: true, message: "Invite code revoked successfully" });
}