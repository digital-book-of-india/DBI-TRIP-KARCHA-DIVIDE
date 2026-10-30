/**
 * Split Calculation Engine
 *
 * Provides deterministic split calculations for EQUAL, EXACT, PERCENTAGE, and SHARES split types.
 * Guarantees zero penny loss: sum of all allocations always equals totalAmountMinor exactly.
 */

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface EqualSplitParticipant {
  userId: string;
}

export interface ExactSplitParticipant {
  userId: string;
  amountMinor: number;
}

export interface PercentageSplitParticipant {
  userId: string;
  percentage: number;
}

export interface SharesSplitParticipant {
  userId: string;
  shares: number;
}

export interface SplitAllocationResult {
  userId: string;
  memberId: string; // Alias for backward compatibility
  amountMinor: number;
  percentage?: number;
  shares?: number;
}

export interface GenericSplitInput {
  userId?: string;
  memberId?: string;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

/**
 * Validates that totalAmountMinor is a positive safe integer.
 */
function validateTotalAmountMinor(amount: number): void {
  if (typeof amount !== "number" || !Number.isFinite(amount) || Number.isNaN(amount)) {
    throw new TypeError("Expense amount must be a finite number");
  }

  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("Expense amount must be a safe integer in paise");
  }

  if (amount <= 0) {
    throw new RangeError("Expense amount must be a positive integer in minor units (paise)");
  }
}

/**
 * Validates participant IDs for uniqueness and non-emptiness.
 */
