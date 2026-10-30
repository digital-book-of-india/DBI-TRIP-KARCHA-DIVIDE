import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;

  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID format" }, { status: 400 });
  }

  const checkMember = await query(
    "SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );

  if (checkMember.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Access denied. You are not a member of this trip." }, { status: 403 });
  }

  const tripRes = await query("SELECT * FROM trips WHERE id = $1", [tripId]);
  if (tripRes.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Trip not found" }, { status: 404 });
  }

  const membersRes = await query(
    `SELECT tm.id as member_id, u.id as user_id, u.display_name, u.email, tm.role, tm.joined_at
     FROM trip_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.trip_id = $1 AND tm.membership_status = 'JOINED'
     ORDER BY tm.joined_at ASC`,
    [tripId]
  );

  return NextResponse.json({
    success: true,
    data: {
      trip: tripRes.rows[0],
      currentUserRole: checkMember.rows[0].role,
      members: membersRes.rows.map((m) => ({
        memberId: m.member_id,
        userId: m.user_id,
        displayName: m.display_name,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    },
  });
}