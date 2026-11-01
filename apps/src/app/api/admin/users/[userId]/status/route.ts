import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/adminAuth";

const VALID_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"];

/**
 * PATCH /api/admin/users/[userId]/status
 * Platform-admin-only account support / abuse-handling action: suspend,
 * reinstate or delete an account. A SUSPENDED or DELETED account is
 * immediately blocked from the login endpoint (which only accepts
 * account_status = 'ACTIVE'). The action is written to an append-only
 * audit record (activity_events) for accountability.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await getAuthUser();
  const admin = await requireAdmin(auth);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden: platform admin access required" }, { status: 403 });
  }

  const { userId } = await params;
  if (!userId || userId.trim().length === 0) {
    return NextResponse.json({ success: false, error: "Invalid user ID" }, { status: 400 });
  }

  let body: { status?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, reason } = body;
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { success: false, error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  if (userId === admin.userId && status !== "ACTIVE") {
    return NextResponse.json(
      { success: false, error: "You cannot suspend or delete your own admin account" },
      { status: 400 }
    );
  }

  const result = await query(
    "UPDATE users SET account_status = $1 WHERE id = $2 RETURNING id, display_name, email, account_status",
    [status, userId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  await query(
    `INSERT INTO activity_events (trip_id, actor_user_id, event_type, entity_id, metadata_json)
     VALUES (NULL, $1, 'ADMIN_USER_STATUS_CHANGED', $2, $3)`,
    [admin.userId, userId, JSON.stringify({ newStatus: status, reason: reason || null, targetUserId: userId })]
  );

  return NextResponse.json({
    success: true,
    message: `User account status updated to ${status}`,
    data: {
      user: {
        id: result.rows[0].id,
        displayName: result.rows[0].display_name,
        email: result.rows[0].email,
        accountStatus: result.rows[0].account_status,
      },
    },
  });
}
