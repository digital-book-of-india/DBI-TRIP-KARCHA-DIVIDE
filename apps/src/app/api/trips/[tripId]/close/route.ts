import { NextResponse } from "next/server";
import { query, getClient, logActivity } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { notifyTripMembers } from "@/lib/notifications/notifyTrip";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  if (!UUID_REGEX.test(tripId)) {
    return NextResponse.json({ success: false, error: "Invalid trip ID format" }, { status: 400 });
  }

  const adminCheck = await query(
    "SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2 AND role = 'ADMIN' AND membership_status = 'JOINED'",
    [tripId, auth.userId]
  );
  if (adminCheck.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Only trip admins can close a trip" }, { status: 403 });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query("UPDATE trips SET status = 'CLOSED' WHERE id = $1 RETURNING *", [tripId]);
    
    // Audit Event: TRIP_CLOSED
    await logActivity(client, tripId, auth.userId, "TRIP_CLOSED", tripId, {
      closedBy: auth.userId,
    });

    await client.query("COMMIT");

    await notifyTripMembers({
      tripId,
      excludeUserId: auth.userId,
      title: "Trip closed",
      message: `${result.rows[0].name} was closed. View the final summary.`,
    });

    return NextResponse.json({ success: true, message: "Trip closed successfully", data: { trip: result.rows[0] } });
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Failed to close trip";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    client.release();
  }
}