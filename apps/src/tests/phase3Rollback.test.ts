import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  editExpenseTransactional,
  voidExpenseTransactional,
} from "../services/expenseService";

describe("Phase 3 Rollback & Transaction Abort Tests", () => {
  let tripId: string;
  let ownerId: string;
  let member1Id: string;
  let member2Id: string;
  let initialExpenseId: string;

  beforeEach(async () => {
    setupTestDb();

    ownerId = createTestId();
    member1Id = createTestId();
    member2Id = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: ownerId, name: "Admin Owner", email: "admin@trip.com" });
    testDb.addUser({ _id: member1Id, name: "Member One", email: "m1@trip.com" });
    testDb.addUser({ _id: member2Id, name: "Member Two", email: "m2@trip.com" });

    testDb.addTrip({ _id: tripId, title: "Rishikesh Rafting", createdBy: ownerId });

    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, member1Id, "MEMBER");
    testDb.addTripMember(tripId, member2Id, "MEMBER");

    // Seed initial expense with version 1 and 3 allocations of 1000 paise each
    const created = await createExpenseTransactional({
      requestingUserId: member1Id,
      tripId,
      payerId: member1Id,
      title: "Rafting Gear",
      amountMinor: 3000,
      category: "equipment",
      splitType: "EQUAL",
      allocations: [{ userId: member1Id }, { userId: member2Id }, { userId: ownerId }],
    });

    initialExpenseId = created.expenseId;
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Edit rollback after expense update
  it("1. Edit rollback: failure after expense update reverts version, title and amount", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          title: "Attempted Title Change",
          amountMinor: 9000,
          _testFailurePoint: "after_update",
        }),
      /Simulated failure after expense update/
    );

    const doc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(doc.title, "Rafting Gear", "Title must remain unchanged");
    assert.strictEqual(doc.amountMinor, 3000, "Amount must remain unchanged");
    assert.strictEqual(doc.version, 1, "Version must remain 1 (not incremented)");

    // Allocations must remain the original 3 allocations
    assert.strictEqual(testDb.allocations.size, 3);
    const allocs = Array.from(testDb.allocations.values());
    for (const a of allocs) {
      assert.strictEqual(a.amountMinor, 1000);
    }

    // No new audit log created
    assert.strictEqual(testDb.auditLogs.size, 1, "Only initial CREATED audit log must exist");
  });

  // 2. Edit rollback after allocation replacement
  it("2. Edit rollback: failure after allocation replacement restores original allocations", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          title: "New Allocation Title",
          amountMinor: 5000,
          splitType: "EQUAL",
          allocations: [{ userId: member1Id }], // Intended to shrink to 1 allocation
          _testFailurePoint: "after_allocations",
        }),
      /Simulated failure after allocation replacement/
    );

    const doc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(doc.title, "Rafting Gear");
    assert.strictEqual(doc.version, 1);

    // Original 3 allocations must be restored
    assert.strictEqual(testDb.allocations.size, 3, "Original 3 allocations must be restored");
    const userIds = Array.from(testDb.allocations.values()).map((a) => a.userId.toString());
    assert.ok(userIds.includes(member1Id));
    assert.ok(userIds.includes(member2Id));
    assert.ok(userIds.includes(ownerId));
  });

  // 3. Edit rollback during audit log creation
  it("3. Edit rollback: failure during audit creation leaves no partial writes", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          title: "Audit Crash Test",
          amountMinor: 6000,
          _testFailurePoint: "during_audit",
        }),
      /Simulated failure during audit log creation/
    );

    const doc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(doc.title, "Rafting Gear");
    assert.strictEqual(doc.version, 1);
    assert.strictEqual(testDb.allocations.size, 3);
    assert.strictEqual(testDb.auditLogs.size, 1);
  });

  // 4. Void rollback after expense update
  it("4. Void rollback: failure after void update keeps expense active and version unchanged", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          reason: "Rollback Void Test",
          _testFailurePoint: "after_update",
        }),
      /Simulated failure after void update/
    );

    const doc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(doc.isVoid, false, "Expense must remain active (isVoid = false)");
    assert.strictEqual(doc.version, 1, "Version must remain 1");
    assert.strictEqual(doc.voidReason, undefined);
    assert.strictEqual(testDb.auditLogs.size, 1, "No VOIDED audit log created");
  });

  // 5. Void rollback during audit log creation
  it("5. Void rollback: failure during audit leaves expense active and consistent", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          reason: "Audit failure on void",
          _testFailurePoint: "during_audit",
        }),
      /Simulated failure during audit log creation/
    );

    const doc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(doc.isVoid, false);
    assert.strictEqual(doc.version, 1);
    assert.strictEqual(testDb.auditLogs.size, 1);
  });

  // 6. Developer 3 Ledger Compatibility: soft-voided expenses preserve allocations without skewing balances
  it("6. Ledger compatibility: Developer 3 balance queries filtering isVoid=false correctly exclude voided expenses while allocations remain for audit", async () => {
    // Member 1 paid 3000 for member1, member2, and owner (1000 each)
    // Now void this expense
    await voidExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      reason: "Trip cancelled - voiding for ledger check",
    });

    // Developer 3 ledger query:
    // Only non-voided expenses are included in balance calculations
    const activeExpenses = Array.from(testDb.expenses.values()).filter(
      (exp) => exp.tripId.toString() === tripId && !exp.isVoid
    );

    assert.strictEqual(activeExpenses.length, 0, "Active expenses for ledger balance calculation must be empty");

    // But allocations are NOT deleted or zeroed (audit preservation)
    const storedAllocations = Array.from(testDb.allocations.values()).filter(
      (a) => a.expenseId.toString() === initialExpenseId
    );
    assert.strictEqual(storedAllocations.length, 3, "Allocations remain intact in database");
    assert.strictEqual(storedAllocations[0].amountMinor, 1000, "Allocation amounts are not zeroed or corrupted");
  });
});
