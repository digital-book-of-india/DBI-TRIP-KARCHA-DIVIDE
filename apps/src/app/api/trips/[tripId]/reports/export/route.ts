import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTripReports } from "@/lib/ledger/reportService";
import { buildTripReportCsv } from "@/lib/ledger/reportService";
import { errorResponse } from "@/lib/apiError";

/**
 * GET /api/trips/[tripId]/reports/export
 * Downloads the trip report as a CSV file (PDF spec: Reports "export/share
 * summary"). Membership-gated, same as /reports.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await params;
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized: Please sign in" }, { status: 401 });
    }

    const report = await getTripReports(tripId, user.userId);
    const csv = buildTripReportCsv(report);
    const filename = `${report.summaryCard.tripName.replace(/[^a-z0-9]+/gi, "_") || "trip"}-report.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to export trip report");
  }
}
