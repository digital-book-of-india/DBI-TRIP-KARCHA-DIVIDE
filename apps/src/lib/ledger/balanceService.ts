import prisma from "../prisma";
import { computeTripBalances } from "./balanceEngine";
import {
  TripMemberInfo,
  LedgerExpenseItem,
  LedgerSettlementItem,
} from "../../types/ledger";

export interface GetTripBalancesResult {
  tripId: string;
  tripName: string;
  currency: string;
  totalTripExpenseMinor: number;
  totalTripExpense: number;
  isSettled: boolean;
  balances: Array<{
    memberId: string;
    userId: string;
    name: string;
    email?: string;
    avatarUrl?: string | null;
    totalPaidMinor: number;
    totalPaid: number;
    totalPersonalShareMinor: number;
    totalPersonalShare: number;
    confirmedSentMinor: number;
    confirmedSent: number;
    confirmedReceivedMinor: number;
    confirmedReceived: number;
    netBalanceMinor: number;
    netBalance: number;
  }>;
  suggestedTransfers: Array<{
    fromMemberId: string;
    fromMemberName?: string;
    toMemberId: string;
    toMemberName?: string;
    amountMinor: number;
    amount: number;
  }>;
}

export async function getTripBalances(
  tripId: string,
  requestingUserId?: string
): Promise<GetTripBalancesResult> {
  // 1. Fetch Trip details
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, name: true, currency: true },
  });

  if (!trip) {
    const error: any = new Error(`Trip with ID '${tripId}' not found`);
    error.status = 404;
    throw error;
  }

  // 2. Fetch all Members
  const members = await prisma.tripMember.findMany({
    where: { tripId },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Authorization Check: Requesting user must be a member of this trip
  if (requestingUserId) {
    const isMember = members.some((m) => m.userId === requestingUserId);
    if (!isMember) {
      const error: any = new Error("Access Denied: You are not a member of this trip");
      error.status = 403;
      throw error;
    }
  }

  // 3. Fetch all ACTIVE Expenses & Allocations
  const expenses = await prisma.expense.findMany({
    where: {
      tripId,
      status: "ACTIVE",
    },
    include: {
      allocations: true,
    },
  });

  // 4. Fetch all CONFIRMED Settlements
  const settlements = await prisma.settlement.findMany({
    where: {
      tripId,
      status: "CONFIRMED",
    },
  });

  // 5. Map data into the Pure Ledger Engine format
  const ledgerMembers: TripMemberInfo[] = members.map((m) => ({
    id: m.id,
    name: m.user?.displayName || "Member",
  }));

  const ledgerExpenses: LedgerExpenseItem[] = expenses.map((exp) => ({
    id: exp.id,
    title: exp.title,
    amountMinor: Number(exp.amountMinor),
    paidByMemberId: exp.paidByMemberId || "",
    status: (exp.status as "ACTIVE" | "VOIDED") || "ACTIVE",
    allocations: exp.allocations.map((a) => ({
      tripMemberId: a.tripMemberId || "",
      shareMinor: Number(a.shareMinor),
    })),
  }));

  const ledgerSettlements: LedgerSettlementItem[] = settlements.map((st) => ({
    id: st.id,
    fromMemberId: st.fromMemberId,
    toMemberId: st.toMemberId,
    amountMinor: Number(st.amountMinor),
    status: (st.status as "PENDING" | "CONFIRMED" | "DISPUTED") || "CONFIRMED",
  }));

  // 6. Execute Authoritative Ledger Balance Calculation
  const summary = computeTripBalances({
    tripId,
    currency: trip.currency || "INR",
    members: ledgerMembers,
    expenses: ledgerExpenses,
    settlements: ledgerSettlements,
  });

  // Map user metadata (avatar, email, formatted amounts)
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const enrichedBalances = summary.balances.map((b) => {
    const memberObj = memberMap.get(b.memberId);
    return {
      memberId: b.memberId,
      userId: memberObj?.userId || "",
      name: b.name || memberObj?.user?.displayName || "Member",
      email: memberObj?.user?.email,
      avatarUrl: memberObj?.user?.avatarUrl,
      totalPaidMinor: b.totalPaidMinor,
      totalPaid: b.totalPaidMinor / 100,
      totalPersonalShareMinor: b.totalPersonalShareMinor,
      totalPersonalShare: b.totalPersonalShareMinor / 100,
      confirmedSentMinor: b.confirmedSentMinor,
      confirmedSent: b.confirmedSentMinor / 100,
      confirmedReceivedMinor: b.confirmedReceivedMinor,
      confirmedReceived: b.confirmedReceivedMinor / 100,
      netBalanceMinor: b.netBalanceMinor,
      netBalance: b.netBalanceMinor / 100,
    };
  });

  const enrichedTransfers = summary.suggestedTransfers.map((t) => ({
    fromMemberId: t.fromMemberId,
    fromMemberName: t.fromMemberName,
    toMemberId: t.toMemberId,
    toMemberName: t.toMemberName,
    amountMinor: t.amountMinor,
    amount: t.amountMinor / 100,
  }));

  return {
    tripId: trip.id,
    tripName: trip.name,
    currency: trip.currency || "INR",
    totalTripExpenseMinor: summary.totalTripExpenseMinor,
    totalTripExpense: summary.totalTripExpenseMinor / 100,
    isSettled: summary.isSettled,
    balances: enrichedBalances,
    suggestedTransfers: enrichedTransfers,
  };
}

