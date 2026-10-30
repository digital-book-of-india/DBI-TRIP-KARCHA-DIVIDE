/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { createExpenseTransactional } from "../services/expenseService";

describe("Expense Creation Integration Tests", () => {
  let tripId: string;
  let ownerId: string;
  let user1Id: string;
  let user2Id: string;
  let nonMemberId: string;

  beforeEach(() => {
    setupTestDb();

    ownerId = createTestId();
    user1Id = createTestId();
    user2Id = createTestId();
    nonMemberId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: ownerId, name: "Owner User", email: "owner@test.com" });
    testDb.addUser({ _id: user1Id, name: "Member One", email: "user1@test.com" });
    testDb.addUser({ _id: user2Id, name: "Member Two", email: "user2@test.com" });
    testDb.addUser({ _id: nonMemberId, name: "Stranger", email: "stranger@test.com" });

    testDb.addTrip({ _id: tripId, title: "Goa Vacation", createdBy: ownerId });

    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, user1Id, "MEMBER");
    testDb.addTripMember(tripId, user2Id, "MEMBER");
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Successful equal split expense creation
  it("1. Successfully creates an equal split expense", async () => {
    const result = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId,
      payerId: ownerId,
      title: "Resort Stay",
      amountMinor: 10000,
      category: "stay",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }, { userId: user1Id }, { userId: user2Id }],
    });

    assert.ok(result.expenseId);
    assert.strictEqual(result.title, "Resort Stay");
    assert.strictEqual(result.amountMinor, 10000);
    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.isVoid, false);
    assert.strictEqual(result.allocations.length, 3);

    // Sum must equal 10000
    const sum = result.allocations.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);

    // Verify database state
    assert.strictEqual(testDb.expenses.size, 1);
    assert.strictEqual(testDb.allocations.size, 3);
    assert.strictEqual(testDb.auditLogs.size, 1);
  });

  // 2. Successful exact split creation
  it("2. Successfully creates an exact split expense", async () => {
    const result = await createExpenseTransactional({
      requestingUserId: user1Id,
      tripId,
      payerId: user1Id,
      title: "Groceries",
      amountMinor: 5000,
      category: "food",
      splitType: "EXACT",
      allocations: [
        { userId: ownerId, amountMinor: 2000 },
        { userId: user1Id, amountMinor: 3000 },
      ],
    });

    assert.strictEqual(result.amountMinor, 5000);
    assert.strictEqual(result.allocations.length, 2);
    assert.strictEqual(result.allocations[0].amountMinor, 2000);
    assert.strictEqual(result.allocations[1].amountMinor, 3000);

    assert.strictEqual(testDb.expenses.size, 1);
    assert.strictEqual(testDb.allocations.size, 2);
  });

  // 3. Successful percentage split creation
  it("3. Successfully creates a percentage split expense", async () => {
    const result = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId,
      payerId: user2Id,
      title: "Flight Tickets",
      amountMinor: 10000,
      category: "travel",
      splitType: "PERCENTAGE",
      allocations: [
        { userId: ownerId, percentage: 33.34 },
        { userId: user1Id, percentage: 33.33 },
        { userId: user2Id, percentage: 33.33 },
      ],
    });

    assert.strictEqual(result.amountMinor, 10000);
    const sum = result.allocations.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
    assert.strictEqual(testDb.expenses.size, 1);
  });

  // 4. Invalid trip ID
  it("4. Rejects invalid trip ID format", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId: "invalid_trip_id",
          payerId: ownerId,
          title: "Dinner",
          amountMinor: 2000,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_TRIP_ID");
        return true;
      }
    );
  });

  // 5. Invalid payer ID
  it("5. Rejects invalid payer ID format", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: "not_a_valid_id",
          title: "Dinner",
          amountMinor: 2000,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_PAYER_ID");
        return true;
      }
    );
  });

  // 6. Non-member payer
  it("6. Rejects expense creation when payer is not a trip member", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: nonMemberId, // Stranger
          title: "Dinner",
          amountMinor: 2000,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "NOT_A_TRIP_MEMBER");
        return true;
      }
    );
  });

  // 7. Non-member allocation participant
  it("7. Rejects expense creation when an allocation participant is not a member", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Cab Fare",
          amountMinor: 3000,
          category: "travel",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }, { userId: nonMemberId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "NOT_A_TRIP_MEMBER");
        return true;
      }
    );
  });

  // 8. Duplicate allocation participant
  it("8. Rejects duplicate allocation participants", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Snacks",
          amountMinor: 2000,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: user1Id }, { userId: user1Id }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "DUPLICATE_PARTICIPANT");
        return true;
      }
    );
  });

  // 9. Invalid split type
  it("9. Rejects invalid split type", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Snacks",
          amountMinor: 2000,
          category: "food",
          splitType: "UNSUPPORTED" as any,
          allocations: [{ userId: user1Id }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_SPLIT_TYPE");
        return true;
      }
    );
  });

  // 10. Negative amount
  it("10. Rejects negative or non-positive amountMinor", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Snacks",
          amountMinor: -500,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: user1Id }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_AMOUNT");
        return true;
      }
    );
  });

  // 11. Allocation sum mismatch
  it("11. Rejects EXACT split when allocation sum does not match amountMinor", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Train Tickets",
          amountMinor: 5000,
          category: "travel",
          splitType: "EXACT",
          allocations: [
            { userId: ownerId, amountMinor: 2000 },
            { userId: user1Id, amountMinor: 2000 }, // Sum is 4000 vs 5000
          ],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  // 12. Missing required fields
  it("12. Rejects missing required fields (empty title or category)", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "   ",
          amountMinor: 5000,
          category: "food",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }],
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_TITLE");
        return true;
      }
    );
  });

  // 13. Transaction rollback when allocation insertion fails
  it("13. Transaction rollback: prevents partial expense when allocation fails", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Rollback Test 1",
          amountMinor: 6000,
          category: "other",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }, { userId: user1Id }],
          _testFailurePoint: "after_expense",
        }),
      /Simulated failure after expense creation/
    );

    // Verify zero documents remain committed
    assert.strictEqual(testDb.expenses.size, 0, "Expenses collection must be empty after rollback");
    assert.strictEqual(testDb.allocations.size, 0, "Allocations collection must be empty after rollback");
    assert.strictEqual(testDb.auditLogs.size, 0, "Audit logs collection must be empty after rollback");
  });

  // 14. Transaction rollback when audit log insertion fails
  it("14. Transaction rollback: prevents partial write when audit log insertion fails", async () => {
    await assert.rejects(
      () =>
        createExpenseTransactional({
          requestingUserId: ownerId,
          tripId,
          payerId: ownerId,
          title: "Rollback Test 2",
          amountMinor: 6000,
          category: "other",
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }, { userId: user1Id }],
          _testFailurePoint: "during_audit",
        }),
      /Simulated failure during audit log creation/
    );

    // Verify zero documents remain committed
    assert.strictEqual(testDb.expenses.size, 0, "Expenses collection must be empty after rollback");
    assert.strictEqual(testDb.allocations.size, 0, "Allocations collection must be empty after rollback");
    assert.strictEqual(testDb.auditLogs.size, 0, "Audit logs collection must be empty after rollback");
  });

  // 15. Verify CREATED audit entry
  it("15. Verifies CREATED audit entry is recorded with full newSnapshot", async () => {
    const result = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId,
      payerId: ownerId,
      title: "Sunset Cruise",
      amountMinor: 9000,
      category: "tickets",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }, { userId: user1Id }, { userId: user2Id }],
    });

    assert.strictEqual(testDb.auditLogs.size, 1);
    const audit = Array.from(testDb.auditLogs.values())[0];

    assert.strictEqual(audit.expenseId.toString(), result.expenseId);
    assert.strictEqual(audit.action, "CREATED");
    assert.strictEqual(audit.changedBy.toString(), ownerId);
    assert.strictEqual(audit.previousSnapshot, null);

    assert.ok(audit.newSnapshot);
    assert.strictEqual(audit.newSnapshot.title, "Sunset Cruise");
    assert.strictEqual(audit.newSnapshot.amountMinor, 9000);
    assert.strictEqual(audit.newSnapshot.allocations.length, 3);
  });
});
