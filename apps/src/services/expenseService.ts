import { prisma } from "../lib/db";
import { Prisma, SplitType } from "@prisma/client";
import {
  calculateEqualSplit,
  calculateExactSplit,
  calculatePercentageSplit,
  SplitAllocationResult,
} from "../lib/splits/splitEngine";
import { isTripMember, isValidId } from "../lib/auth/authMiddleware";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface RawAllocationInput {
  userId: string;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

export interface CreateExpenseParams {
  requestingUserId: string;
  tripId: string;
  title: string;
  amountMinor: number;
  category: string;
  payerId: string;
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE";
  allocations: RawAllocationInput[];
  _testFailurePoint?: "after_expense" | "after_allocations" | "during_audit";
}

export interface CreatedExpenseData {
  expenseId: string;
  tripId: string;
  payerId: string;
  title: string;
  amountMinor: number;
  category: string;
  splitType: string;
  version: number;
  isVoid: boolean;
  allocations: {
    userId: string;
    amountMinor: number;
    percentage?: number;
    shares?: number;
  }[];
  createdAt: Date;
}

export interface EditExpenseParams {
  requestingUserId: string;
  expenseId: string;
  version: number;
  title?: string;
  amountMinor?: number;
  category?: string;
  payerId?: string;
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE";
  allocations?: RawAllocationInput[];
  _testFailurePoint?: "after_update" | "after_allocations" | "during_audit";
}

export interface EditedExpenseData {
  expenseId: string;
  tripId: string;
  payerId: string;
  title: string;
  amountMinor: number;
  category: string;
  splitType: string;
  version: number;
  isVoid: boolean;
  allocations: {
    userId: string;
    amountMinor: number;
    percentage?: number;
    shares?: number;
  }[];
  updatedAt: Date;
}

export interface VoidExpenseParams {
  requestingUserId: string;
  expenseId: string;
  version: number;
  reason: string;
  _testFailurePoint?: "after_update" | "during_audit";
}

export interface VoidedExpenseData {
  expenseId: string;
  isVoid: true;
  voidReason: string;
  voidedBy: string;
  version: number;
  updatedAt: Date;
}

export interface ExpenseFeedQuery {
  tripId: string;
  requestingUserId: string;
  page?: number | string;
  limit?: number | string;
  category?: string;
  includeVoided?: boolean | string;
}

export interface ExpenseFeedItem {
  expenseId: string;
  title: string;
  amountMinor: number;
  category: string;
  payer: {
    userId: string;
    name?: string;
    email?: string;
  };
  splitType: string;
  allocationSummary: {
    participantCount: number;
    totalAmountMinor: number;
  };
  isVoid: boolean;
  createdAt: Date;
}

export interface PaginatedExpenseFeed {
  expenses: ExpenseFeedItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ExpenseDetailResult {
  expenseId: string;
  tripId: string;
  title: string;
  amountMinor: number;
  category: string;
  splitType: string;
  version: number;
  isVoid: boolean;
  voidReason?: string | null;
  voidedBy?: {
    userId: string;
    name?: string;
    email?: string;
  } | null;
  payer: {
    userId: string;
    name?: string;
    email?: string;
  };
  allocations: {
    userId: string;
    name?: string;
    email?: string;
    amountMinor: number;
    percentage?: number;
    shares?: number;
  }[];
  auditHistory: {
    action: string;
    changedBy: {
      userId: string;
      name?: string;
      email?: string;
    };
    previousSnapshot?: Record<string, unknown> | null;
    newSnapshot?: Record<string, unknown> | null;
    timestamp: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Checks whether the user has permission to edit or void an expense.
 * Allowed if user is the original payer OR user has ADMIN role in TripMember.
 */
export async function canUserModifyExpense(
  tripId: string,
  expensePayerId: string,
  userId: string
): Promise<boolean> {
  if (expensePayerId === userId) {
    return true;
  }

  const member = await prisma.tripMember.findUnique({
    where: {
      tripId_userId: {
        tripId,
        userId,
      },
    },
    select: {
      role: true,
    },
  });

  return member?.role === "ADMIN";
}

/**
 * Validates expense creation/edit payload and calculates allocation breakdown using split engine.
 */
export async function validateAndCalculateAllocations(
  tripId: string,
  payerId: string,
  title: string,
  amountMinor: number,
  category: string,
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE",
  allocations: RawAllocationInput[]
): Promise<SplitAllocationResult[]> {
  // 1. Title validation
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    throw new ApiError("Expense title is required and cannot be empty", 400, "INVALID_TITLE");
  }

  // 2. Category validation
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    throw new ApiError("Expense category is required and cannot be empty", 400, "INVALID_CATEGORY");
  }

  // 3. AmountMinor validation
  if (
    typeof amountMinor !== "number" ||
    !Number.isFinite(amountMinor) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new ApiError(
      "amountMinor must be a positive safe integer in paise (greater than zero)",
      400,
      "INVALID_AMOUNT"
    );
  }

  // 4. Split type validation
  const validSplitTypes = ["EQUAL", "EXACT", "PERCENTAGE"];
  if (!validSplitTypes.includes(splitType)) {
    throw new ApiError(
      `Invalid splitType: "${splitType}". Must be one of: EQUAL, EXACT, PERCENTAGE`,
      400,
      "INVALID_SPLIT_TYPE"
    );
  }

  // 5. Allocations list non-empty
  if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
    throw new ApiError(
      "At least one allocation participant is required",
      400,
      "EMPTY_ALLOCATIONS"
    );
  }

  // 6. Validate IDs and reject duplicates
  const seenIds = new Set<string>();
  const participantIds: string[] = [];

  for (let i = 0; i < allocations.length; i++) {
    const alloc = allocations[i];
    if (!alloc.userId || !isValidId(alloc.userId)) {
      throw new ApiError(
        `Allocation at index ${i} has an invalid or missing userId: "${alloc.userId}"`,
        400,
        "INVALID_USER_ID"
      );
    }
    if (seenIds.has(alloc.userId)) {
      throw new ApiError(
        `Duplicate participant detected in allocations: "${alloc.userId}"`,
        400,
        "DUPLICATE_PARTICIPANT"
      );
    }
    seenIds.add(alloc.userId);
    participantIds.push(alloc.userId);
  }

  // 7. Verify payer and all participants belong to the trip
  const allUserIdsToCheck = Array.from(new Set([payerId, ...participantIds]));
  const existingMembers = await prisma.tripMember.findMany({
    where: {
      tripId,
      userId: { in: allUserIdsToCheck },
    },
    select: {
      userId: true,
    },
  });

  const memberSet = new Set<string>(existingMembers.map((m) => m.userId));

  if (!memberSet.has(payerId)) {
    throw new ApiError(
      `Payer "${payerId}" is not a member of trip "${tripId}"`,
      400,
      "NOT_A_TRIP_MEMBER"
    );
  }

  for (const uid of participantIds) {
    if (!memberSet.has(uid)) {
      throw new ApiError(
        `Participant "${uid}" is not a member of trip "${tripId}"`,
        400,
        "NOT_A_TRIP_MEMBER"
      );
    }
  }

  // 8. Calculate allocations according to splitType
  let calculatedAllocations: SplitAllocationResult[];

  try {
    if (splitType === "EQUAL") {
      calculatedAllocations = calculateEqualSplit(amountMinor, participantIds);
    } else if (splitType === "EXACT") {
      const exactInputs = allocations.map((a) => {
        if (
          typeof a.amountMinor !== "number" ||
          !Number.isFinite(a.amountMinor) ||
          !Number.isSafeInteger(a.amountMinor)
        ) {
          throw new ApiError(
            `Participant "${a.userId}" must have a valid integer amountMinor for EXACT split`,
            400,
            "INVALID_EXACT_AMOUNT"
          );
        }
        return {
          userId: a.userId,
          amountMinor: a.amountMinor,
        };
      });
      calculatedAllocations = calculateExactSplit(amountMinor, exactInputs);
    } else if (splitType === "PERCENTAGE") {
      const percentageInputs = allocations.map((a) => {
        if (typeof a.percentage !== "number" || !Number.isFinite(a.percentage)) {
          throw new ApiError(
            `Participant "${a.userId}" must have a valid percentage for PERCENTAGE split`,
            400,
            "INVALID_PERCENTAGE"
          );
        }
        return {
          userId: a.userId,
          percentage: a.percentage,
        };
      });
      calculatedAllocations = calculatePercentageSplit(amountMinor, percentageInputs);
    } else {
      throw new ApiError("Unsupported split type", 400, "INVALID_SPLIT_TYPE");
    }
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Split calculation failed";
    throw new ApiError(message, 400, "SPLIT_CALCULATION_ERROR");
  }

  // 9. Invariant check: Allocation sum must strictly equal amountMinor
  const allocationSum = calculatedAllocations.reduce((sum, a) => sum + a.amountMinor, 0);
  if (allocationSum !== amountMinor) {
    throw new ApiError(
      `Calculated allocations total (${allocationSum} paise) does not equal expense amount (${amountMinor} paise)`,
      400,
      "ALLOCATION_SUM_MISMATCH"
    );
  }

  return calculatedAllocations;
}

/**
 * Creates an expense with allocations and audit log atomically in a single Prisma transaction.
 */
export async function createExpenseTransactional(
  params: CreateExpenseParams
): Promise<CreatedExpenseData> {
  const {
    requestingUserId,
    tripId,
    payerId,
    title,
    amountMinor,
    category,
    splitType,
    allocations,
  } = params;

  if (!isValidId(tripId)) {
    throw new ApiError("Invalid tripId format", 400, "INVALID_TRIP_ID");
  }

  if (!isValidId(payerId)) {
    throw new ApiError("Invalid payerId format", 400, "INVALID_PAYER_ID");
  }

  const isRequestingUserMember = await isTripMember(tripId, requestingUserId);
  if (!isRequestingUserMember) {
    throw new ApiError(
      "Forbidden: You are not a member of this trip",
      403,
      "FORBIDDEN_NOT_A_MEMBER"
    );
  }

  const calculatedAllocations = await validateAndCalculateAllocations(
    tripId,
    payerId,
    title,
    amountMinor,
    category,
    splitType,
    allocations
  );

  return await prisma.$transaction(async (tx) => {
    // 1. Create Expense
    const expense = await tx.expense.create({
      data: {
        tripId,
        payerId,
        title: title.trim(),
        amountMinor,
        category: category.trim(),
        splitType: splitType as SplitType,
        version: 1,
        isVoid: false,
      },
    });

    if (params._testFailurePoint === "after_expense") {
      throw new Error("Simulated failure after expense creation for rollback testing");
    }

    // 2. Create Allocations
    const allocationData = calculatedAllocations.map((alloc) => ({
      expenseId: expense.id,
      userId: alloc.userId,
      amountMinor: alloc.amountMinor,
      percentage: alloc.percentage ?? null,
      shares: alloc.shares ?? null,
    }));

    await tx.expenseAllocation.createMany({
      data: allocationData,
    });

    if (params._testFailurePoint === "after_allocations") {
      throw new Error("Simulated failure after allocation insertion for rollback testing");
    }

    // 3. Create Audit Log (CREATED)
    const newSnapshot = {
      expenseId: expense.id,
      tripId,
      payerId,
      title: expense.title,
      amountMinor: expense.amountMinor,
      category: expense.category,
      splitType: expense.splitType,
      version: 1,
      isVoid: false,
      allocations: calculatedAllocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage,
        shares: a.shares,
      })),
    };

    if (params._testFailurePoint === "during_audit") {
      throw new Error("Simulated failure during audit log creation for rollback testing");
    }

    await tx.expenseAuditLog.create({
      data: {
        expenseId: expense.id,
        action: "CREATED",
        changedById: requestingUserId,
        previousSnapshot: Prisma.DbNull,
        newSnapshot: newSnapshot as Prisma.InputJsonValue,
      },
    });

    return {
      expenseId: expense.id,
      tripId,
      payerId,
      title: expense.title,
      amountMinor: expense.amountMinor,
      category: expense.category,
      splitType: expense.splitType,
      version: expense.version,
      isVoid: expense.isVoid,
      allocations: calculatedAllocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage,
        shares: a.shares,
      })),
      createdAt: expense.createdAt,
    };
  });
}

