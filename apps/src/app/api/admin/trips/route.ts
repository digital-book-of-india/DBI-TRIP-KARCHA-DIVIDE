import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/adminAuth";

/**
 * GET /api/admin/trips
 * Platform-admin-only trip directory for account support (e.g. investigating
 * a report). Returns trip metadata and member/expense counts only — never
 * expense line items or amounts, consistent with the product requirement
 * that admin access to private expense details stays restricted.
 */
export async function GET(req: Request) {
  const auth = await getAuthUser();
  const admin = await requireAdmin(auth);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden: platform admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25));
  const offset = (page - 1) * limit;

  const countResult = await query("SELECT count(*) FROM trips");
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const rows = await query(
    `SELECT
       t.id, t.name, t.destination, t.currency, t.status, t.created_at,
       u.display_name AS creator_name,
       (SELECT count(*) FROM trip_members tm WHERE tm.trip_id = t.id AND tm.membership_status = 'JOINED') AS member_count,
       (SELECT count(*) FROM expenses e WHERE e.trip_id = t.id AND e.is_void = false) AS expense_count
     FROM trips t
     LEFT JOIN users u ON u.id = t.created_by
     ORDER BY t.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return NextResponse.json({
    success: true,
    data: {
      trips: rows.rows.map((t) => ({
        id: t.id,
        name: t.name,
        destination: t.destination,
        currency: t.currency,
        status: t.status,
        creatorName: t.creator_name,
        memberCount: parseInt(t.member_count, 10),
        expenseCount: parseInt(t.expense_count, 10),
        createdAt: t.created_at,
      })),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  });
}
