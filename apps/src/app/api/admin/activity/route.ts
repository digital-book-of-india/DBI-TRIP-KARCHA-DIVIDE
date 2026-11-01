import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/adminAuth";

/**
 * GET /api/admin/activity
 * Platform-wide, paginated audit trail (trip creation, membership changes,
 * closures, and admin actions). Platform-admin-only: the PDF spec requires
 * that access to this kind of cross-trip record stay restricted and
 * auditable, so this endpoint itself is gated by requireAdmin and every
 * admin action that writes an activity_events row (see
 * /api/admin/users/[userId]/status) is itself visible here.
 */
export async function GET(req: Request) {
  const auth = await getAuthUser();
  const admin = await requireAdmin(auth);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden: platform admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const eventType = searchParams.get("eventType");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (eventType) {
    params.push(eventType);
    conditions.push(`event_type = $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query(`SELECT count(*) FROM activity_events ${whereClause}`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  params.push(limit, offset);
  const rows = await query(
    `SELECT ae.id, ae.trip_id, ae.actor_user_id, ae.event_type, ae.entity_id, ae.metadata_json, ae.created_at,
            u.display_name AS actor_name, t.name AS trip_name
     FROM activity_events ae
     LEFT JOIN users u ON u.id = ae.actor_user_id
     LEFT JOIN trips t ON t.id = ae.trip_id
     ${whereClause}
     ORDER BY ae.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return NextResponse.json({
    success: true,
    data: {
      events: rows.rows.map((e) => ({
        id: e.id,
        tripId: e.trip_id,
        tripName: e.trip_name,
        actorUserId: e.actor_user_id,
        actorName: e.actor_name,
        eventType: e.event_type,
        entityId: e.entity_id,
        metadata: e.metadata_json,
        createdAt: e.created_at,
      })),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  });
}
