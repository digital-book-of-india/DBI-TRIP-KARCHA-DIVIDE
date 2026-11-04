import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { POST as createExpenseRoute, GET as getTripExpensesRoute } from "../app/api/trips/[tripId]/expenses/route";
import { GET as getExpenseDetailRoute, PATCH as editExpenseRoute } from "../app/api/expenses/[expenseId]/route";
import { POST as voidExpenseRoute } from "../app/api/expenses/[expenseId]/void/route";
import { createExpenseTransactional } from "../services/expenseService";
import { signAuthToken } from "../lib/auth/authMiddleware";

describe("Expense API Route Handlers Integration Tests", () => {
  let tripId: string;
  let ownerId: string;
  let memberId: string;
  let strangerId: string;

  beforeEach(() => {
    setupTestDb();

    ownerId = createTestId();
    memberId = createTestId();
    strangerId = createTestId();
    tripId = createTestId();

    testDb.addUser({ _id: ownerId, name: "Owner", email: "owner@trip.com" });
    testDb.addUser({ _id: memberId, name: "Member", email: "member@trip.com" });
    testDb.addUser({ _id: strangerId, name: "Stranger", email: "stranger@test.com" });

    testDb.addTrip({ _id: tripId, title: "Kerala Trip", createdBy: ownerId });
    testDb.addTripMember(tripId, ownerId, "ADMIN");
    testDb.addTripMember(tripId, memberId, "MEMBER");
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe("POST /api/trips/[tripId]/expenses Route Handler", () => {
    it("returns 401 when request is unauthenticated", async () => {
      const req = new NextRequest(`http://localhost:3000/api/trips/${tripId}/expenses`, {
        method: "POST",
        body: JSON.stringify({ title: "Test" }),
      });

      const res = await createExpenseRoute(req, {
        params: Promise.resolve({ tripId }),
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.error, /Authentication required/);
    });

    it("returns 201 and created expense on valid request", async () => {
      const token = signAuthToken({ userId: ownerId, email: "owner@trip.com" });
      const req = new NextRequest(`http://localhost:3000/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Houseboat Rental",
          amountMinor: 15000,
          category: "stay",
          payerId: ownerId,
          splitType: "EQUAL",
          allocations: [{ userId: ownerId }, { userId: memberId }],
        }),
      });

      const res = await createExpenseRoute(req, {
        params: Promise.resolve({ tripId }),
      });

      assert.strictEqual(res.status, 201);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.expenseId);
      assert.strictEqual(json.data.title, "Houseboat Rental");
      assert.strictEqual(json.data.allocations.length, 2);
    });

    it("returns 403 when requesting user is not a trip member", async () => {
      const token = signAuthToken({ userId: strangerId, email: "stranger@test.com" });
      const req = new NextRequest(`http://localhost:3000/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Snacks",
          amountMinor: 500,
          category: "food",
          payerId: strangerId,
          splitType: "EQUAL",
          allocations: [{ userId: strangerId }],
        }),
      });

      const res = await createExpenseRoute(req, {
        params: Promise.resolve({ tripId }),
      });

      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.code, "FORBIDDEN_NOT_A_MEMBER");
    });
  });

  describe("GET /api/trips/[tripId]/expenses Route Handler", () => {
    it("returns 401 when request is unauthenticated", async () => {
      const req = new NextRequest(`http://localhost:3000/api/trips/${tripId}/expenses`);

      const res = await getTripExpensesRoute(req, {
        params: Promise.resolve({ tripId }),
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.match(json.error, /Authentication required/);
    });

    it("returns 200 and paginated expense feed", async () => {
      const token = signAuthToken({ userId: memberId, email: "member@trip.com" });
      const req = new NextRequest(`http://localhost:3000/api/trips/${tripId}/expenses?page=1&limit=10`, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      const res = await getTripExpensesRoute(req, {
        params: Promise.resolve({ tripId }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data.expenses));
      assert.ok(json.data.pagination);
    });
  });

  describe("GET /api/expenses/[expenseId] Route Handler", () => {
    it("returns 404 for non-existent expense ID", async () => {
      const nonExistentId = createTestId();
      const token = signAuthToken({ userId: ownerId });
      const req = new NextRequest(`http://localhost:3000/api/expenses/${nonExistentId}`, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      const res = await getExpenseDetailRoute(req, {
        params: Promise.resolve({ expenseId: nonExistentId }),
      });

      assert.strictEqual(res.status, 404);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, "Expense not found");
    });
  });

  describe("PATCH /api/expenses/[expenseId] Route Handler", () => {
    it("returns 401 when request is unauthenticated", async () => {
      const expenseId = createTestId();
      const req = new NextRequest(`http://localhost:3000/api/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify({ version: 1, title: "No Auth Edit" }),
      });

      const res = await editExpenseRoute(req, {
        params: Promise.resolve({ expenseId }),
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    it("returns 200 on valid edit and increments version", async () => {
      const created = await createExpenseTransactional({
        requestingUserId: ownerId,
        tripId,
        payerId: ownerId,
        title: "Initial Route Expense",
        amountMinor: 2000,
        category: "food",
        splitType: "EQUAL",
        allocations: [{ userId: ownerId }, { userId: memberId }],
      });

      const token = signAuthToken({ userId: ownerId });
      const req = new NextRequest(`http://localhost:3000/api/expenses/${created.expenseId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          title: "Edited Route Expense",
          amountMinor: 4000,
        }),
      });

      const res = await editExpenseRoute(req, {
        params: Promise.resolve({ expenseId: created.expenseId }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.title, "Edited Route Expense");
      assert.strictEqual(json.data.amountMinor, 4000);
      assert.strictEqual(json.data.version, 2);
    });

    it("returns 409 Conflict when editing with a stale version", async () => {
      const created = await createExpenseTransactional({
        requestingUserId: ownerId,
        tripId,
        payerId: ownerId,
        title: "Conflict Route Expense",
        amountMinor: 2000,
        category: "food",
        splitType: "EQUAL",
        allocations: [{ userId: ownerId }],
      });

      // Update once so version becomes 2
      const doc = testDb.expenses.get(created.expenseId);
      doc.version = 2;
      testDb.expenses.set(created.expenseId, doc);

      const token = signAuthToken({ userId: ownerId });
      const req = new NextRequest(`http://localhost:3000/api/expenses/${created.expenseId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1, // Stale version
          title: "Stale Edit Attempt",
        }),
      });

      const res = await editExpenseRoute(req, {
        params: Promise.resolve({ expenseId: created.expenseId }),
      });

      assert.strictEqual(res.status, 409);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.code, "VERSION_CONFLICT");
      assert.strictEqual(json.error, "Expense was updated by someone else. Please refresh and try again.");
    });
  });

  describe("POST /api/expenses/[expenseId]/void Route Handler", () => {
    it("returns 401 when request is unauthenticated", async () => {
      const expenseId = createTestId();
      const req = new NextRequest(`http://localhost:3000/api/expenses/${expenseId}/void`, {
        method: "POST",
        body: JSON.stringify({ version: 1, reason: "Duplicate" }),
      });

      const res = await voidExpenseRoute(req, {
        params: Promise.resolve({ expenseId }),
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    it("returns 200 on successful soft-void", async () => {
      const created = await createExpenseTransactional({
        requestingUserId: ownerId,
        tripId,
        payerId: ownerId,
        title: "To Be Voided",
        amountMinor: 1000,
        category: "food",
        splitType: "EQUAL",
        allocations: [{ userId: ownerId }],
      });

      const token = signAuthToken({ userId: ownerId });
      const req = new NextRequest(`http://localhost:3000/api/expenses/${created.expenseId}/void`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          reason: "Duplicate bill entered",
        }),
      });

      const res = await voidExpenseRoute(req, {
        params: Promise.resolve({ expenseId: created.expenseId }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.isVoid, true);
      assert.strictEqual(json.data.voidReason, "Duplicate bill entered");
      assert.strictEqual(json.data.version, 2);
    });

    it("returns 400 when attempting to void an already voided expense", async () => {
      const created = await createExpenseTransactional({
        requestingUserId: ownerId,
        tripId,
        payerId: ownerId,
        title: "Already Voided Expense",
        amountMinor: 1000,
        category: "food",
        splitType: "EQUAL",
        allocations: [{ userId: ownerId }],
      });

      // Mark as void
      const doc = testDb.expenses.get(created.expenseId);
      doc.isVoid = true;
      testDb.expenses.set(created.expenseId, doc);

      const token = signAuthToken({ userId: ownerId });
      const req = new NextRequest(`http://localhost:3000/api/expenses/${created.expenseId}/void`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          reason: "Voiding again",
        }),
      });

      const res = await voidExpenseRoute(req, {
        params: Promise.resolve({ expenseId: created.expenseId }),
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.code, "EXPENSE_ALREADY_VOIDED");
    });
  });
});
