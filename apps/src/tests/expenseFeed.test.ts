/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  getTripExpensesPaginated,
} from "../services/expenseService";

describe("Expense Feed Integration Tests", () => {
  let trip1Id: string;
  let trip2Id: string;
  let ownerId: string;
  let user1Id: string;
  let strangerId: string;

  beforeEach(async () => {
    setupTestDb();

    ownerId = createTestId();
    user1Id = createTestId();
    strangerId = createTestId();

    trip1Id = createTestId();
    trip2Id = createTestId();

    testDb.addUser({ _id: ownerId, name: "Owner", email: "owner@trip.com" });
    testDb.addUser({ _id: user1Id, name: "User One", email: "user1@trip.com" });
    testDb.addUser({ _id: strangerId, name: "Stranger", email: "stranger@other.com" });

    testDb.addTrip({ _id: trip1Id, title: "Trip Alpha", createdBy: ownerId });
    testDb.addTrip({ _id: trip2Id, title: "Trip Beta", createdBy: strangerId });

    testDb.addTripMember(trip1Id, ownerId, "ADMIN");
    testDb.addTripMember(trip1Id, user1Id, "MEMBER");

    testDb.addTripMember(trip2Id, strangerId, "ADMIN");

    // Populate Trip 1 with a few expenses
    await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId: trip1Id,
      payerId: ownerId,
      title: "Hotel Room",
      amountMinor: 8000,
      category: "stay",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }, { userId: user1Id }],
    });

    await createExpenseTransactional({
      requestingUserId: user1Id,
      tripId: trip1Id,
      payerId: user1Id,
      title: "Breakfast Buffet",
      amountMinor: 2000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }, { userId: user1Id }],
    });

    await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId: trip1Id,
      payerId: ownerId,
      title: "Theme Park Tickets",
      amountMinor: 5000,
      category: "tickets",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }, { userId: user1Id }],
    });

    // Populate Trip 2 with an isolated expense
    await createExpenseTransactional({
      requestingUserId: strangerId,
      tripId: trip2Id,
      payerId: strangerId,
      title: "Secret Trip 2 Expense",
      amountMinor: 9999,
      category: "other",
      splitType: "EQUAL",
      allocations: [{ userId: strangerId }],
    });
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Successful paginated feed
  it("1. Returns paginated expenses sorted consistently", async () => {
    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: trip1Id,
      page: 1,
      limit: 2,
    });

    assert.strictEqual(result.expenses.length, 2);
    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual(result.pagination.limit, 2);
    assert.strictEqual(result.pagination.totalCount, 3);
    assert.strictEqual(result.pagination.totalPages, 2);
    assert.strictEqual(result.pagination.hasNextPage, true);
    assert.strictEqual(result.pagination.hasPrevPage, false);

    // Verify preview fields
    const first = result.expenses[0];
    assert.ok(first.expenseId);
    assert.ok(first.title);
    assert.ok(first.amountMinor);
    assert.ok(first.payer.name);
    assert.strictEqual(first.allocationSummary.participantCount, 2);
  });

  // 2. Category filtering
  it("2. Filters expenses by category", async () => {
    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: trip1Id,
      category: "food",
    });

    assert.strictEqual(result.expenses.length, 1);
    assert.strictEqual(result.expenses[0].title, "Breakfast Buffet");
    assert.strictEqual(result.expenses[0].category, "food");
  });

  // 3. Voided expenses excluded by default
  it("3. Excludes voided expenses by default", async () => {
    // Mark one expense as voided in DB
    const anyExpense = Array.from(testDb.expenses.values()).find(
      (e) => e.tripId.toString() === trip1Id && e.title === "Hotel Room"
    );
    assert.ok(anyExpense);
    anyExpense.isVoid = true;

    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: trip1Id,
    });

    assert.strictEqual(result.expenses.length, 2);
    assert.ok(!result.expenses.some((e) => e.title === "Hotel Room"));
  });

  // 4. includeVoided behavior
  it("4. Includes voided expenses when includeVoided is true", async () => {
    const anyExpense = Array.from(testDb.expenses.values()).find(
      (e) => e.tripId.toString() === trip1Id && e.title === "Hotel Room"
    );
    assert.ok(anyExpense);
    anyExpense.isVoid = true;

    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: trip1Id,
      includeVoided: true,
    });

    assert.strictEqual(result.expenses.length, 3);
    const hotel = result.expenses.find((e) => e.title === "Hotel Room");
    assert.ok(hotel);
    assert.strictEqual(hotel.isVoid, true);
  });

  // 5. Non-member access denied
  it("5. Denies non-member access to trip expense feed with 403 Forbidden", async () => {
    await assert.rejects(
      () =>
        getTripExpensesPaginated({
          requestingUserId: strangerId, // Not a member of Trip 1
          tripId: trip1Id,
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_NOT_A_MEMBER");
        return true;
      }
    );
  });

  // 6. Invalid pagination parameters
  it("6. Rejects invalid pagination parameters (page < 1, limit < 1)", async () => {
    await assert.rejects(
      () =>
        getTripExpensesPaginated({
          requestingUserId: ownerId,
          tripId: trip1Id,
          page: 0,
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_PAGINATION");
        return true;
      }
    );

    await assert.rejects(
      () =>
        getTripExpensesPaginated({
          requestingUserId: ownerId,
          tripId: trip1Id,
          limit: -5,
        }),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_PAGINATION");
        return true;
      }
    );
  });

  // 7. Cross-trip data isolation
  it("7. Ensures strict cross-trip data isolation (no leakage)", async () => {
    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: trip1Id,
      limit: 50,
    });

    // Should only contain Trip 1 expenses
    assert.strictEqual(result.expenses.length, 3);
    assert.ok(!result.expenses.some((e) => e.title === "Secret Trip 2 Expense"));
  });

  // 8. Empty expense list
  it("8. Returns empty feed cleanly when a trip has no expenses", async () => {
    const emptyTripId = createTestId();
    testDb.addTrip({ _id: emptyTripId, title: "Empty Trip", createdBy: ownerId });
    testDb.addTripMember(emptyTripId, ownerId, "ADMIN");

    const result = await getTripExpensesPaginated({
      requestingUserId: ownerId,
      tripId: emptyTripId,
    });

    assert.deepStrictEqual(result.expenses, []);
    assert.strictEqual(result.pagination.totalCount, 0);
    assert.strictEqual(result.pagination.totalPages, 0);
  });
});
