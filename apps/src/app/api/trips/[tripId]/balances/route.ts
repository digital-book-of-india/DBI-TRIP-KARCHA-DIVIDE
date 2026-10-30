import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTripBalances } from "@/lib/ledger/balanceService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await params;

    if (!tripId) {
      return NextResponse.json(
        { success: false, error: "Trip ID is required" },
        { status: 400 }
      );
    }

    // 1. Authenticate user
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Please provide a valid Bearer token or credentials",
        },
        { status: 401 }
      );
    }

    // 2. Fetch authoritative trip balances with membership guard
    const balancesData = await getTripBalances(tripId, user.userId);

    return NextResponse.json({
      success: true,
      data: balancesData,
    });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to calculate trip balances",
      },
      { status }
    );
  }
}

