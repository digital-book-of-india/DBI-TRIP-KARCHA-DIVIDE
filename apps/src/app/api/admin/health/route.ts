import { NextResponse } from "next/server";
import { query, prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin/adminAuth";

/**
 * GET /api/admin/health
 * Platform-admin-only operational snapshot: database connectivity, account
 * and trip volume, and notification delivery health (the PDF spec explicitly
 * calls out "notification health" as part of the platform admin role, plus
 * monitoring push failures / DB capacity before launch).
 */
export async function GET() {
  const auth = await getAuthUser();
  const admin = await requireAdmin(auth);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden: platform admin access required" }, { status: 403 });
  }

  let dbConnected = true;
  try {
    await query("SELECT 1");
  } catch {
    dbConnected = false;
  }

  const [userCount, activeUserCount, tripCount, activeTripCount] = await Promise.all([
    query("SELECT count(*) FROM users"),
    query("SELECT count(*) FROM users WHERE account_status = 'ACTIVE'"),
    query("SELECT count(*) FROM trips"),
    query("SELECT count(*) FROM trips WHERE status = 'ACTIVE'"),
  ]);

  const [notificationStats, pendingSettlements, disputedSettlements] = await Promise.all([
    prisma.notification.groupBy({
      by: ["deliveryStatus"],
      _count: { _all: true },
    }),
    prisma.settlement.count({ where: { status: "PENDING" } }),
    prisma.settlement.count({ where: { status: "DISPUTED" } }),
  ]);

  const notificationBreakdown: Record<string, number> = {};
  for (const row of notificationStats) {
    notificationBreakdown[row.deliveryStatus || "UNKNOWN"] = row._count._all;
  }

  return NextResponse.json({
    success: true,
    data: {
      database: { connected: dbConnected },
      users: {
        total: parseInt(userCount.rows[0].count, 10),
        active: parseInt(activeUserCount.rows[0].count, 10),
      },
      trips: {
        total: parseInt(tripCount.rows[0].count, 10),
        active: parseInt(activeTripCount.rows[0].count, 10),
      },
      notifications: {
        byDeliveryStatus: notificationBreakdown,
        failedCount: notificationBreakdown["FAILED"] || 0,
      },
      settlements: {
        pending: pendingSettlements,
        disputed: disputedSettlements,
      },
      checkedAt: new Date().toISOString(),
    },
  });
}
