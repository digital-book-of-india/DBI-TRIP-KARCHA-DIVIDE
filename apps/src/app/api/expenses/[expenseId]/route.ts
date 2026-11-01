import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/auth/authMiddleware";
import {
  getExpenseDetail,
  editExpenseTransactional,
  ApiError,
  RawAllocationInput,
} from "../../../../services/expenseService";
import { checkRateLimit } from "../../../../lib/rateLimit";

interface RouteContext {
  params: Promise<{ expenseId: string }>;
}

interface EditExpenseRequestBody {
  title?: string;
  amountMinor?: number;
  category?: string;
  payerId?: string;
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE";
  allocations?: RawAllocationInput[];
  note?: string;
  receiptUrl?: string;
  version: number;
}

/**
 * GET /api/expenses/[expenseId]
 * Retrieves comprehensive expense details including allocations and audit history.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authUser = getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required" },
        { status: 401 }
      );
    }

    const { expenseId } = await context.params;

    const result = await getExpenseDetail(expenseId, authUser.userId);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/expenses/[expenseId]
 * Edits an expense using optimistic concurrency control.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authUser = getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required" },
        { status: 401 }
      );
    }

    const { allowed } = checkRateLimit(`expense_write_${authUser.userId}`, 30, 60000);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Too many expense writes. Please wait a moment." },
        { status: 429 }
      );
    }

    const { expenseId } = await context.params;

    let body: EditExpenseRequestBody;
    try {
      body = (await request.json()) as EditExpenseRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const result = await editExpenseTransactional({
      requestingUserId: authUser.userId,
      expenseId,
      version: body.version,
      title: body.title,
      amountMinor: body.amountMinor,
      category: body.category,
      payerId: body.payerId,
      splitType: body.splitType,
      allocations: body.allocations,
      note: body.note,
      receiptUrl: body.receiptUrl,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
