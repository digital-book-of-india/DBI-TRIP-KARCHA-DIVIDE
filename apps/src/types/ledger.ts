export interface TripMemberInfo {
  id: string;
  name: string;
}

export interface ExpenseAllocationItem {
  tripMemberId: string;
  shareMinor: number; // in paise
}

export interface LedgerExpenseItem {
  id: string;
  title: string;
  amountMinor: number; // in paise
  paidByMemberId: string;
  status: "ACTIVE" | "VOIDED";
  allocations: ExpenseAllocationItem[];
}

export interface LedgerSettlementItem {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number; // in paise
  status: "PENDING" | "CONFIRMED" | "DISPUTED";
}

export interface MemberNetBalance {
  memberId: string;
  name?: string;
  totalPaidMinor: number;       // Kitna jeb se diya
  totalPersonalShareMinor: number; // Kiska kitna banta tha
  confirmedSentMinor: number;   // Kitne paise settle karke bhej chuka hai
  confirmedReceivedMinor: number; // Kitne paise settlement ke mil chuke hain
  netBalanceMinor: number;      // Net balance (+ve = will receive, -ve = owes, 0 = settled)
}

export interface SuggestedTransfer {
  fromMemberId: string;
  fromMemberName?: string;
  toMemberId: string;
  toMemberName?: string;
  amountMinor: number;
}

export interface TripBalanceSummary {
  tripId: string;
  currency: string;
  totalTripExpenseMinor: number;
  balances: MemberNetBalance[];
  suggestedTransfers: SuggestedTransfer[];
  isSettled: boolean;
}

