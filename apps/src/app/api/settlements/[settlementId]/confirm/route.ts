import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { confirmSettlement } from "@/lib/ledger/settlementService";
import { errorResponse } from "@/lib/apiError";

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

    const updatedSettlement = await confirmSettlement(settlementId, user.userId);

    return NextResponse.json({
      success: true,
      data: updatedSettlement,
      message: "Payment confirmed successfully. Ledger balances updated.",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to confirm settlement");
  }
}

