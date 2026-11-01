import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/adminAuth";

/**
 * GET /api/admin/users
 * Platform-admin-only directory of accounts, for account support and abuse
 * handling. Supports ?search= (name/email) and ?status=ACTIVE|SUSPENDED|DELETED,
 * plus ?page=&limit= pagination.
 */
export async function GET(req: Request) {
  const auth = await getAuthUser();
  const admin = await requireAdmin(auth);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden: platform admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(display_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`account_status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query(`SELECT count(*) FROM users ${whereClause}`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  params.push(limit, offset);
  const rows = await query(
    `SELECT id, display_name, email, account_status, is_platform_admin, created_at
     FROM users ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return NextResponse.json({
    success: true,
    data: {
      users: rows.rows.map((u) => ({
        id: u.id,
        displayName: u.display_name,
        email: u.email,
        accountStatus: u.account_status,
        isPlatformAdmin: u.is_platform_admin,
        createdAt: u.created_at,
      })),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  });
}