function validateParticipantIds(ids: string[]): void {
  if (!ids || ids.length === 0) {
    throw new Error("At least one participant is required");
  }

  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new Error("Participant ID must be a non-empty string");
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate participant ID rejected: "${id}"`);
    }
    seen.add(id);
  }
}

/**
 * EQUAL Split:
 * Divides amount equally across all participants.
 * Distributes remaining paise deterministically (1 paise each to first `remainder` participants).
 * Total allocations mathematically equals totalAmountMinor.
 */
export function calculateEqualSplit(
  totalAmountMinor: number,
  participantIds: string[]
): SplitAllocationResult[] {
  validateTotalAmountMinor(totalAmountMinor);
  validateParticipantIds(participantIds);

  const count = participantIds.length;
  const baseShare = Math.floor(totalAmountMinor / count);
  const remainder = totalAmountMinor % count;

  return participantIds.map((userId, index) => ({
    userId,
    memberId: userId,
    amountMinor: baseShare + (index < remainder ? 1 : 0),
  }));
}

/**
 * EXACT Split:
 * Accepts explicit allocation amounts in integer paise.
 * Rejects negative allocations.
 * Validates that sum of allocations exactly equals totalAmountMinor.
 */
export function calculateExactSplit(
  totalAmountMinor: number,
  allocations: { userId?: string; memberId?: string; amountMinor: number }[]
): SplitAllocationResult[] {
  validateTotalAmountMinor(totalAmountMinor);

  if (!allocations || allocations.length === 0) {
    throw new Error("At least one participant allocation is required");
  }

  const participantIds = allocations.map((a) => {
    const id = a.userId ?? a.memberId;
    if (!id) throw new Error("Participant must have a userId or memberId");
    return id;
  });
  validateParticipantIds(participantIds);

  let sum = 0;
  for (let i = 0; i < allocations.length; i++) {
    const a = allocations[i];
    const id = participantIds[i];

    if (typeof a.amountMinor !== "number" || !Number.isSafeInteger(a.amountMinor)) {
      throw new TypeError(`Allocation for participant "${id}" must be a safe integer in paise`);
    }

    if (a.amountMinor < 0) {
      throw new RangeError(`Allocation for participant "${id}" cannot be negative (${a.amountMinor})`);
    }

    sum += a.amountMinor;
  }

  if (sum !== totalAmountMinor) {
    throw new Error(
      `Exact allocations total (${sum} paise) does not match expense amount (${totalAmountMinor} paise)`
    );
  }

  return allocations.map((a, i) => ({
    userId: participantIds[i],
    memberId: participantIds[i],
    amountMinor: a.amountMinor,
  }));
}

/**
 * PERCENTAGE Split:
 * Percentages must sum to exactly 100%.
 * Uses Largest Remainder Method (Hamilton Method) to distribute paise deterministically without rounding loss.
 * Guarantees sum of allocations exactly equals totalAmountMinor.
 */
export function calculatePercentageSplit(
  totalAmountMinor: number,
  allocations: { userId?: string; memberId?: string; percentage: number }[]
): SplitAllocationResult[] {
  validateTotalAmountMinor(totalAmountMinor);

  if (!allocations || allocations.length === 0) {
    throw new Error("At least one participant allocation is required");
  }

  const participantIds = allocations.map((a) => {
    const id = a.userId ?? a.memberId;
    if (!id) throw new Error("Participant must have a userId or memberId");
    return id;
  });
  validateParticipantIds(participantIds);

  let totalPercent = 0;
  for (let i = 0; i < allocations.length; i++) {
    const a = allocations[i];
    const id = participantIds[i];

    if (typeof a.percentage !== "number" || !Number.isFinite(a.percentage) || Number.isNaN(a.percentage)) {
      throw new TypeError(`Percentage for participant "${id}" must be a valid finite number`);
    }

    if (a.percentage < 0) {
      throw new RangeError(`Percentage for participant "${id}" cannot be negative (${a.percentage}%)`);
    }

    if (a.percentage > 100) {
      throw new RangeError(`Percentage for participant "${id}" cannot exceed 100% (${a.percentage}%)`);
    }

    totalPercent += a.percentage;
  }

  // Check that percentage sum equals 100% within floating point epsilon
  if (Math.abs(totalPercent - 100) > 0.0001) {
    throw new Error(
      `Percentage allocations must sum to exactly 100%. Current sum: ${Number(totalPercent.toFixed(4))}%`
    );
  }

  // Largest Remainder Method:
  // 1. Calculate unrounded paise for each participant: (totalAmountMinor * percentage) / 100
  // 2. Floor to get base share and calculate fractional remainder.
  // 3. Distribute unallocated paise (1 paise each) to participants with largest remainder fraction.
  const rawShares = allocations.map((a, index) => {
    const raw = (totalAmountMinor * a.percentage) / 100;
    const base = Math.floor(raw);
    const fraction = raw - base;
    return {
      index,
      userId: participantIds[index],
      percentage: a.percentage,
      base,
      fraction,
    };
  });

  const baseSum = rawShares.reduce((acc, curr) => acc + curr.base, 0);
  let remainderPaise = totalAmountMinor - baseSum;

  // Sort by fraction descending; break ties by original index for deterministic stability
  const sortedByFraction = [...rawShares].sort((a, b) => {
    if (b.fraction !== a.fraction) {
      return b.fraction - a.fraction;
    }
    return a.index - b.index;
  });

  const allocatedMap = new Map<number, number>();
  for (const item of sortedByFraction) {
    const bonus = remainderPaise > 0 ? 1 : 0;
    if (bonus > 0) remainderPaise--;
    allocatedMap.set(item.index, item.base + bonus);
  }

  return rawShares.map((item) => ({
    userId: item.userId,
    memberId: item.userId,
    amountMinor: allocatedMap.get(item.index)!,
    percentage: item.percentage,
  }));
}

/**
 * SHARES Split:
 * Calculates allocation proportional to integer shares.
 */
export function calculateSharesSplit(
  totalAmountMinor: number,
  allocations: { userId?: string; memberId?: string; shares: number }[]
): SplitAllocationResult[] {
  validateTotalAmountMinor(totalAmountMinor);

  if (!allocations || allocations.length === 0) {
    throw new Error("At least one participant allocation is required");
  }

  const participantIds = allocations.map((a) => {
    const id = a.userId ?? a.memberId;
    if (!id) throw new Error("Participant must have a userId or memberId");
    return id;
  });
  validateParticipantIds(participantIds);

  let totalShares = 0;
  for (let i = 0; i < allocations.length; i++) {
    const a = allocations[i];
    const id = participantIds[i];

    if (typeof a.shares !== "number" || !Number.isSafeInteger(a.shares)) {
      throw new TypeError(`Shares for participant "${id}" must be a safe integer`);
    }

    if (a.shares < 0) {
      throw new RangeError(`Shares for participant "${id}" cannot be negative (${a.shares})`);
    }

    totalShares += a.shares;
  }

  if (totalShares <= 0) {
    throw new RangeError("Total shares must be greater than zero");
  }

  const rawShares = allocations.map((a, index) => {
    const raw = (totalAmountMinor * a.shares) / totalShares;
    const base = Math.floor(raw);
    const fraction = raw - base;
    return {
      index,
      userId: participantIds[index],
      shares: a.shares,
      base,
      fraction,
    };
  });

  const baseSum = rawShares.reduce((acc, curr) => acc + curr.base, 0);
  let remainderPaise = totalAmountMinor - baseSum;

  const sortedByFraction = [...rawShares].sort((a, b) => {
    if (b.fraction !== a.fraction) {
      return b.fraction - a.fraction;
    }
    return a.index - b.index;
  });

  const allocatedMap = new Map<number, number>();
  for (const item of sortedByFraction) {
    const bonus = remainderPaise > 0 ? 1 : 0;
    if (bonus > 0) remainderPaise--;
    allocatedMap.set(item.index, item.base + bonus);
  }

  return rawShares.map((item) => ({
    userId: item.userId,
    memberId: item.userId,
    amountMinor: allocatedMap.get(item.index)!,
    shares: item.shares,
  }));
}

/**
 * Universal split calculation entry point.
 */
export function calculateSplits(
  totalAmountMinor: number,
  splitType: SplitType,
  participants: GenericSplitInput[]
): SplitAllocationResult[] {
  if (splitType === "EQUAL") {
    const ids = participants.map((p) => {
      const id = p.userId ?? p.memberId;
      if (!id) throw new Error("Participant must have a userId or memberId");
      return id;
    });
    return calculateEqualSplit(totalAmountMinor, ids);
  }

  if (splitType === "EXACT") {
    const formatted = participants.map((p) => ({
      userId: p.userId ?? p.memberId,
      amountMinor: p.amountMinor ?? 0,
    }));
    return calculateExactSplit(totalAmountMinor, formatted);
  }

  if (splitType === "PERCENTAGE") {
    const formatted = participants.map((p) => ({
      userId: p.userId ?? p.memberId,
      percentage: p.percentage ?? 0,
    }));
    return calculatePercentageSplit(totalAmountMinor, formatted);
  }

  if (splitType === "SHARES") {
    const formatted = participants.map((p) => ({
      userId: p.userId ?? p.memberId,
      shares: p.shares ?? 0,
    }));
    return calculateSharesSplit(totalAmountMinor, formatted);
  }

  throw new Error(`Unsupported split type: "${splitType}"`);
}
