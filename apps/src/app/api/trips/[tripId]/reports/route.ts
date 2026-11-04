import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTripReports } from "@/lib/ledger/reportService";
import { errorResponse } from "@/lib/apiError";

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

    const report = await getTripReports(tripId, user.userId);

    return NextResponse.json({
      success: true,
      data: report,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to generate trip report");
  }
}

