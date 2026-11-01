import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTripReportCsv, type TripReportResult } from "../lib/ledger/reportService";

describe("Trip report CSV export", () => {
  const sample: TripReportResult = {
    summaryCard: {
      tripId: "t1",
      tripName: "Manali Trip",
      destination: "Manali",
      currency: "INR",
      status: "ACTIVE",
      totalSpentMinor: 800000,
      totalSpent: 8000,
      totalExpensesCount: 4,
      totalMembersCount: 4,
      isFullySettled: false,
      settlementProgressPercentage: 0,
    },
    categories: [{ category: "stay", totalMinor: 400000, total: 4000, percentage: 50, expenseCount: 1 }],
    perPerson: [
      {
        memberId: "m1",
        userId: "u1",
        name: "Prabhjot",
        totalPaidMinor: 400000,
        totalPaid: 4000,
        totalPersonalShareMinor: 200000,
        totalPersonalShare: 2000,
        netBalanceMinor: 200000,
        netBalance: 2000,
        status: "RECEIVES",
      },
    ],
  };

  it("includes the trip name, totals, category and per-person rows", () => {
    const csv = buildTripReportCsv(sample);
    assert.ok(csv.includes("Manali Trip"));
    assert.ok(csv.includes("stay"));
    assert.ok(csv.includes("Prabhjot"));
    assert.ok(csv.includes("RECEIVES"));
  });

  it("quotes fields containing commas so the CSV stays valid", () => {
    const withComma: TripReportResult = {
      ...sample,
      summaryCard: { ...sample.summaryCard, tripName: "Goa, Day Trip" },
    };
    const csv = buildTripReportCsv(withComma);
    assert.ok(csv.includes('"Goa, Day Trip"'));
  });
});
