import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { createExpenseTransactional } from "../services/expenseService";
import { voidExpenseTransactional } from "../services/expenseService";
import { getTripBalances } from "../lib/ledger/balanceService";

/**
 * End-to-end regression test for the ledger balance service, through the
 * SAME code path real requests take: createExpenseTransactional (Developer 2)
 * writes the expense/allocations, getTripBalances (Developer 3) reads them
 * back and computes balances.
 *
 * This specifically guards against the bug that was found and fixed during
 * this audit: createExpenseTransactional records who paid and who owes using
 * User IDs (Expense.payerId, ExpenseAllocation.userId + amountMinor), while
 * getTripBalances used to read the separate, never-populated
 * paidByMemberId/tripMemberId/shareMinor columns -- so every computed
 * balance silently came out as 0 regardless of real spend. If that
 * regresses, these assertions will fail with 0s instead of the expected
 * amounts.
 */
describe("Balance Service Integration (end-to-end ledger correctness)", () => {
  let tripId: string;
  let prabhjotId: string, amanId: string, rahulId: string, simranId: string;
  let prabhjotMemberId: string, amanMemberId: string, rahulMemberId: string, simranMemberId: string;

  beforeEach(async () => {
    setupTestDb();

    prabhjotId = createTestId();
    amanId = createTestId();
    rahulId = createTestId();
    simranId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: prabhjotId, name: "Prabhjot", email: "prabhjot@test.com" });
    testDb.addUser({ _id: amanId, name: "Aman", email: "aman@test.com" });
    testDb.addUser({ _id: rahulId, name: "Rahul", email: "rahul@test.com" });
    testDb.addUser({ _id: simranId, name: "Simran", email: "simran@test.com" });

    testDb.addTrip({ _id: tripId, title: "Manali Trip", name: "Manali Trip", createdBy: prabhjotId });

    prabhjotMemberId = testDb.addTripMember(tripId, prabhjotId, "ADMIN").id;
    amanMemberId = testDb.addTripMember(tripId, amanId, "MEMBER").id;
    rahulMemberId = testDb.addTripMember(tripId, rahulId, "MEMBER").id;
    simranMemberId = testDb.addTripMember(tripId, simranId, "MEMBER").id;

    const allFour = [prabhjotId, amanId, rahulId, simranId];

    // Hotel ₹4,000 paid by Prabhjot, split equally
    await createExpenseTransactional({
      requestingUserId: prabhjotId,
      tripId,
      payerId: prabhjotId,
      title: "Hotel",
      amountMinor: 400000,
      category: "stay",
      splitType: "EQUAL",
      allocations: allFour.map((userId) => ({ userId })),
    });

    // Petrol ₹2,000 paid by Aman, split equally
    await createExpenseTransactional({
      requestingUserId: amanId,
      tripId,
      payerId: amanId,
      title: "Petrol",
      amountMinor: 200000,
      category: "travel",
      splitType: "EQUAL",
      allocations: allFour.map((userId) => ({ userId })),
    });

    // Dinner ₹1,200 paid by Rahul, split equally
    await createExpenseTransactional({
      requestingUserId: rahulId,
      tripId,
      payerId: rahulId,
      title: "Dinner",
      amountMinor: 120000,
      category: "food",
      splitType: "EQUAL",
      allocations: allFour.map((userId) => ({ userId })),
    });

    // Snacks ₹800 paid by Simran, split equally
    await createExpenseTransactional({
      requestingUserId: simranId,
      tripId,
      payerId: simranId,
      title: "Snacks",
      amountMinor: 80000,
      category: "food",
      splitType: "EQUAL",
      allocations: allFour.map((userId) => ({ userId })),
    });
  });

  afterEach(() => {
    teardownTestDb();
  });

  it("matches the PDF spec's worked example exactly through the real service layer", async () => {
    const result = await getTripBalances(tripId, prabhjotId);

    assert.strictEqual(result.totalTripExpenseMinor, 800000);

    const byMemberId = new Map(result.balances.map((b) => [b.memberId, b]));

    assert.strictEqual(byMemberId.get(prabhjotMemberId)!.netBalanceMinor, 200000, "Prabhjot should receive ₹2,000");
    assert.strictEqual(byMemberId.get(amanMemberId)!.netBalanceMinor, 0, "Aman should be settled");
    assert.strictEqual(byMemberId.get(rahulMemberId)!.netBalanceMinor, -80000, "Rahul should owe ₹800");
    assert.strictEqual(byMemberId.get(simranMemberId)!.netBalanceMinor, -120000, "Simran should owe ₹1,200");

    const sumOfBalances = result.balances.reduce((s, b) => s + b.netBalanceMinor, 0);
    assert.strictEqual(sumOfBalances, 0, "Zero-sum invariant must hold");

    assert.strictEqual(result.suggestedTransfers.length, 2);
    assert.ok(result.suggestedTransfers.some((t) => t.fromMemberId === rahulMemberId && t.toMemberId === prabhjotMemberId && t.amountMinor === 80000));
    assert.ok(result.suggestedTransfers.some((t) => t.fromMemberId === simranMemberId && t.toMemberId === prabhjotMemberId && t.amountMinor === 120000));
  });

  it("recomputes correctly after an expense is voided", async () => {
    // Void the Dinner expense (paid by Rahul). After voiding, Rahul's debit
    // from Dinner disappears and his net balance should improve by ₹300
    // (his 1/4 share of ₹1,200), while Prabhjot's total trip expense drops
    // by ₹1,200.
    const beforeFeed = await getTripBalances(tripId, prabhjotId);
    assert.strictEqual(beforeFeed.totalTripExpenseMinor, 800000);

    // Find the dinner expense id via testDb directly (service-created).
    const dinnerExpense = [...testDb.expenses.values()].find((e: { title: string }) => e.title === "Dinner");
    assert.ok(dinnerExpense, "Dinner expense must exist");

    await voidExpenseTransactional({
      requestingUserId: rahulId,
      expenseId: dinnerExpense.id,
      version: dinnerExpense.version,
      reason: "Duplicate entry",
    });

    const afterVoid = await getTripBalances(tripId, prabhjotId);
    assert.strictEqual(afterVoid.totalTripExpenseMinor, 680000, "Voided Dinner must be excluded from the trip total");

    // Remaining active expenses: Hotel 400000 (Prabhjot), Petrol 200000
    // (Aman), Snacks 80000 (Simran) = 680000 total, i.e. 170000 share each.
    // Rahul paid nothing that remains active, so he now owes his full share.
    const byMemberId = new Map(afterVoid.balances.map((b) => [b.memberId, b]));
    assert.strictEqual(byMemberId.get(prabhjotMemberId)!.netBalanceMinor, 230000);
    assert.strictEqual(byMemberId.get(amanMemberId)!.netBalanceMinor, 30000);
    assert.strictEqual(byMemberId.get(rahulMemberId)!.netBalanceMinor, -170000);
    assert.strictEqual(byMemberId.get(simranMemberId)!.netBalanceMinor, -90000);

    const sumOfBalances = afterVoid.balances.reduce((s, b) => s + b.netBalanceMinor, 0);
    assert.strictEqual(sumOfBalances, 0, "Zero-sum invariant must hold after a void");
  });

  it("rejects balance access for a non-member of the trip", async () => {
    const strangerId = createTestId();
    testDb.addUser({ _id: strangerId, name: "Stranger", email: "stranger@test.com" });

    await assert.rejects(
      () => getTripBalances(tripId, strangerId),
      (err: unknown) => (err as { status?: number }).status === 403
    );
  });
});
