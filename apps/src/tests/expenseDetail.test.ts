/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import {
  createExpenseTransactional,
  getExpenseDetail,
} from "../services/expenseService";

describe("Expense Detail Integration Tests", () => {
  let trip1Id: string;
  let trip2Id: string;
  let ownerId: string;
  let user1Id: string;
  let strangerId: string;
  let expense1Id: string;

  beforeEach(async () => {
    setupTestDb();

    ownerId = createTestId();
    user1Id = createTestId();
    strangerId = createTestId();

    trip1Id = createTestId();
    trip2Id = createTestId();

    testDb.addUser({ _id: ownerId, name: "Owner Alice", email: "alice@test.com" });
    testDb.addUser({ _id: user1Id, name: "User Bob", email: "bob@test.com" });
    testDb.addUser({ _id: strangerId, name: "Stranger Eve", email: "eve@test.com" });

    testDb.addTrip({ _id: trip1Id, title: "Trip 1", createdBy: ownerId });
    testDb.addTrip({ _id: trip2Id, title: "Trip 2", createdBy: strangerId });

    testDb.addTripMember(trip1Id, ownerId, "ADMIN");
    testDb.addTripMember(trip1Id, user1Id, "MEMBER");

    testDb.addTripMember(trip2Id, strangerId, "ADMIN");

    const created = await createExpenseTransactional({
      requestingUserId: ownerId,
      tripId: trip1Id,
      payerId: ownerId,
      title: "Scuba Diving",
      amountMinor: 12000,
      category: "tickets",
      splitType: "EXACT",
      allocations: [
        { userId: ownerId, amountMinor: 7000 },
        { userId: user1Id, amountMinor: 5000 },
      ],
    });

    expense1Id = created.expenseId;
  });

  afterEach(() => {
    teardownTestDb();
  });

  // 1. Successful detail retrieval
  it("1. Successfully retrieves full expense details", async () => {
    const detail = await getExpenseDetail(expense1Id, user1Id);

    assert.strictEqual(detail.expenseId, expense1Id);
    assert.strictEqual(detail.title, "Scuba Diving");
    assert.strictEqual(detail.amountMinor, 12000);
    assert.strictEqual(detail.category, "tickets");
    assert.strictEqual(detail.splitType, "EXACT");
    assert.strictEqual(detail.version, 1);
    assert.strictEqual(detail.isVoid, false);
    assert.ok(detail.createdAt);
  });

  // 2. Correct payer details
  it("2. Returns populated payer information without sensitive password fields", async () => {
    const detail = await getExpenseDetail(expense1Id, ownerId);

    assert.strictEqual(detail.payer.userId, ownerId);
    assert.strictEqual(detail.payer.name, "Owner Alice");
    assert.strictEqual(detail.payer.email, "alice@test.com");
    assert.strictEqual((detail.payer as any).passwordHash, undefined);
  });

  // 3. Correct allocation breakdown
  it("3. Returns complete participant allocation breakdown", async () => {
    const detail = await getExpenseDetail(expense1Id, ownerId);

    assert.strictEqual(detail.allocations.length, 2);

    const alloc1 = detail.allocations.find((a) => a.userId === ownerId);
    assert.ok(alloc1);
    assert.strictEqual(alloc1.amountMinor, 7000);
    assert.strictEqual(alloc1.name, "Owner Alice");

    const alloc2 = detail.allocations.find((a) => a.userId === user1Id);
    assert.ok(alloc2);
    assert.strictEqual(alloc2.amountMinor, 5000);
    assert.strictEqual(alloc2.name, "User Bob");
  });

  // 4. Correct audit history (chronologically sorted)
  it("4. Returns audit history sorted chronologically", async () => {
    const detail = await getExpenseDetail(expense1Id, user1Id);

    assert.strictEqual(detail.auditHistory.length, 1);
    const entry = detail.auditHistory[0];
    assert.strictEqual(entry.action, "CREATED");
    assert.strictEqual(entry.changedBy.userId, ownerId);
    assert.strictEqual(entry.changedBy.name, "Owner Alice");
    assert.ok(entry.timestamp);
    assert.ok(entry.newSnapshot);
  });

  // 5. Non-member access denied
  it("5. Denies non-member access to expense details with 403 Forbidden", async () => {
    await assert.rejects(
      () => getExpenseDetail(expense1Id, strangerId),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_NOT_A_MEMBER");
        return true;
      }
    );
  });

  // 6. Invalid expense ID
  it("6. Rejects malformed expense ID with 400 Bad Request", async () => {
    await assert.rejects(
      () => getExpenseDetail("malformed_id_xyz", ownerId),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_EXPENSE_ID");
        return true;
      }
    );
  });

  // 7. Non-existent expense
  it("7. Returns 404 Not Found for non-existent expense ID", async () => {
    const nonExistentId = createTestId();
    await assert.rejects(
      () => getExpenseDetail(nonExistentId, ownerId),
      (err: any) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "NOT_FOUND");
        return true;
      }
    );
  });

  // 8. Cross-trip access denied
  it("8. Denies access to expense when user is a member of another trip but not this trip", async () => {
    // Stranger is an ADMIN of Trip 2, but NOT a member of Trip 1
    await assert.rejects(
      () => getExpenseDetail(expense1Id, strangerId),
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "FORBIDDEN_NOT_A_MEMBER");
        return true;
      }
    );
  });
});
