/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  editExpenseTransactional,
} from "../services/expenseService";

describe("Expense Edit Integration Tests (Optimistic Concurrency & Authorization)", () => {
  let tripId: string;
  let ownerId: string;
  let member1Id: string;
  let member2Id: string;
  let nonMemberId: string;
  let initialExpenseId: string;

  beforeEach(async () => {
    setupTestDb();

    ownerId = createTestId();
    member1Id = createTestId();
    member2Id = createTestId();
    nonMemberId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: ownerId, name: "Admin Owner", email: "admin@test.com" });
    testDb.addUser({ _id: member1Id, name: "Member One", email: "m1@test.com" });
    testDb.addUser({ _id: member2Id, name: "Member Two", email: "m2@test.com" });
    testDb.addUser({ _id: nonMemberId, name: "Outsider", email: "outsider@test.com" });

    testDb.addTrip({ _id: tripId, title: "Manali Roadtrip", createdBy: ownerId });

    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, member1Id, "MEMBER");
    testDb.addTripMember(tripId, member2Id, "MEMBER");

    // Seed an initial expense paid by member1
    const created = await createExpenseTransactional({
      requestingUserId: member1Id,
      tripId,
      payerId: member1Id,
      title: "Highway Tolls",
      amountMinor: 3000,
      category: "travel",
      splitType: "EQUAL",
      allocations: [{ userId: member1Id }, { userId: member2Id }, { userId: ownerId }],
    });

    initialExpenseId = created.expenseId;
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Successful edit with version increment
  it("1. Successfully updates title, category, amount and increments version", async () => {
    const updated = await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "Highway & Express Tolls",
      category: "transport",
      amountMinor: 6000,
    });

    assert.strictEqual(updated.title, "Highway & Express Tolls");
    assert.strictEqual(updated.category, "transport");
    assert.strictEqual(updated.amountMinor, 6000);
    assert.strictEqual(updated.version, 2);
    assert.strictEqual(updated.allocations.length, 3);
    // 6000 divided among 3 is 2000 each
    for (const alloc of updated.allocations) {
      assert.strictEqual(alloc.amountMinor, 2000);
    }
  });

  // 2. Change split type from EQUAL to EXACT
  it("2. Successfully updates split type to EXACT with custom allocations", async () => {
    const updated = await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      amountMinor: 5000,
      splitType: "EXACT",
      allocations: [
        { userId: member1Id, amountMinor: 3000 },
        { userId: member2Id, amountMinor: 2000 },
      ],
    });

    assert.strictEqual(updated.splitType, "EXACT");
    assert.strictEqual(updated.amountMinor, 5000);
    assert.strictEqual(updated.version, 2);
    assert.strictEqual(updated.allocations.length, 2);

    const m1Alloc = updated.allocations.find((a) => a.userId === member1Id);
    const m2Alloc = updated.allocations.find((a) => a.userId === member2Id);
    assert.strictEqual(m1Alloc?.amountMinor, 3000);
    assert.strictEqual(m2Alloc?.amountMinor, 2000);
  });

  // 3. Change split type to PERCENTAGE
  it("3. Successfully updates split type to PERCENTAGE with deterministic paise distribution", async () => {
    const updated = await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      amountMinor: 10000,
      splitType: "PERCENTAGE",
      allocations: [
        { userId: member1Id, percentage: 50 },
        { userId: member2Id, percentage: 30 },
        { userId: ownerId, percentage: 20 },
      ],
    });

    assert.strictEqual(updated.splitType, "PERCENTAGE");
    assert.strictEqual(updated.version, 2);
    assert.strictEqual(updated.allocations.length, 3);
    const totalMinor = updated.allocations.reduce((acc, a) => acc + a.amountMinor, 0);
    assert.strictEqual(totalMinor, 10000);
  });

  // 4. Verifies old allocations are replaced cleanly
  it("4. Replaces old allocations without leaving orphan allocation documents", async () => {
    // Before edit: 3 allocations
    assert.strictEqual(testDb.allocations.size, 3);

    // Edit to have only 1 allocation
    await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      amountMinor: 2500,
      splitType: "EQUAL",
      allocations: [{ userId: member1Id }],
    });

    // After edit: only 1 allocation must exist in database
    assert.strictEqual(testDb.allocations.size, 1);
    const remainingAlloc = Array.from(testDb.allocations.values())[0];
    assert.strictEqual(remainingAlloc.userId.toString(), member1Id);
    assert.strictEqual(remainingAlloc.amountMinor, 2500);
  });

  // 5. Stale version rejection with HTTP 409
  it("5. Rejects stale update with HTTP 409 Conflict when version does not match", async () => {
    // First update: version 1 -> 2
    await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "First Edit",
    });

    // Second update trying to use stale version 1
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          title: "Stale Edit Attempt",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "VERSION_CONFLICT");
        assert.strictEqual(
          err.message,
          "Expense was updated by someone else. Please refresh and try again."
        );
        return true;
      }
    );
  });

  // 6. Admin can edit an expense paid by someone else
  it("6. Allows trip ADMIN to edit an expense paid by another member", async () => {
    const updated = await editExpenseTransactional({
      requestingUserId: ownerId, // ADMIN
      expenseId: initialExpenseId,
      version: 1,
      title: "Admin Corrected Tolls",
    });

    assert.strictEqual(updated.title, "Admin Corrected Tolls");
    assert.strictEqual(updated.version, 2);
  });

  // 7. Non-admin member cannot edit an expense paid by someone else
  it("7. Denies non-admin member permission to edit another member's expense with 403", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member2Id, // Regular MEMBER, not the payer (member1 is payer)
          expenseId: initialExpenseId,
          version: 1,
          title: "Unauthorized Edit",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_UNAUTHORIZED_ROLE");
        return true;
      }
    );
  });

  // 8. Non-trip member cannot edit expense
  it("8. Denies non-trip member permission to edit expense with 403", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: nonMemberId,
          expenseId: initialExpenseId,
          version: 1,
          title: "Intruder Edit",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_NOT_A_MEMBER");
        return true;
      }
    );
  });

  // 9. Cannot edit an already voided expense
  it("9. Rejects editing an already voided expense with 400 Bad Request", async () => {
    const exp = testDb.expenses.get(initialExpenseId);
    exp.isVoid = true;
    testDb.expenses.set(initialExpenseId, exp);

    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          title: "Attempt to revive voided",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "EXPENSE_ALREADY_VOIDED");
        return true;
      }
    );
  });

  // 10. Rejects missing or invalid version
  it("10. Rejects invalid or missing version parameter with 400 Bad Request", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 0 as any,
          title: "Bad Version",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_VERSION");
        return true;
      }
    );
  });

  // 11. Rejects invalid amountMinor
  it("11. Rejects negative or non-safe integer amountMinor with 400 Bad Request", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          amountMinor: -100,
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_AMOUNT");
        return true;
      }
    );
  });

  // 12. Rejects participant outside the trip
  it("12. Rejects allocation participant who is not a trip member with 400 Bad Request", async () => {
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: initialExpenseId,
          version: 1,
          splitType: "EQUAL",
          allocations: [{ userId: member1Id }, { userId: nonMemberId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "NOT_A_TRIP_MEMBER");
        return true;
      }
    );
  });

  // 13. Returns 404 for non-existent expense
  it("13. Returns 404 Not Found when expense does not exist", async () => {
    const fakeId = createTestId();
    await assert.rejects(
      () =>
        editExpenseTransactional({
          requestingUserId: member1Id,
          expenseId: fakeId,
          version: 1,
          title: "Ghost Expense",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "NOT_FOUND");
        return true;
      }
    );
  });

  // 14. Verifies EDITED audit log creation with snapshots
  it("14. Verifies EDITED audit log entry records complete previousSnapshot and newSnapshot", async () => {
    // Initial audit logs count = 1 (from create)
    assert.strictEqual(testDb.auditLogs.size, 1);

    await editExpenseTransactional({
      requestingUserId: member1Id,
      expenseId: initialExpenseId,
      version: 1,
      title: "Updated Title for Audit",
      amountMinor: 4500,
      category: "food",
    });

    // Now 2 audit logs
    assert.strictEqual(testDb.auditLogs.size, 2);
    const logs = Array.from(testDb.auditLogs.values());
    const editLog = logs.find((l) => l.action === "EDITED");
    assert.ok(editLog);
    assert.strictEqual(editLog.changedBy.toString(), member1Id);

    // previousSnapshot check
    assert.strictEqual(editLog.previousSnapshot.title, "Highway Tolls");
    assert.strictEqual(editLog.previousSnapshot.amountMinor, 3000);
    assert.strictEqual(editLog.previousSnapshot.version, 1);
    assert.strictEqual(editLog.previousSnapshot.allocations.length, 3);

    // newSnapshot check
    assert.strictEqual(editLog.newSnapshot.title, "Updated Title for Audit");
    assert.strictEqual(editLog.newSnapshot.amountMinor, 4500);
    assert.strictEqual(editLog.newSnapshot.version, 2);
    assert.strictEqual(editLog.newSnapshot.allocations.length, 3);
  });
});
