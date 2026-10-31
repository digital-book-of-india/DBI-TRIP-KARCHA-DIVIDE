import { NextResponse } from "next/server";
import crypto from "crypto";
import { query, getClient, logActivity } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

// 1. PUBLIC INVITE PREVIEW (NO AUTH REQUIRED)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ success: false, error: "Invite code required" }, { status: 400 });
  }

  const codeHash = crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
  const sql = `
    SELECT t.name as trip_name, t.destination, u.display_name as inviter_name, ti.expires_at, ti.status
    FROM trip_invites ti
    JOIN trips t ON t.id = ti.trip_id
    JOIN users u ON u.id = ti.created_by
    WHERE ti.invite_code_hash = $1
  `;
  const result = await query(sql, [codeHash]);

  if (result.rows.length === 0) {
    return NextResponse.json({ success: false, error: "Invalid invite code" }, { status: 404 });
  }

  const inv = result.rows[0];
  if (inv.status !== "ACTIVE" || new Date() > new Date(inv.expires_at)) {
    return NextResponse.json({ success: false, error: "Invite code has expired" }, { status: 410 });
  }

  // Guardrail: Expose only trip name, destination, and inviter name (no expenses)
  return NextResponse.json({
    success: true,
    data: {
      tripName: inv.trip_name,
      destination: inv.destination,
      inviterName: inv.inviter_name,
    },
  });
}

// 2. AUTHENTICATED JOIN TRIP
export async function POST(req: Request) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { inviteCode } = await req.json();
    if (!inviteCode) {
      return NextResponse.json({ success: false, error: "Invite code is required" }, { status: 400 });
    }

    const codeHash = crypto.createHash("sha256").update(inviteCode.trim().toUpperCase()).digest("hex");
    const invRes = await query(
      "SELECT * FROM trip_invites WHERE invite_code_hash = $1 AND status = 'ACTIVE'",
      [codeHash]
    );

    if (invRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Invalid or expired invite code" }, { status: 404 });
    }

    const invite = invRes.rows[0];
    if (new Date() > new Date(invite.expires_at)) {
      await query("UPDATE trip_invites SET status = 'EXPIRED' WHERE id = $1", [invite.id]);
      return NextResponse.json({ success: false, error: "Invite code has expired" }, { status: 410 });
    }

    const tripRes = await query("SELECT id, name, status FROM trips WHERE id = $1", [invite.trip_id]);
    if (tripRes.rows.length === 0 || tripRes.rows[0].status === "CLOSED") {
      return NextResponse.json({ success: false, error: "Trip is closed or unavailable" }, { status: 400 });
    }
    const trip = tripRes.rows[0];

    // Idempotency: Check existing membership
    const memberCheck = await query(
      "SELECT id, membership_status FROM trip_members WHERE trip_id = $1 AND user_id = $2",
      [trip.id, auth.userId]
    );

    if (memberCheck.rows.length > 0 && memberCheck.rows[0].membership_status === "JOINED") {
      return NextResponse.json({ success: true, message: "Already a member", data: { tripId: trip.id } });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      // Atomic quota increment
      const quotaRes = await client.query(
        "UPDATE trip_invites SET uses_count = uses_count + 1 WHERE id = $1 AND uses_count < max_uses RETURNING uses_count",
        [invite.id]
      );
      if (quotaRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ success: false, error: "Invite code has reached maximum uses" }, { status: 410 });
      }

      if (memberCheck.rows.length > 0) {
        await client.query("UPDATE trip_members SET membership_status = 'JOINED' WHERE id = $1", [memberCheck.rows[0].id]);
      } else {
        await client.query(
          "INSERT INTO trip_members (trip_id, user_id, role, membership_status) VALUES ($1, $2, 'MEMBER', 'JOINED')",
          [trip.id, auth.userId]
        );
      }

      // Audit Event: MEMBER_JOINED
      await logActivity(client, trip.id, auth.userId, "MEMBER_JOINED", auth.userId, {
        tripName: trip.name,
      });

      await client.query("COMMIT");
      return NextResponse.json({
        success: true,
        message: `Successfully joined ${trip.name}`,
        data: { tripId: trip.id, tripName: trip.name },
      });
    } catch (joinErr: any) {
      await client.query("ROLLBACK");
      throw joinErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}