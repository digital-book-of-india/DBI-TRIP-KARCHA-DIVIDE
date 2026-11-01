import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTripBalances } from "../lib/ledger/balanceEngine";
import { simplifyDebts } from "../lib/ledger/debtSimplifier";
import type { LedgerExpenseItem, LedgerSettlementItem, TripMemberInfo } from "../types/ledger";

describe("Ledger Balance Engine (product spec worked example)", () => {
  // Reproduces the PDF spec's four-person trip example exactly:
  // Hotel ₹4,000 (Prabhjot), Petrol ₹2,000 (Aman), Dinner ₹1,200 (Rahul),
  // Snacks ₹800 (Simran); split EQUAL across all four each time.
  // Expected: Prabhjot receives ₹2,000; Aman settled at ₹0; Rahul owes ₹800;
  // Simran owes ₹1,200. Suggested transfers: Rahul -> Prabhjot ₹800,
  // Simran -> Prabhjot ₹1,200.
  const members: TripMemberInfo[] = [
    { id: "m_prabhjot", name: "Prabhjot" },
    { id: "m_aman", name: "Aman" },
    { id: "m_rahul", name: "Rahul" },
    { id: "m_simran", name: "Simran" },
  ];

  function equalAlloc(amountMinor: number) {
    const share = amountMinor / members.length;
    return members.map((m) => ({ tripMemberId: m.id, shareMinor: share }));
  }

  const expenses: LedgerExpenseItem[] = [
    { id: "e_hotel", title: "Hotel", amountMinor: 400000, paidByMemberId: "m_prabhjot", status: "ACTIVE", allocations: equalAlloc(400000) },
    { id: "e_petrol", title: "Petrol", amountMinor: 200000, paidByMemberId: "m_aman", status: "ACTIVE", allocations: equalAlloc(200000) },
    { id: "e_dinner", title: "Dinner", amountMinor: 120000, paidByMemberId: "m_rahul", status: "ACTIVE", allocations: equalAlloc(120000) },
    { id: "e_snacks", title: "Snacks", amountMinor: 80000, paidByMemberId: "m_simran", status: "ACTIVE", allocations: equalAlloc(80000) },
  ];

  it("computes totalTripExpenseMinor as the full sum (₹8,000)", () => {
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements: [] });
    assert.strictEqual(summary.totalTripExpenseMinor, 800000);
  });

  it("gives each member the correct net balance per the spec worked example", () => {
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements: [] });
    const byId = new Map(summary.balances.map((b) => [b.memberId, b]));

    assert.strictEqual(byId.get("m_prabhjot")!.netBalanceMinor, 200000, "Prabhjot should net +₹2,000");
    assert.strictEqual(byId.get("m_aman")!.netBalanceMinor, 0, "Aman should be settled at ₹0");
    assert.strictEqual(byId.get("m_rahul")!.netBalanceMinor, -80000, "Rahul should owe ₹800");
    assert.strictEqual(byId.get("m_simran")!.netBalanceMinor, -120000, "Simran should owe ₹1,200");
  });

  it("enforces the zero-sum invariant across all members", () => {
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements: [] });
    const total = summary.balances.reduce((sum, b) => sum + b.netBalanceMinor, 0);
    assert.strictEqual(total, 0);
  });

  it("suggests exactly the two transfers the spec calls out, nobody overpaying", () => {
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements: [] });
    assert.strictEqual(summary.suggestedTransfers.length, 2);

    const toPrabhjot = summary.suggestedTransfers.filter((t) => t.toMemberId === "m_prabhjot");
    assert.strictEqual(toPrabhjot.length, 2);

    const rahulTransfer = toPrabhjot.find((t) => t.fromMemberId === "m_rahul");
    const simranTransfer = toPrabhjot.find((t) => t.fromMemberId === "m_simran");
    assert.ok(rahulTransfer, "Rahul -> Prabhjot transfer must be suggested");
    assert.ok(simranTransfer, "Simran -> Prabhjot transfer must be suggested");
    assert.strictEqual(rahulTransfer!.amountMinor, 80000);
    assert.strictEqual(simranTransfer!.amountMinor, 120000);

    const totalSuggested = summary.suggestedTransfers.reduce((s, t) => s + t.amountMinor, 0);
    assert.strictEqual(totalSuggested, 200000, "Suggested transfers must exactly clear all outstanding debt");
  });

  it("is not settled while any balance is outstanding", () => {
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements: [] });
    assert.strictEqual(summary.isSettled, false);
  });

  it("becomes settled once confirmed settlements clear every balance", () => {
    const settlements: LedgerSettlementItem[] = [
      { id: "s1", fromMemberId: "m_rahul", toMemberId: "m_prabhjot", amountMinor: 80000, status: "CONFIRMED" },
      { id: "s2", fromMemberId: "m_simran", toMemberId: "m_prabhjot", amountMinor: 120000, status: "CONFIRMED" },
    ];
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements });
    for (const b of summary.balances) {
      assert.strictEqual(b.netBalanceMinor, 0, `${b.name} should be fully settled`);
    }
    assert.strictEqual(summary.isSettled, true);
    assert.strictEqual(summary.suggestedTransfers.length, 0);
  });

  it("ignores PENDING and DISPUTED settlements for balance calculation", () => {
    const settlements: LedgerSettlementItem[] = [
      { id: "s1", fromMemberId: "m_rahul", toMemberId: "m_prabhjot", amountMinor: 80000, status: "PENDING" },
      { id: "s2", fromMemberId: "m_simran", toMemberId: "m_prabhjot", amountMinor: 120000, status: "DISPUTED" },
    ];
    const summary = computeTripBalances({ tripId: "t1", members, expenses, settlements });
    const byId = new Map(summary.balances.map((b) => [b.memberId, b]));
    assert.strictEqual(byId.get("m_rahul")!.netBalanceMinor, -80000, "PENDING settlement must not move the balance yet");
    assert.strictEqual(byId.get("m_simran")!.netBalanceMinor, -120000, "DISPUTED settlement must not move the balance");
  });

  it("completely excludes VOIDED expenses from every balance", () => {
    const withVoid: LedgerExpenseItem[] = [
      ...expenses,
      { id: "e_voided", title: "Cancelled souvenir", amountMinor: 50000, paidByMemberId: "m_aman", status: "VOIDED", allocations: equalAlloc(50000) },
    ];
    const summary = computeTripBalances({ tripId: "t1", members, expenses: withVoid, settlements: [] });
    assert.strictEqual(summary.totalTripExpenseMinor, 800000, "Voided expense must not count toward the trip total");
    const byId = new Map(summary.balances.map((b) => [b.memberId, b]));
    assert.strictEqual(byId.get("m_aman")!.netBalanceMinor, 0, "Voided expense must not credit or debit anyone");
  });

  it("handles a member who paid nothing and consumed nothing (net 0, no transfer)", () => {
    const extraMembers: TripMemberInfo[] = [...members, { id: "m_guest", name: "Silent Guest" }];
    const summary = computeTripBalances({ tripId: "t1", members: extraMembers, expenses, settlements: [] });
    const guest = summary.balances.find((b) => b.memberId === "m_guest")!;
    assert.strictEqual(guest.netBalanceMinor, 0);
    assert.ok(!summary.suggestedTransfers.some((t) => t.fromMemberId === "m_guest" || t.toMemberId === "m_guest"));
  });
});

describe("Debt simplifier (min-cash-flow)", () => {
  it("throws on a non-zero-sum input instead of silently producing a wrong plan", () => {
    assert.throws(() =>
      simplifyDebts([
        { memberId: "a", name: "A", totalPaidMinor: 0, totalPersonalShareMinor: 0, confirmedSentMinor: 0, confirmedReceivedMinor: 0, netBalanceMinor: 100 },
        { memberId: "b", name: "B", totalPaidMinor: 0, totalPersonalShareMinor: 0, confirmedSentMinor: 0, confirmedReceivedMinor: 0, netBalanceMinor: -50 },
      ])
    );
  });

  it("produces zero transfers when everyone is already at zero", () => {
    const transfers = simplifyDebts([
      { memberId: "a", name: "A", totalPaidMinor: 0, totalPersonalShareMinor: 0, confirmedSentMinor: 0, confirmedReceivedMinor: 0, netBalanceMinor: 0 },
      { memberId: "b", name: "B", totalPaidMinor: 0, totalPersonalShareMinor: 0, confirmedSentMinor: 0, confirmedReceivedMinor: 0, netBalanceMinor: 0 },
    ]);
    assert.strictEqual(transfers.length, 0);
  });
});
