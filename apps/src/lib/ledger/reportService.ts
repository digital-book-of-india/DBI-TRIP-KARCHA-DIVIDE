import prisma from "../prisma";
import { getTripBalances } from "./balanceService";

export interface CategorySummary {
  category: string;
  totalMinor: number;
  total: number;
  percentage: number;
  expenseCount: number;
}

export interface MemberSpendSummary {
  memberId: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  totalPaidMinor: number;
  totalPaid: number;
  totalPersonalShareMinor: number;
  totalPersonalShare: number;
  netBalanceMinor: number;
  netBalance: number;
  status: "SETTLED" | "OWES" | "RECEIVES";
}

export interface TripReportResult {
  summaryCard: {
    tripId: string;
    tripName: string;
    destination?: string | null;
    currency: string;
    status: string;
    totalSpentMinor: number;
    totalSpent: number;
    totalExpensesCount: number;
    totalMembersCount: number;
    isFullySettled: boolean;
    settlementProgressPercentage: number;
  };
  categories: CategorySummary[];
  perPerson: MemberSpendSummary[];
}

/**
 * Generates comprehensive trip analytics:
 * 1. Category breakdown (stay, travel, food, tickets, shopping, other) with totals & percentages.
 * 2. Per-person spending (who paid what vs who consumed what).
 * 3. High-level Summary Card for sharing/exporting.
 */
export async function getTripReports(
  tripId: string,
  actorUserId: string
): Promise<TripReportResult> {
  // 1. Fetch trip and verify membership
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, displayName: true, avatarUrl: true, email: true },
          },
        },
      },
    },
  });

  if (!trip) {
    const error: any = new Error("Trip not found");
    error.status = 404;
    throw error;
  }

  const isMember = trip.members.some((m) => m.userId === actorUserId);
  if (!isMember) {
    const error: any = new Error("Forbidden: You are not a member of this trip");
    error.status = 403;
    throw error;
  }

  // 2. Fetch all ACTIVE expenses
  const expenses = await prisma.expense.findMany({
    where: {
      tripId,
      status: "ACTIVE",
    },
  });

  // 3. Category Breakdown Calculation
  const categoryMap = new Map<string, { totalMinor: number; count: number }>();
  let totalSpentMinor = 0;

  for (const exp of expenses) {
    const amount = Number(exp.amountMinor);
    totalSpentMinor += amount;

    const cat = (exp.category || "other").toLowerCase();
    const current = categoryMap.get(cat) || { totalMinor: 0, count: 0 };
    current.totalMinor += amount;
    current.count += 1;
    categoryMap.set(cat, current);
  }

  const categories: CategorySummary[] = Array.from(categoryMap.entries())
    .map(([category, data]) => {
      const percentage =
        totalSpentMinor > 0
          ? Math.round((data.totalMinor / totalSpentMinor) * 10000) / 100
          : 0;
      return {
        category,
        totalMinor: data.totalMinor,
        total: data.totalMinor / 100,
        percentage,
        expenseCount: data.count,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  // 4. Per-Person Balances from Ledger Engine
  const balancesResult = await getTripBalances(tripId, actorUserId);

  const perPerson: MemberSpendSummary[] = balancesResult.balances.map((b) => {
    let status: "SETTLED" | "OWES" | "RECEIVES" = "SETTLED";
    if (b.netBalanceMinor < 0) status = "OWES";
    else if (b.netBalanceMinor > 0) status = "RECEIVES";

    return {
      memberId: b.memberId,
      userId: b.userId,
      name: b.name,
      avatarUrl: b.avatarUrl,
      totalPaidMinor: b.totalPaidMinor,
      totalPaid: b.totalPaid,
      totalPersonalShareMinor: b.totalPersonalShareMinor,
      totalPersonalShare: b.totalPersonalShare,
      netBalanceMinor: b.netBalanceMinor,
      netBalance: b.netBalance,
      status,
    };
  });

  // 5. Settlement Progress
  const totalSettlements = await prisma.settlement.findMany({
    where: { tripId },
  });

  const confirmedSettlements = totalSettlements.filter((s) => s.status === "CONFIRMED");
  const confirmedAmountMinor = confirmedSettlements.reduce(
    (sum, s) => sum + Number(s.amountMinor),
    0
  );

  // Total debt that needed to be settled = sum of all positive net balances before any confirmed settlements
  const totalCreditedMinor = perPerson.reduce((acc, p) => {
    // Original debt was personal share - paid, or what creditors were owed
    return acc + (p.netBalanceMinor > 0 ? p.netBalanceMinor : 0);
  }, 0);

  const totalToClear = totalCreditedMinor + confirmedAmountMinor;
  const settlementProgressPercentage =
    totalToClear > 0
      ? Math.min(100, Math.round((confirmedAmountMinor / totalToClear) * 100))
      : 100;

  return {
    summaryCard: {
      tripId: trip.id,
      tripName: trip.name,
      destination: trip.destination,
      currency: trip.currency || "INR",
      status: trip.status || "ACTIVE",
      totalSpentMinor,
      totalSpent: totalSpentMinor / 100,
      totalExpensesCount: expenses.length,
      totalMembersCount: trip.members.length,
      isFullySettled: balancesResult.isSettled,
      settlementProgressPercentage: balancesResult.isSettled ? 100 : settlementProgressPercentage,
    },
    categories,
    perPerson,
  };
}

