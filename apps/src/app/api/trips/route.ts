import { NextResponse } from "next/server";
import { query, getClient, logActivity } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { CreateTripSchema } from "@/lib/validation";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const sql = `
    SELECT t.id, t.name, t.destination, t.currency, t.status, t.created_at, tm.role
    FROM trips t
    INNER JOIN trip_members tm ON tm.trip_id = t.id
    WHERE tm.user_id = $1 AND tm.membership_status = 'JOINED'
    ORDER BY t.created_at DESC
  `;
  const result = await query(sql, [auth.userId]);
  return NextResponse.json({ success: true, data: { trips: result.rows } });
}

export async function POST(req: Request) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = CreateTripSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { name, destination, currency, startDate, endDate } = parsed.data;

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const tripInsert = `
        INSERT INTO trips (name, destination, start_date, end_date, currency, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const tripRes = await client.query(tripInsert, [
        name.trim(),
        destination,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
        currency,
        auth.userId,
      ]);
      const newTrip = tripRes.rows[0];

      await client.query(
        "INSERT INTO trip_members (trip_id, user_id, role, membership_status) VALUES ($1, $2, 'ADMIN', 'JOINED')",
        [newTrip.id, auth.userId]
      );

      // Audit Event: TRIP_CREATED
      await logActivity(client, newTrip.id, auth.userId, "TRIP_CREATED", newTrip.id, {
        tripName: newTrip.name,
      });

      await client.query("COMMIT");
      return NextResponse.json({ success: true, data: { trip: newTrip } }, { status: 201 });
    } catch (dbErr: unknown) {
      await client.query("ROLLBACK");
      throw dbErr;
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}