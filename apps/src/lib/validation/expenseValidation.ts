/**
 * Expense Integrity & Membership Validation
 *
 * Implements strict, structured validation for expense creation, editing, and splits.
 * Checks include:
 * 1. amountMinor must be a positive safe integer.
 * 2. Every allocation amount must be a non-negative safe integer.
 * 3. Sum of all allocation amounts must exactly equal amountMinor.
 * 4. No duplicate participant IDs.
 * 5. Payer must be a member of the specified trip.
 * 6. All allocation participants must be members of the specified trip.
 * 7. Split type must be valid (EQUAL, EXACT, PERCENTAGE).
 * 8. Returns structured validation errors.
 */

import { prisma } from "../db";

export const VALID_SPLIT_TYPES = ["EQUAL", "EXACT", "PERCENTAGE"] as const;
export type ValidSplitType = (typeof VALID_SPLIT_TYPES)[number];

export interface StructuredValidationError {
  field: string;
  message: string;
  code:
    | "INVALID_AMOUNT"
    | "INVALID_ALLOCATION_AMOUNT"
    | "ALLOCATION_SUM_MISMATCH"
    | "DUPLICATE_PARTICIPANT"
    | "NOT_A_TRIP_MEMBER"
    | "INVALID_SPLIT_TYPE"
    | "REQUIRED_FIELD"
    | "EMPTY_ALLOCATIONS";
}

export interface ValidationSuccess {
  isValid: true;
  errors: [];
}

export interface ValidationFailure {
  isValid: false;
  errors: StructuredValidationError[];
}

export type ExpenseValidationResult = ValidationSuccess | ValidationFailure;

export class ExpenseValidationError extends Error {
  public readonly errors: StructuredValidationError[];

  constructor(message: string, errors: StructuredValidationError[]) {
    super(message);
    this.name = "ExpenseValidationError";
    this.errors = errors;
  }
}

export interface ExpenseAllocationInput {
  userId: string;
  amountMinor: number;
  percentage?: number;
  shares?: number;
}

export interface ExpenseValidationInput {
  tripId: string;
  payerId: string;
  title?: string;
  category?: string;
  amountMinor: number;
  splitType: string;
  allocations: ExpenseAllocationInput[];
}

export interface ValidationContext {
  /**
   * Set or array of user IDs who are verified members of the trip.
   * Allows membership validation without database queries (pure unit testing).
   */
  tripMemberUserIds?: string[] | Set<string>;
}

/**
 * Validates structural, numerical and split invariants of an expense payload.
 * Pure logic — completely independent from database calls.
 */
