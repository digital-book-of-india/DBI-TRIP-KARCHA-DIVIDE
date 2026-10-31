import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../../lib/auth/authMiddleware";
import {
  createExpenseTransactional,
  getTripExpensesPaginated,
  ApiError,
  RawAllocationInput,
} from "../../../../../services/expenseService";

interface RouteContext {
  params: Promise<{ tripId: string }>;
}

interface CreateExpenseRequestBody {
  title: string;
  amountMinor: number;
  category: string;
  payerId: string;
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE";
  allocations: RawAllocationInput[];
}

/**
 * POST /api/trips/[tripId]/expenses
 * Creates a new expense with atomic transaction support.
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

    const { tripId } = await context.params;

    let body: CreateExpenseRequestBody;
    try {
      body = (await request.json()) as CreateExpenseRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const result = await createExpenseTransactional({
      requestingUserId: authUser.userId,
      tripId,
      title: body.title,
      amountMinor: body.amountMinor,
      category: body.category,
      payerId: body.payerId,
      splitType: body.splitType,
      allocations: body.allocations,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 201 }
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
 * GET /api/trips/[tripId]/expenses
 * Retrieves paginated trip expenses feed.
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

    const { tripId } = await context.params;
    const { searchParams } = new URL(request.url);

    const pageStr = searchParams.get("page");
    const limitStr = searchParams.get("limit");
    const category = searchParams.get("category") || undefined;
    const includeVoided = searchParams.get("includeVoided") === "true";

    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;

    if (isNaN(page) || page < 1) {
      return NextResponse.json(
        { success: false, error: "Page must be an integer >= 1" },
        { status: 400 }
      );
    }

    if (isNaN(limit) || limit < 1) {
      return NextResponse.json(
        { success: false, error: "Limit must be an integer >= 1" },
        { status: 400 }
      );
    }

    const result = await getTripExpensesPaginated({
      requestingUserId: authUser.userId,
      tripId,
      page,
      limit,
      category,
      includeVoided,
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
