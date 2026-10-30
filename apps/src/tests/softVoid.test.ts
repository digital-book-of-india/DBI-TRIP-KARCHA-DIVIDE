/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  voidExpenseTransactional,
  getTripExpensesPaginated,
  getExpenseDetail,
} from "../services/expenseService";

describe("Soft-Void Integration Tests (Preservation & Concurrency)", () => {
  let tripId: string;
  let ownerId: string;
  let payerId: string;
  let memberId: string;
  let strangerId: string;
  let expenseId: string;

  beforeEach(async () => {
    setupTestDb();

    ownerId = createTestId();
    payerId = createTestId();
    memberId = createTestId();
    strangerId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: ownerId, name: "Trip Admin", email: "admin@trip.com" });
    testDb.addUser({ _id: payerId, name: "Payer User", email: "payer@trip.com" });
    testDb.addUser({ _id: memberId, name: "Regular Member", email: "member@trip.com" });
    testDb.addUser({ _id: strangerId, name: "Stranger", email: "stranger@other.com" });

    testDb.addTrip({ _id: tripId, title: "Shimla Trip", createdBy: ownerId });

    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, payerId, "MEMBER");
    testDb.addTripMember(tripId, memberId, "MEMBER");

    // Create an initial expense
    const created = await createExpenseTransactional({
      requestingUserId: payerId,
      tripId,
      payerId,
      title: "Cable Car Tickets",
      amountMinor: 4500,
      category: "entertainment",
      splitType: "EQUAL",
      allocations: [{ userId: payerId }, { userId: memberId }, { userId: ownerId }],
    });

    expenseId = created.expenseId;
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Successfully soft-void an expense
  it("1. Successfully soft-voids an expense, sets isVoid=true, voidReason, voidedBy and increments version", async () => {
    const result = await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Accidental duplicate entry",
    });

    assert.strictEqual(result.expenseId, expenseId);
    assert.strictEqual(result.isVoid, true);
    assert.strictEqual(result.voidReason, "Accidental duplicate entry");
    assert.strictEqual(result.voidedBy, payerId);
    assert.strictEqual(result.version, 2);

    // Check database document
    const doc = testDb.expenses.get(expenseId);
    assert.strictEqual(doc.isVoid, true);
    assert.strictEqual(doc.voidReason, "Accidental duplicate entry");
    assert.strictEqual(doc.voidedBy.toString(), payerId);
    assert.strictEqual(doc.version, 2);
  });

  // 2. Preserves allocations in database completely
  it("2. Completely preserves existing allocations in database (Developer 3 ledger safety)", async () => {
    // Before void: 3 allocations
    assert.strictEqual(testDb.allocations.size, 3);

    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Event cancelled",
    });

    // After void: all 3 allocations must still exist in the database!
    assert.strictEqual(testDb.allocations.size, 3);
    const allocs = Array.from(testDb.allocations.values()).filter(
      (a) => a.expenseId.toString() === expenseId
    );
    assert.strictEqual(allocs.length, 3);
    const totalMinor = allocs.reduce((sum, a) => sum + a.amountMinor, 0);
    assert.strictEqual(totalMinor, 4500);
  });

  // 3. Creates VOIDED audit log entry
  it("3. Records VOIDED audit log entry with previousSnapshot and newSnapshot", async () => {
    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Wrong payment mode logged",
    });

    const logs = Array.from(testDb.auditLogs.values());
    const voidLog = logs.find((l) => l.action === "VOIDED");
    assert.ok(voidLog);
    assert.strictEqual(voidLog.changedBy.toString(), payerId);

    // previousSnapshot had isVoid = false, version = 1
    assert.strictEqual(voidLog.previousSnapshot.isVoid, false);
    assert.strictEqual(voidLog.previousSnapshot.version, 1);
    assert.strictEqual(voidLog.previousSnapshot.allocations.length, 3);

    // newSnapshot has isVoid = true, version = 2, voidReason
    assert.strictEqual(voidLog.newSnapshot.isVoid, true);
    assert.strictEqual(voidLog.newSnapshot.version, 2);
    assert.strictEqual(voidLog.newSnapshot.voidReason, "Wrong payment mode logged");
    assert.strictEqual(voidLog.newSnapshot.voidedBy, payerId);
  });

  // 4. Stale version rejection
  it("4. Rejects soft-void with stale version returning 409 Conflict", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: payerId,
          expenseId,
          version: 99, // Stale version
          reason: "Duplicate",
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

  // 5. Rejects voiding an already voided expense
  it("5. Rejects voiding an already voided expense with 400 Bad Request", async () => {
    // First void
    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Initial void",
    });

    // Second void attempt
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: payerId,
          expenseId,
          version: 2,
          reason: "Trying to void again",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "EXPENSE_ALREADY_VOIDED");
        assert.strictEqual(err.message, "Cannot void an already voided expense");
        return true;
      }
    );
  });

  // 6. Rejects empty void reason
  it("6. Rejects empty or whitespace void reason with 400 Bad Request", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: payerId,
          expenseId,
          version: 1,
          reason: "   ",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_VOID_REASON");
        return true;
      }
    );
  });

  // 7. Authorization: Payer can void
  it("7. Allows original payer to void the expense", async () => {
    const res = await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Payer voided",
    });
    assert.strictEqual(res.isVoid, true);
  });

  // 8. Authorization: Trip ADMIN can void
  it("8. Allows trip ADMIN to void an expense paid by another member", async () => {
    const res = await voidExpenseTransactional({
      requestingUserId: ownerId, // ADMIN
      expenseId,
      version: 1,
      reason: "Admin voided erroneous bill",
    });
    assert.strictEqual(res.isVoid, true);
    assert.strictEqual(res.voidedBy, ownerId);
  });

  // 9. Authorization: Non-admin member cannot void
  it("9. Denies non-admin member permission to void another member's expense with 403", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: memberId, // Regular member, not payer
          expenseId,
          version: 1,
          reason: "Unauthorized void",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_UNAUTHORIZED_ROLE");
        return true;
      }
    );
  });

  // 10. Authorization: Non-member cannot void
  it("10. Denies non-trip member permission to void expense with 403", async () => {
    await assert.rejects(
      () =>
        voidExpenseTransactional({
          requestingUserId: strangerId,
          expenseId,
          version: 1,
          reason: "Stranger void",
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_NOT_A_MEMBER");
        return true;
      }
    );
  });

  // 11. Feed filtering: default excludes voided, includeVoided=true includes voided
  it("11. Verifies expense feed excludes voided expenses by default, includes when includeVoided=true", async () => {
    // Void the expense
    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Void for feed test",
    });

    // Default feed
    const defaultFeed = await getTripExpensesPaginated({
      tripId,
      requestingUserId: payerId,
    });
    assert.strictEqual(defaultFeed.expenses.length, 0, "Default feed must exclude voided expense");
    assert.strictEqual(defaultFeed.pagination.totalCount, 0);

    // includeVoided: true
    const voidedFeed = await getTripExpensesPaginated({
      tripId,
      requestingUserId: payerId,
      includeVoided: true,
    });
    assert.strictEqual(voidedFeed.expenses.length, 1, "Feed with includeVoided=true must include voided expense");
    assert.strictEqual(voidedFeed.expenses[0].isVoid, true);
  });

  // 12. Detail query returns voidReason and voidedBy
  it("12. Verifies GET expense detail query returns isVoid=true, voidReason and populated voidedBy", async () => {
    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId,
      version: 1,
      reason: "Detail inspection void reason",
    });

    const detail = await getExpenseDetail(expenseId, payerId);
    assert.strictEqual(detail.isVoid, true);
    assert.strictEqual(detail.voidReason, "Detail inspection void reason");
    assert.ok(detail.voidedBy);
    assert.strictEqual(detail.voidedBy.userId, payerId);
    assert.strictEqual(detail.voidedBy.name, "Payer User");
  });
});