export function validateExpenseStructure(input: ExpenseValidationInput): ExpenseValidationResult {
  const errors: StructuredValidationError[] = [];

  // Required field checks
  if (!input.tripId || typeof input.tripId !== "string" || input.tripId.trim() === "") {
    errors.push({
      field: "tripId",
      message: "tripId is required and must be a non-empty string",
      code: "REQUIRED_FIELD",
    });
  }

  if (!input.payerId || typeof input.payerId !== "string" || input.payerId.trim() === "") {
    errors.push({
      field: "payerId",
      message: "payerId is required and must be a non-empty string",
      code: "REQUIRED_FIELD",
    });
  }

  // Check 1: amountMinor must be a positive safe integer
  if (
    typeof input.amountMinor !== "number" ||
    !Number.isFinite(input.amountMinor) ||
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor <= 0
  ) {
    errors.push({
      field: "amountMinor",
      message: `amountMinor must be a positive safe integer. Received: ${input.amountMinor}`,
      code: "INVALID_AMOUNT",
    });
  }

  // Check 7: Split type must be valid
  if (!VALID_SPLIT_TYPES.includes(input.splitType as ValidSplitType)) {
    errors.push({
      field: "splitType",
      message: `splitType must be one of: ${VALID_SPLIT_TYPES.join(", ")}. Received: "${input.splitType}"`,
      code: "INVALID_SPLIT_TYPE",
    });
  }

  // Allocations array validation
  if (!input.allocations || !Array.isArray(input.allocations) || input.allocations.length === 0) {
    errors.push({
      field: "allocations",
      message: "allocations must be a non-empty array with at least one participant",
      code: "EMPTY_ALLOCATIONS",
    });
    return { isValid: false, errors };
  }

  // Check 4: No duplicate participant IDs
  const seenUserIds = new Set<string>();
  let allocationsSum = 0;
  let allAllocationsHaveValidAmounts = true;

  for (let i = 0; i < input.allocations.length; i++) {
    const alloc = input.allocations[i];

    if (!alloc.userId || typeof alloc.userId !== "string" || alloc.userId.trim() === "") {
      errors.push({
        field: `allocations[${i}].userId`,
        message: `Allocation at index ${i} must have a non-empty userId`,
        code: "REQUIRED_FIELD",
      });
    } else {
      if (seenUserIds.has(alloc.userId)) {
        errors.push({
          field: `allocations[${i}].userId`,
          message: `Duplicate participant ID rejected: "${alloc.userId}"`,
          code: "DUPLICATE_PARTICIPANT",
        });
      }
      seenUserIds.add(alloc.userId);
    }

    // Check 2: Every allocation amount must be a non-negative safe integer
    if (
      typeof alloc.amountMinor !== "number" ||
      !Number.isFinite(alloc.amountMinor) ||
      !Number.isSafeInteger(alloc.amountMinor) ||
      alloc.amountMinor < 0
    ) {
      allAllocationsHaveValidAmounts = false;
      errors.push({
        field: `allocations[${i}].amountMinor`,
        message: `Allocation amount for user "${alloc.userId}" must be a non-negative safe integer. Received: ${alloc.amountMinor}`,
        code: "INVALID_ALLOCATION_AMOUNT",
      });
    } else {
      allocationsSum += alloc.amountMinor;
    }
  }

  // Check 3: Sum of all allocation amounts must exactly equal amountMinor
  if (
    typeof input.amountMinor === "number" &&
    Number.isSafeInteger(input.amountMinor) &&
    input.amountMinor > 0 &&
    allAllocationsHaveValidAmounts &&
    allocationsSum !== input.amountMinor
  ) {
    errors.push({
      field: "allocations",
      message: `Sum of allocation amounts (${allocationsSum} paise) does not match expense amount (${input.amountMinor} paise)`,
      code: "ALLOCATION_SUM_MISMATCH",
    });
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}

/**
 * Validates trip membership for payer and all allocation participants.
 * Reuses the Prisma TripMember query or provided membership context.
 */
export async function validateTripMembership(
  tripId: string,
  payerId: string,
  participantUserIds: string[],
  context?: ValidationContext
): Promise<StructuredValidationError[]> {
  const errors: StructuredValidationError[] = [];
  const normalizedTripId = tripId.toString();

  // If in-memory membership context is provided, use it directly (fast, no DB query)
  if (context?.tripMemberUserIds) {
    const memberSet =
      context.tripMemberUserIds instanceof Set
        ? context.tripMemberUserIds
        : new Set(context.tripMemberUserIds.map((id) => id.toString()));

    // Check 5: Payer must be a member of the trip
    if (!memberSet.has(payerId.toString())) {
      errors.push({
        field: "payerId",
        message: `Payer "${payerId}" is not an active member of trip "${normalizedTripId}"`,
        code: "NOT_A_TRIP_MEMBER",
      });
    }

    // Check 6: All allocation participants must be members of the trip
    participantUserIds.forEach((uid, index) => {
      if (!memberSet.has(uid.toString())) {
        errors.push({
          field: `allocations[${index}].userId`,
          message: `Participant "${uid}" is not an active member of trip "${normalizedTripId}"`,
          code: "NOT_A_TRIP_MEMBER",
        });
      }
    });

    return errors;
  }

  // Database membership query using Prisma
  const allUserIdsToCheck = Array.from(new Set([payerId, ...participantUserIds]));

  try {
    const members = await prisma.tripMember.findMany({
      where: {
        tripId: normalizedTripId,
        userId: { in: allUserIdsToCheck },
      },
      select: { userId: true },
    });

    const foundMemberIds = new Set<string>(members.map((m) => m.userId));

    // Check 5: Payer membership
    if (!foundMemberIds.has(payerId.toString())) {
      errors.push({
        field: "payerId",
        message: `Payer "${payerId}" is not an active member of trip "${normalizedTripId}"`,
        code: "NOT_A_TRIP_MEMBER",
      });
    }

    // Check 6: Participants membership
    participantUserIds.forEach((uid, index) => {
      if (!foundMemberIds.has(uid.toString())) {
        errors.push({
          field: `allocations[${index}].userId`,
          message: `Participant "${uid}" is not an active member of trip "${normalizedTripId}"`,
          code: "NOT_A_TRIP_MEMBER",
        });
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database query error";
    throw new Error(`Trip membership verification failed: ${message}`);
  }

  return errors;
}

/**
 * Validates complete expense integrity including mathematical invariants and trip membership.
 */
export async function validateExpenseIntegrity(
  input: ExpenseValidationInput,
  context?: ValidationContext
): Promise<ExpenseValidationResult> {
  const structureResult = validateExpenseStructure(input);
  const errors: StructuredValidationError[] = [...structureResult.errors];

  // If tripId, payerId, and allocations are structurally present, validate membership
  if (
    input.tripId &&
    input.payerId &&
    input.allocations &&
    Array.isArray(input.allocations) &&
    input.allocations.length > 0
  ) {
    const participantIds = input.allocations.map((a) => a.userId).filter(Boolean);
    const membershipErrors = await validateTripMembership(
      input.tripId,
      input.payerId,
      participantIds,
      context
    );
    errors.push(...membershipErrors);
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}

/**
 * Asserts that the expense passes integrity checks; throws ExpenseValidationError if invalid.
 */
export async function assertExpenseIntegrity(
  input: ExpenseValidationInput,
  context?: ValidationContext
): Promise<void> {
  const result = await validateExpenseIntegrity(input, context);
  if (!result.isValid) {
    throw new ExpenseValidationError(
      `Expense integrity check failed with ${result.errors.length} error(s)`,
      result.errors
    );
  }
}
