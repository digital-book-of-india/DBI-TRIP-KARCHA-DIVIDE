import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../../lib/auth/authMiddleware";
import { voidExpenseTransactional, ApiError } from "../../../../../services/expenseService";

interface RouteContext {
  params: Promise<{ expenseId: string }>;
}

interface VoidExpenseRequestBody {
  reason: string;
  version: number;
}

/**
 * POST /api/expenses/[expenseId]/void
 * Soft-voids an expense atomically using conditional optimistic concurrency updates.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authUser = getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required" },
        { status: 401 }
      );
    }

    const { expenseId } = await context.params;

    let body: VoidExpenseRequestBody;
    try {
      body = (await request.json()) as VoidExpenseRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const result = await voidExpenseTransactional({
      requestingUserId: authUser.userId,
      expenseId,
      version: body.version,
      reason: body.reason,
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
