import type {
  TripMemberInfo,
  LedgerExpenseItem,
  LedgerSettlementItem,
  MemberNetBalance,
  TripBalanceSummary,
} from "../../types/ledger";
import { simplifyDebts } from "./debtSimplifier";

export interface ComputeBalancesOptions {
  tripId: string;
  currency?: string;
  members: TripMemberInfo[];
  expenses: LedgerExpenseItem[];
  settlements: LedgerSettlementItem[];
}

/**
 * Computes authoritative net balances for all trip members based on:
 * - Active Expenses
 * - Confirmed Settlements
 * 
 * Formula:
 * Net Balance = (Total Paid - Total Personal Share) + (Confirmed Sent - Confirmed Received)
 * 
 * Rules:
 * 1. VOIDED expenses are completely ignored.
 * 2. Only CONFIRMED settlements adjust balances. PENDING and DISPUTED are ignored for net balance.
 * 3. Enforces Zero-Sum Rule: sum(Net Balances) === 0.
 */
export function computeTripBalances({
  tripId,
  currency = "INR",
  members,
  expenses,
  settlements,
}: ComputeBalancesOptions): TripBalanceSummary {
  // Initialize ledger record for each member
  const balanceMap = new Map<string, MemberNetBalance>();

  for (const member of members) {
    balanceMap.set(member.id, {
      memberId: member.id,
      name: member.name,
      totalPaidMinor: 0,
      totalPersonalShareMinor: 0,
      confirmedSentMinor: 0,
      confirmedReceivedMinor: 0,
      netBalanceMinor: 0,
    });
  }

  let totalTripExpenseMinor = 0;

  // 1. Process Expenses (Only ACTIVE ones)
  for (const exp of expenses) {
    if (exp.status !== "ACTIVE") {
      continue;
    }

    totalTripExpenseMinor += exp.amountMinor;

    // Credit the payer
    const payer = balanceMap.get(exp.paidByMemberId);
    if (payer) {
      payer.totalPaidMinor += exp.amountMinor;
    }

    // Debit each participant according to allocations
    for (const alloc of exp.allocations) {
      const participant = balanceMap.get(alloc.tripMemberId);
      if (participant) {
        participant.totalPersonalShareMinor += alloc.shareMinor;
      }
    }
  }

  // 2. Process Settlements (Only CONFIRMED ones)
  for (const st of settlements) {
    if (st.status !== "CONFIRMED") {
      // PENDING or DISPUTED do not adjust ledger
      continue;
    }

    // Sender paid money -> reduces debt or increases credit
    const sender = balanceMap.get(st.fromMemberId);
    if (sender) {
      sender.confirmedSentMinor += st.amountMinor;
    }

    // Receiver received money -> reduces receivable
    const receiver = balanceMap.get(st.toMemberId);
    if (receiver) {
      receiver.confirmedReceivedMinor += st.amountMinor;
    }
  }

  // 3. Calculate Final Net Balance for each member
  const balances: MemberNetBalance[] = [];
  let sumOfAllNets = 0;

  for (const record of balanceMap.values()) {
    record.netBalanceMinor =
      record.totalPaidMinor -
      record.totalPersonalShareMinor +
      (record.confirmedSentMinor - record.confirmedReceivedMinor);

    sumOfAllNets += record.netBalanceMinor;
    balances.push(record);
  }

  // 4. Validate Zero-Sum Rule
  if (sumOfAllNets !== 0) {
    throw new Error(
      `Ledger Invariant Violation: Sum of all member net balances must be zero, but got ${sumOfAllNets} paise.`
    );
  }

  // 5. Generate simplified debt settlements ("Who owes whom")
  const suggestedTransfers = simplifyDebts(balances);

  const isSettled = suggestedTransfers.length === 0;

  return {
    tripId,
    currency,
    totalTripExpenseMinor,
    balances,
    suggestedTransfers,
    isSettled,
  };
}
