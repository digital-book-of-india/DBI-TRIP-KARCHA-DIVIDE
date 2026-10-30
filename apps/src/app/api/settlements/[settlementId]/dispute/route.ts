import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { disputeSettlement } from "@/lib/ledger/settlementService";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const { settlementId } = await params;
    const user = getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    let reason: string | undefined;
    try {
      const body = await req.json();
      reason = body.reason;
    } catch {
      // Body is optional
    }

    const updatedSettlement = await disputeSettlement(settlementId, user.userId, reason);

    return NextResponse.json({
      success: true,
      data: updatedSettlement,
      message: "Payment marked as DISPUTED.",
    });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json(
      { success: false, error: err.message || "Failed to dispute settlement" },
      { status }
    );
  }
}

