/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { createExpenseTransactional, editExpenseTransactional, voidExpenseTransactional } from "../services/expenseService";

/**
 * The PDF spec requires in-app notifications for new expenses, edits and
 * voids (section 6, "Notification and activity rules"), excluding the actor
 * who triggered the event. These were previously missing entirely -- no
 * notification of any kind was ever created for expense events, only for
 * settlement events. This locks in the fix.
 */
describe("Expense event notifications", () => {
  let tripId: string;
  let payerId: string, memberId: string, otherMemberId: string;

  beforeEach(() => {
    setupTestDb();
    payerId = createTestId();
    memberId = createTestId();
    otherMemberId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: payerId, name: "Payer", email: "payer@test.com" });
    testDb.addUser({ _id: memberId, name: "Member", email: "member@test.com" });
    testDb.addUser({ _id: otherMemberId, name: "Other", email: "other@test.com" });
    testDb.addTrip({ _id: tripId, title: "Goa Trip", createdBy: payerId });
    testDb.addTripMember(tripId, payerId, "ADMIN");
    testDb.addTripMember(tripId, memberId, "MEMBER");
    testDb.addTripMember(tripId, otherMemberId, "MEMBER");
  });

  afterEach(() => teardownTestDb());

  it("notifies participants of their personal share on creation, but not the actor", async () => {
    await createExpenseTransactional({
      requestingUserId: payerId,
      tripId,
      payerId,
      title: "Dinner",
      amountMinor: 3000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: payerId }, { userId: memberId }, { userId: otherMemberId }],
    });

    const notifs = [...testDb.notifications.values()];
    assert.strictEqual(notifs.length, 2, "Only the two non-actor participants should be notified");
    assert.ok(!notifs.some((n: any) => n.userId === payerId), "Actor must not be notified of their own expense");
    const memberNotif = notifs.find((n: any) => n.userId === memberId) as any;
    assert.ok(memberNotif.message.includes("10.00"), "Notification should include the recipient's own share");
  });

  it("notifies other trip members (not the actor) when an expense is edited", async () => {
    const created = await createExpenseTransactional({
      requestingUserId: payerId,
      tripId,
      payerId,
      title: "Dinner",
      amountMinor: 3000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: payerId }, { userId: memberId }, { userId: otherMemberId }],
    });
    testDb.notifications.clear();

    await editExpenseTransactional({
      requestingUserId: payerId,
      expenseId: created.expenseId,
      version: created.version,
      amountMinor: 6000,
      allocations: [{ userId: payerId }, { userId: memberId }, { userId: otherMemberId }],
    });

    const notifs = [...testDb.notifications.values()];
    assert.strictEqual(notifs.length, 2);
    assert.ok(!notifs.some((n: any) => n.userId === payerId));
    assert.ok(notifs.every((n: any) => n.title === "Expense updated"));
  });

  it("notifies other trip members (not the actor) when an expense is voided", async () => {
    const created = await createExpenseTransactional({
      requestingUserId: payerId,
      tripId,
      payerId,
      title: "Dinner",
      amountMinor: 3000,
      category: "food",
      splitType: "EQUAL",
      allocations: [{ userId: payerId }, { userId: memberId }, { userId: otherMemberId }],
    });
    testDb.notifications.clear();

    await voidExpenseTransactional({
      requestingUserId: payerId,
      expenseId: created.expenseId,
      version: created.version,
      reason: "Duplicate",
    });

    const notifs = [...testDb.notifications.values()];
    assert.strictEqual(notifs.length, 2);
    assert.ok(!notifs.some((n: any) => n.userId === payerId));
    assert.ok(notifs.every((n: any) => n.title === "Expense voided"));
  });
});