/**
 * Edits an expense atomically inside a single Prisma transaction using optimistic concurrency.
 */
export async function editExpenseTransactional(
  params: EditExpenseParams
): Promise<EditedExpenseData> {
  const { requestingUserId, expenseId, version } = params;

  if (!isValidId(expenseId)) {
    throw new ApiError("Invalid expenseId format", 400, "INVALID_EXPENSE_ID");
  }

  if (
    version === undefined ||
    version === null ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new ApiError(
      "A valid positive integer version number is required for optimistic concurrency",
      400,
      "INVALID_VERSION"
    );
  }

  const existingExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { allocations: true },
  });

  if (!existingExpense) {
    throw new ApiError("Expense not found", 404, "NOT_FOUND");
  }

  const tripIdStr = existingExpense.tripId;

  const isMember = await isTripMember(tripIdStr, requestingUserId);
  if (!isMember) {
    throw new ApiError(
      "Forbidden: You are not a member of this trip",
      403,
      "FORBIDDEN_NOT_A_MEMBER"
    );
  }

  const hasEditPermission = await canUserModifyExpense(
    tripIdStr,
    existingExpense.payerId,
    requestingUserId
  );
  if (!hasEditPermission) {
    throw new ApiError(
      "Forbidden: You do not have permission to edit this expense",
      403,
      "FORBIDDEN_UNAUTHORIZED_ROLE"
    );
  }

  if (existingExpense.isVoid) {
    throw new ApiError("Cannot edit a voided expense", 400, "EXPENSE_ALREADY_VOIDED");
  }

  const newTitle = params.title !== undefined ? params.title : existingExpense.title;
  const newAmountMinor = params.amountMinor !== undefined ? params.amountMinor : existingExpense.amountMinor;
  const newCategory = params.category !== undefined ? params.category : existingExpense.category;
  const newPayerId = params.payerId !== undefined ? params.payerId : existingExpense.payerId;
  const newSplitType = (params.splitType !== undefined ? params.splitType : existingExpense.splitType) as
    | "EQUAL"
    | "EXACT"
    | "PERCENTAGE";

  if (!isValidId(newPayerId)) {
    throw new ApiError("Invalid payerId format", 400, "INVALID_PAYER_ID");
  }

  let rawAllocations = params.allocations;
  if (!rawAllocations) {
    rawAllocations = existingExpense.allocations.map((a) => ({
      userId: a.userId,
      amountMinor: a.amountMinor,
      percentage: a.percentage ?? undefined,
      shares: a.shares ?? undefined,
    }));
  }

  const calculatedAllocations = await validateAndCalculateAllocations(
    tripIdStr,
    newPayerId,
    newTitle,
    newAmountMinor,
    newCategory,
    newSplitType,
    rawAllocations
  );

  return await prisma.$transaction(async (tx) => {
    // Capture previousSnapshot
    const oldAllocations = await tx.expenseAllocation.findMany({ where: { expenseId } });
    const previousSnapshot = {
      expenseId,
      tripId: tripIdStr,
      payerId: existingExpense.payerId,
      title: existingExpense.title,
      amountMinor: existingExpense.amountMinor,
      category: existingExpense.category,
      splitType: existingExpense.splitType,
      version: existingExpense.version,
      isVoid: existingExpense.isVoid,
      allocations: oldAllocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage ?? undefined,
        shares: a.shares ?? undefined,
      })),
    };

    // Atomic conditional update
    const updateResult = await tx.expense.updateMany({
      where: {
        id: expenseId,
        version: version,
        isVoid: false,
      },
      data: {
        title: newTitle.trim(),
        amountMinor: newAmountMinor,
        category: newCategory.trim(),
        payerId: newPayerId,
        splitType: newSplitType as SplitType,
        version: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      const current = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!current) {
        throw new ApiError("Expense not found", 404, "NOT_FOUND");
      }
      if (current.isVoid) {
        throw new ApiError("Cannot edit a voided expense", 400, "EXPENSE_ALREADY_VOIDED");
      }
      if (current.version !== version) {
        throw new ApiError(
          "Expense was updated by someone else. Please refresh and try again.",
          409,
          "VERSION_CONFLICT"
        );
      }
      throw new ApiError("Failed to update expense", 400, "UPDATE_FAILED");
    }

    if (params._testFailurePoint === "after_update") {
      throw new Error("Simulated failure after expense update for rollback testing");
    }

    // Replace allocations
    await tx.expenseAllocation.deleteMany({ where: { expenseId } });

    const newAllocationDocs = calculatedAllocations.map((alloc) => ({
      expenseId,
      userId: alloc.userId,
      amountMinor: alloc.amountMinor,
      percentage: alloc.percentage ?? null,
      shares: alloc.shares ?? null,
    }));

    await tx.expenseAllocation.createMany({ data: newAllocationDocs });

    if (params._testFailurePoint === "after_allocations") {
      throw new Error("Simulated failure after allocation replacement for rollback testing");
    }

    // Append EDITED audit log
    const newSnapshot = {
      expenseId,
      tripId: tripIdStr,
      payerId: newPayerId,
      title: newTitle.trim(),
      amountMinor: newAmountMinor,
      category: newCategory.trim(),
      splitType: newSplitType,
      version: version + 1,
      isVoid: false,
      allocations: calculatedAllocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage,
        shares: a.shares,
      })),
    };

    if (params._testFailurePoint === "during_audit") {
      throw new Error("Simulated failure during audit log creation for rollback testing");
    }

    await tx.expenseAuditLog.create({
      data: {
        expenseId,
        action: "EDITED",
        changedById: requestingUserId,
        previousSnapshot: previousSnapshot as Prisma.InputJsonValue,
        newSnapshot: newSnapshot as Prisma.InputJsonValue,
      },
    });

    const updatedExpense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });

    return {
      expenseId: updatedExpense.id,
      tripId: tripIdStr,
      payerId: updatedExpense.payerId,
      title: updatedExpense.title,
      amountMinor: updatedExpense.amountMinor,
      category: updatedExpense.category,
      splitType: updatedExpense.splitType,
      version: updatedExpense.version,
      isVoid: updatedExpense.isVoid,
      allocations: calculatedAllocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage,
        shares: a.shares,
      })),
      updatedAt: updatedExpense.updatedAt,
    };
  });
}

