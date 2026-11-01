import { NextResponse } from "next/server";
import { query, prisma } from "@/lib/db";

/**
 * GET /api/share/[shareCode]
 * Public, unauthenticated endpoint for a trip's shared settlement summary
 * card (see POST /api/trips/[tripId]/reports/share). Deliberately returns
 * only aggregate totals and each member's first name + net balance status --
 * never individual expense line items, emails, or other private data,
 * consistent with the product's privacy requirements.
 */
export async function GET(req: Request, { params }: { params: Promise<{ shareCode: string }> }) {
  const { shareCode } = await params;
  if (!shareCode || !/^[0-9a-f]{32}$/i.test(shareCode)) {
    return NextResponse.json({ success: false, error: "Invalid share code" }, { status: 400 });
  }

  const tripRes = await query(
    "SELECT id, name, destination, currency, status FROM trips WHERE share_code = $1 AND (share_expires_at IS NULL OR share_expires_at > NOW())",
    [shareCode]
  );
  if (tripRes.rows.length === 0) {
    return NextResponse.json({ success: false, error: "This share link is invalid or has expired" }, { status: 404 });
  }
  const trip = tripRes.rows[0];

  const [expenses, members] = await Promise.all([
    prisma.expense.findMany({ where: { tripId: trip.id, isVoid: false }, select: { amountMinor: true } }),
    prisma.tripMember.findMany({
      where: { tripId: trip.id },
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  const totalSpentMinor = expenses.reduce((sum, e) => sum + e.amountMinor, 0);

  return NextResponse.json({
    success: true,
    data: {
      tripName: trip.name,
      destination: trip.destination,
      currency: trip.currency,
      totalSpent: totalSpentMinor / 100,
      totalExpenses: expenses.length,
      memberCount: members.length,
      memberFirstNames: members.map((m) => (m.user?.displayName || "Member").split(" ")[0]),
    },
  });
}
