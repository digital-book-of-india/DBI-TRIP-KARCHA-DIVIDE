import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { createExpenseTransactional } from "../services/expenseService";

describe("Expense note/receiptUrl and idempotency key", () => {
  let tripId: string;
  let ownerId: string;

  beforeEach(() => {
    setupTestDb();
    ownerId = createTestId();
    tripId = createTestId();
    testDb.addUser({ _id: ownerId, name: "Owner", email: "owner@test.com" });
    testDb.addTrip({ _id: tripId, title: "Trip", createdBy: ownerId });
    testDb.addTripMember(tripId, ownerId, "ADMIN");
  });

  afterEach(() => teardownTestDb());

  it("stores an optional note and receiptUrl on the expense", async () => {
    const result = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId,
      payerId: ownerId,
      title: "Hotel",
      amountMinor: 10000,
      category: "stay",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }],
      note: "Paid in cash",
      receiptUrl: "https://example.com/receipt.jpg",
    });

    assert.strictEqual(result.note, "Paid in cash");
    assert.strictEqual(result.receiptUrl, "https://example.com/receipt.jpg");
  });

  it("rejects a malformed receiptUrl", async () => {
    await assert.rejects(() =>
      createExpenseTransactional({
        requestingUserId: ownerId,
        tripId,
        payerId: ownerId,
        title: "Hotel",
        amountMinor: 10000,
        category: "stay",
        splitType: "EQUAL",
        allocations: [{ userId: ownerId }],
        receiptUrl: "not-a-url",
      })
    );
  });

  it("returns the same expense on a retried request with the same idempotency key, instead of creating a duplicate", async () => {
    const payload = {
      requestingUserId: ownerId,
      tripId,
      payerId: ownerId,
      title: "Petrol",
      amountMinor: 50000,
      category: "travel",
      splitType: "EQUAL" as const,
      allocations: [{ userId: ownerId }],
      idempotencyKey: "retry-key-123",
    };

    const first = await createExpenseTransactional(payload);
    assert.strictEqual(first.idempotentReplay, undefined);

    const retried = await createExpenseTransactional(payload);
    assert.strictEqual(retried.idempotentReplay, true);
    assert.strictEqual(retried.expenseId, first.expenseId);

    const allExpensesInTrip = [...testDb.expenses.values()].filter((e: { tripId: string }) => e.tripId === tripId);
    assert.strictEqual(allExpensesInTrip.length, 1, "Retry must not create a second expense row");
  });

  it("allows the same idempotency key to be reused across different trips", async () => {
    const otherTripId = createTestId();
    testDb.addTrip({ _id: otherTripId, title: "Other Trip", createdBy: ownerId });
    testDb.addTripMember(otherTripId, ownerId, "ADMIN");

    const key = "shared-key";
    const a = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId,
      payerId: ownerId,
      title: "Lunch",
      amountMinor: 1000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }],
      idempotencyKey: key,
    });
    const b = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId: otherTripId,
      payerId: ownerId,
      title: "Lunch",
      amountMinor: 1000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: ownerId }],
      idempotencyKey: key,
    });

    assert.notStrictEqual(a.expenseId, b.expenseId);
  });
});