/**
 * Soft-voids an expense atomically inside a single Prisma transaction.
 * Preserves allocations for audit and balance history.
 */
export async function voidExpenseTransactional(
  params: VoidExpenseParams
): Promise<VoidedExpenseData> {
  const { requestingUserId, expenseId, version, reason } = params;

  if (!isValidId(expenseId)) {
    throw new ApiError("Invalid expenseId format", 400, "INVALID_EXPENSE_ID");
  }

  if (
    version === undefined ||
    version === null ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new ApiError(
      "A valid positive integer version number is required for voiding",
      400,
      "INVALID_VERSION"
    );
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new ApiError("Void reason is required and cannot be empty", 400, "INVALID_VOID_REASON");
  }

  const existingExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { allocations: true },
  });

  if (!existingExpense) {
    throw new ApiError("Expense not found", 404, "NOT_FOUND");
  }

  const tripIdStr = existingExpense.tripId;

  const isMember = await isTripMember(tripIdStr, requestingUserId);
  if (!isMember) {
    throw new ApiError(
      "Forbidden: You are not a member of this trip",
      403,
      "FORBIDDEN_NOT_A_MEMBER"
    );
  }

  const hasVoidPermission = await canUserModifyExpense(
    tripIdStr,
    existingExpense.payerId,
    requestingUserId
  );
  if (!hasVoidPermission) {
    throw new ApiError(
      "Forbidden: You do not have permission to void this expense",
      403,
      "FORBIDDEN_UNAUTHORIZED_ROLE"
    );
  }

  if (existingExpense.isVoid) {
    throw new ApiError("Cannot void an already voided expense", 400, "EXPENSE_ALREADY_VOIDED");
  }

  return await prisma.$transaction(async (tx) => {
    // Capture previousSnapshot
    const allocations = await tx.expenseAllocation.findMany({ where: { expenseId } });
    const previousSnapshot = {
      expenseId,
      tripId: tripIdStr,
      payerId: existingExpense.payerId,
      title: existingExpense.title,
      amountMinor: existingExpense.amountMinor,
      category: existingExpense.category,
      splitType: existingExpense.splitType,
      version: existingExpense.version,
      isVoid: false,
      allocations: allocations.map((a) => ({
        userId: a.userId,
        amountMinor: a.amountMinor,
        percentage: a.percentage ?? undefined,
        shares: a.shares ?? undefined,
      })),
    };

    // Atomic conditional update
    const updateResult = await tx.expense.updateMany({
      where: {
        id: expenseId,
        version: version,
        isVoid: false,
      },
      data: {
        isVoid: true,
        voidReason: reason.trim(),
        voidedById: requestingUserId,
        version: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      const current = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!current) {
        throw new ApiError("Expense not found", 404, "NOT_FOUND");
      }
      if (current.isVoid) {
        throw new ApiError("Cannot void an already voided expense", 400, "EXPENSE_ALREADY_VOIDED");
      }
      if (current.version !== version) {
        throw new ApiError(
          "Expense was updated by someone else. Please refresh and try again.",
          409,
          "VERSION_CONFLICT"
        );
      }
      throw new ApiError("Failed to void expense", 400, "VOID_FAILED");
    }

    if (params._testFailurePoint === "after_update") {
      throw new Error("Simulated failure after void update for rollback testing");
    }

    const newSnapshot = {
      ...previousSnapshot,
      isVoid: true,
      voidReason: reason.trim(),
      voidedBy: requestingUserId,
      version: version + 1,
    };

    if (params._testFailurePoint === "during_audit") {
      throw new Error("Simulated failure during audit log creation for rollback testing");
    }

    await tx.expenseAuditLog.create({
      data: {
        expenseId,
        action: "VOIDED",
        changedById: requestingUserId,
        previousSnapshot: previousSnapshot as Prisma.InputJsonValue,
        newSnapshot: newSnapshot as Prisma.InputJsonValue,
      },
    });

    const voidedDoc = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });

    return {
      expenseId: voidedDoc.id,
      isVoid: true,
      voidReason: voidedDoc.voidReason as string,
      voidedBy: voidedDoc.voidedById ?? requestingUserId,
      version: voidedDoc.version,
      updatedAt: voidedDoc.updatedAt,
    };
  });
}

