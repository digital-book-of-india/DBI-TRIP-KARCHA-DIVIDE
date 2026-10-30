import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTripReports } from "@/lib/ledger/reportService";

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
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json(
      { success: false, error: err.message || "Failed to generate trip report" },
      { status }
    );
  }
}

