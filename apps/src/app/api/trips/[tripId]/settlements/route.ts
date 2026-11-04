import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSettlement, getTripSettlements } from "@/lib/ledger/settlementService";
import { errorResponse } from "@/lib/apiError";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await params;
    const user = getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { fromMemberId, toMemberId, amountMinor, paymentNote } = body;

    if (!fromMemberId || !toMemberId || amountMinor === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: fromMemberId, toMemberId, amountMinor",
        },
        { status: 400 }
      );
    }

    const settlement = await createSettlement({
      tripId,
      actorUserId: user.userId,
      fromMemberId,
      toMemberId,
      amountMinor: Number(amountMinor),
      paymentNote,
    });

    return NextResponse.json(
      {
        success: true,
        data: settlement,
        message: "Payment marked as PENDING. Awaiting receiver confirmation.",
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    return errorResponse(err, "Failed to create settlement");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await params;
    const user = getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    const settlements = await getTripSettlements(tripId, user.userId);

    return NextResponse.json({
      success: true,
      data: settlements,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to fetch settlements");
  }
}

