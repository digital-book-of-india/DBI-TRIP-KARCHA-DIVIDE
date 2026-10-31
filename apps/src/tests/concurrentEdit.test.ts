/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  editExpenseTransactional,
} from "../services/expenseService";

describe("Concurrent Edit Integration Tests (Optimistic Concurrency & Race Conditions)", () => {
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

    testDb.addUser({ _id: ownerId, name: "Admin Owner", email: "admin@test.com" });
    testDb.addUser({ _id: member1Id, name: "Member One", email: "m1@test.com" });
    testDb.addUser({ _id: member2Id, name: "Member Two", email: "m2@test.com" });

    testDb.addTrip({ _id: tripId, title: "Goa Trip", createdBy: ownerId });

    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, member1Id, "ADMIN");
    testDb.addTripMember(tripId, member2Id, "ADMIN");

    // Seed initial expense with version 1
    const created = await createExpenseTransactional({
      requestingUserId: member1Id,
      tripId,
      payerId: member1Id,
      title: "Initial Dinner",
      amountMinor: 5000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: member1Id }, { userId: member2Id }],
    });

    initialExpenseId = created.expenseId;
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Two concurrent edits with the same version
  it("1. Exactly one concurrent edit succeeds and the other fails with 409 Conflict", async () => {
    // Both edits start with version: 1
    const edit1Promise = editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "Concurrent Edit Winner 1",
      amountMinor: 6000,
    });

    const edit2Promise = editExpenseTransactional({
      requestingUserId: member2Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "Concurrent Edit Winner 2",
      amountMinor: 8000,
    });

    const results = await Promise.allSettled([edit1Promise, edit2Promise]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    // Exactly one must succeed and exactly one must fail
    assert.strictEqual(fulfilled.length, 1, "Exactly one edit must succeed");
    assert.strictEqual(rejected.length, 1, "Exactly one edit must fail");

    // Check rejection error
    const rejectionError = rejected[0].reason;
    assert.strictEqual(rejectionError.statusCode, 409);
    assert.strictEqual(rejectionError.code, "VERSION_CONFLICT");
    assert.strictEqual(
      rejectionError.message,
      "Expense was updated by someone else. Please refresh and try again."
    );

    // Final expense version in database must be exactly 2 (incremented by 1)
    const finalDoc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(finalDoc.version, 2, "Expense version must increment by exactly 1");

    // The document title and amount must match the winning edit
    const winnerData = fulfilled[0].value;
    assert.strictEqual(finalDoc.title, winnerData.title);
    assert.strictEqual(finalDoc.amountMinor, winnerData.amountMinor);

    // Audit logs must contain exactly 1 CREATED and 1 EDITED entry
    const auditLogs = Array.from(testDb.auditLogs.values());
    assert.strictEqual(auditLogs.length, 2, "Must contain exactly 1 CREATED and 1 EDITED log");
    const editLogs = auditLogs.filter((l) => l.action === "EDITED");
    assert.strictEqual(editLogs.length, 1, "Must contain exactly one EDITED audit log");
    assert.strictEqual(editLogs[0].newSnapshot.version, 2);
    assert.strictEqual(editLogs[0].newSnapshot.title, winnerData.title);
  });

  // 2. Sequential edit succeeds after refreshing with the new version
  it("2. Second edit succeeds when retried with refreshed version", async () => {
    // Edit 1: version 1 -> 2
    const firstResult = await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "Updated by Member 1",
      amountMinor: 7000,
    });
    assert.strictEqual(firstResult.version, 2);

    // Member 2 refreshes and now provides version 2
    const secondResult = await editExpenseTransactional({
      requestingUserId: member2Id,
      expenseId: initialExpenseId,
      version: 2,
      title: "Updated by Member 2 with Fresh Version",
      amountMinor: 7500,
    });
    assert.strictEqual(secondResult.version, 3);
    assert.strictEqual(secondResult.title, "Updated by Member 2 with Fresh Version");

    const finalDoc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(finalDoc.version, 3);
    assert.strictEqual(finalDoc.amountMinor, 7500);
  });

  // 3. Three simultaneous edits with the same version
  it("3. Three simultaneous edits: exactly 1 succeeds and 2 fail with 409 Conflict", async () => {
    const promises = [
      editExpenseTransactional({
        requestingUserId: member1Id,
        expenseId: initialExpenseId,
        version: 1,
        title: "Attempt A",
        amountMinor: 6000,
      }),
      editExpenseTransactional({
        requestingUserId: member2Id,
        expenseId: initialExpenseId,
        version: 1,
        title: "Attempt B",
        amountMinor: 7000,
      }),
      editExpenseTransactional({
        requestingUserId: ownerId,
        expenseId: initialExpenseId,
        version: 1,
        title: "Attempt C",
        amountMinor: 8000,
      }),
    ];

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Only 1 of 3 must succeed");
    assert.strictEqual(rejected.length, 2, "2 of 3 must fail");

    for (const rej of rejected) {
      assert.strictEqual((rej as PromiseRejectedResult).reason.statusCode, 409);
      assert.strictEqual((rej as PromiseRejectedResult).reason.code, "VERSION_CONFLICT");
    }

    const finalDoc = testDb.expenses.get(initialExpenseId);
    assert.strictEqual(finalDoc.version, 2);
  });
});
