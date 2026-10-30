import { NextResponse } from "next/server";
import { query, getClient, logActivity } from "@/lib/db";
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

  const memRes = await query(
    "SELECT id, role FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (memRes.rows.length === 0) {
    return NextResponse.json({ success: false, error: "You are not an active member of this trip" }, { status: 403 });
  }

  const member = memRes.rows[0];

  // Prevent last admin from leaving without transferring ownership
  if (member.role === "ADMIN") {
    const adminCount = await query(
      "SELECT count(*) FROM trip_members WHERE trip_id = $1 AND role = 'ADMIN' AND membership_status = 'JOINED'",
      [tripId]
    );
    if (parseInt(adminCount.rows[0].count) <= 1) {
      return NextResponse.json({ success: false, error: "Cannot leave trip as the sole admin. Transfer admin role first." }, { status: 400 });
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE trip_members SET membership_status = 'LEFT' WHERE id = $1", [member.id]);
    await logActivity(client, tripId, auth.userId, "MEMBER_LEFT", auth.userId);
    await client.query("COMMIT");
    return NextResponse.json({ success: true, message: "Successfully left the trip" });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ success: false, error: "Failed to leave trip" }, { status: 500 });
  } finally {
    client.release();
  }
}