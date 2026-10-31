import {
  calculateEqualSplit,
  calculateExactSplit,
  calculatePercentageSplit,
  calculateSharesSplit,
  calculateSplits as engineCalculateSplits,
} from "../splits/splitEngine";

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface SplitInput {
  memberId: string;
  userId?: string;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

export interface SplitResult {
  memberId: string;
  userId?: string;
  shareMinor: number;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

export {
  calculateEqualSplit,
  calculateExactSplit,
  calculatePercentageSplit,
  calculateSharesSplit,
};

export function calculateSplits(
  totalAmountMinor: number,
  splitType: SplitType,
  participants: SplitInput[]
): SplitResult[] {
  if (totalAmountMinor <= 0) {
    throw new Error("Amount must be a positive integer in minor units (paise)");
  }
  if (!participants || participants.length === 0) {
    throw new Error("At least one participant is required");
  }

  const results = engineCalculateSplits(totalAmountMinor, splitType, participants);

  return results.map((r) => ({
    memberId: r.memberId,
    userId: r.userId,
    shareMinor: r.amountMinor,
    amountMinor: r.amountMinor,
    percentage: r.percentage,
    shares: r.shares,
  }));
}
