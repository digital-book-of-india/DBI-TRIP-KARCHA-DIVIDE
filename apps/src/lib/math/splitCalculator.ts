export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface SplitInput {
  memberId: string;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

export interface SplitResult {
  memberId: string;
  shareMinor: number;
}

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

  const count = participants.length;
  const sortedParticipants = [...participants].sort((a, b) => a.memberId.localeCompare(b.memberId));

  if (splitType === "EQUAL") {
    const baseShare = Math.floor(totalAmountMinor / count);
    const remainder = totalAmountMinor % count;

    return sortedParticipants.map((p, index) => ({
      memberId: p.memberId,
      shareMinor: baseShare + (index < remainder ? 1 : 0),
    }));
  }

  if (splitType === "EXACT") {
    const sum = participants.reduce((acc, curr) => acc + (curr.amountMinor || 0), 0);
    if (sum !== totalAmountMinor) {
      throw new Error(`Exact shares total (${sum}) does not match expense amount (${totalAmountMinor})`);
    }
    return participants.map((p) => ({
      memberId: p.memberId,
      shareMinor: p.amountMinor || 0,
    }));
  }

  if (splitType === "PERCENTAGE") {
    const totalPercent = participants.reduce((acc, curr) => acc + (curr.percentage || 0), 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      throw new Error("Total percentage must equal 100%");
    }
    let allocatedSum = 0;
    return sortedParticipants.map((p, index) => {
      if (index === count - 1) {
        return { memberId: p.memberId, shareMinor: totalAmountMinor - allocatedSum };
      }
      const share = Math.round((totalAmountMinor * (p.percentage || 0)) / 100);
      allocatedSum += share;
      return { memberId: p.memberId, shareMinor: share };
    });
  }

  if (splitType === "SHARES") {
    const totalShares = participants.reduce((acc, curr) => acc + (curr.shares || 0), 0);
    if (totalShares <= 0) throw new Error("Total shares must be greater than zero");

    let allocatedSum = 0;
    return sortedParticipants.map((p, index) => {
      if (index === count - 1) {
        return { memberId: p.memberId, shareMinor: totalAmountMinor - allocatedSum };
      }
      const share = Math.floor((totalAmountMinor * (p.shares || 0)) / totalShares);
      allocatedSum += share;
      return { memberId: p.memberId, shareMinor: share };
    });
  }

  throw new Error("Unsupported split type");
}