/**
 * Retrieves paginated trip expense feed with sorting, category filtering and voided inclusion toggle.
 */
export async function getTripExpensesPaginated(
  query: ExpenseFeedQuery
): Promise<PaginatedExpenseFeed> {
  const { tripId, requestingUserId, category } = query;

  if (!isValidId(tripId)) {
    throw new ApiError("Invalid tripId format", 400, "INVALID_TRIP_ID");
  }

  const isMember = await isTripMember(tripId, requestingUserId);
  if (!isMember) {
    throw new ApiError(
      "Forbidden: You are not a member of this trip",
      403,
      "FORBIDDEN_NOT_A_MEMBER"
    );
  }

  const page = query.page !== undefined ? Number(query.page) : 1;
  let limit = query.limit !== undefined ? Number(query.limit) : 20;
  const includeVoided = query.includeVoided === true || query.includeVoided === "true";

  if (Number.isNaN(page) || Number.isNaN(limit)) {
    throw new ApiError("Page and limit must be valid numeric values", 400, "INVALID_PAGINATION");
  }

  if (page < 1) {
    throw new ApiError("Page parameter must be an integer >= 1", 400, "INVALID_PAGINATION");
  }

  if (limit < 1) {
    throw new ApiError("Limit parameter must be an integer >= 1", 400, "INVALID_PAGINATION");
  }

  if (limit > 100) {
    limit = 100;
  }

  const skip = (page - 1) * limit;

  const where: Prisma.ExpenseWhereInput = {
    tripId,
    ...(includeVoided ? {} : { isVoid: false }),
    ...(category && typeof category === "string" && category.trim().length > 0
      ? { category: { equals: category.trim(), mode: "insensitive" } }
      : {}),
  };

  const [totalCount, expenses] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: {
        payer: { select: { id: true, name: true, email: true } },
        allocations: true,
      },
    }),
  ]);

  if (expenses.length === 0) {
    return {
      expenses: [],
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 0,
        hasNextPage: false,
        hasPrevPage: page > 1,
      },
    };
  }

  const feedItems: ExpenseFeedItem[] = expenses.map((e) => {
    const summary = {
      participantCount: e.allocations.length,
      totalAmountMinor: e.allocations.reduce((sum, a) => sum + a.amountMinor, 0),
    };

    return {
      expenseId: e.id,
      title: e.title,
      amountMinor: e.amountMinor,
      category: e.category,
      payer: {
        userId: e.payer.id,
        name: e.payer.name,
        email: e.payer.email,
      },
      splitType: e.splitType,
      allocationSummary: summary,
      isVoid: e.isVoid,
      createdAt: e.createdAt,
    };
  });

  const totalPages = Math.ceil(totalCount / limit);

  return {
    expenses: feedItems,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Retrieves complete expense breakdown including allocations and chronological audit history.
 */
export async function getExpenseDetail(
  expenseId: string,
  requestingUserId: string
): Promise<ExpenseDetailResult> {
  if (!isValidId(expenseId)) {
    throw new ApiError("Invalid expenseId format", 400, "INVALID_EXPENSE_ID");
  }

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      payer: { select: { id: true, name: true, email: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
      allocations: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      auditLogs: {
        orderBy: { timestamp: "asc" },
        include: {
          changedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!expense) {
    throw new ApiError("Expense not found", 404, "NOT_FOUND");
  }

  const isMember = await isTripMember(expense.tripId, requestingUserId);
  if (!isMember) {
    throw new ApiError(
      "Forbidden: You are not a member of this trip",
      403,
      "FORBIDDEN_NOT_A_MEMBER"
    );
  }

  return {
    expenseId: expense.id,
    tripId: expense.tripId,
    title: expense.title,
    amountMinor: expense.amountMinor,
    category: expense.category,
    splitType: expense.splitType,
    version: expense.version,
    isVoid: expense.isVoid,
    voidReason: expense.voidReason,
    voidedBy: expense.voidedBy
      ? {
          userId: expense.voidedBy.id,
          name: expense.voidedBy.name,
          email: expense.voidedBy.email,
        }
      : null,
    payer: {
      userId: expense.payer.id,
      name: expense.payer.name,
      email: expense.payer.email,
    },
    allocations: expense.allocations.map((a) => ({
      userId: a.userId,
      name: a.user?.name,
      email: a.user?.email,
      amountMinor: a.amountMinor,
      percentage: a.percentage ?? undefined,
      shares: a.shares ?? undefined,
    })),
    auditHistory: expense.auditLogs.map((log) => ({
      action: log.action,
      changedBy: {
        userId: log.changedBy.id,
        name: log.changedBy.name,
        email: log.changedBy.email,
      },
      previousSnapshot: log.previousSnapshot as Record<string, unknown> | null,
      newSnapshot: log.newSnapshot as Record<string, unknown> | null,
      timestamp: log.timestamp,
    })),
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}
