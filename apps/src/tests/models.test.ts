import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

describe("Database Models Invariants Tests (Prisma Schema Verification)", () => {
  const models = Prisma.dmmf.datamodel.models;
  const getModel = (name: string) => models.find((m) => m.name === name);

  describe("Expense Model Schema Invariants", () => {
    const expenseModel = getModel("Expense");

    it("verifies Expense model exists in Prisma schema", () => {
      assert.ok(expenseModel, "Expense model must be defined in Prisma schema");
    });

    it("verifies Expense model fields and integer paise storage", () => {
      assert.ok(expenseModel);
      const fields = new Map(expenseModel.fields.map((f) => [f.name, f]));

      // amountMinor must be Int (integer paise storage)
      const amountMinor = fields.get("amountMinor");
      assert.ok(amountMinor);
      assert.strictEqual(amountMinor.type, "Int");
      assert.strictEqual(amountMinor.isRequired, true);

      // version must default to 1
      const version = fields.get("version");
      assert.ok(version);
      assert.strictEqual(version.type, "Int");
      assert.strictEqual(version.default, 1);

      // isVoid must default to false
      const isVoid = fields.get("isVoid");
      assert.ok(isVoid);
      assert.strictEqual(isVoid.type, "Boolean");
      assert.strictEqual(isVoid.default, false);

      // splitType must be SplitType enum
      const splitType = fields.get("splitType");
      assert.ok(splitType);
      assert.strictEqual(splitType.type, "SplitType");

      // Relations
      assert.ok(fields.has("trip"));
      assert.ok(fields.has("payer"));
      assert.ok(fields.has("allocations"));
      assert.ok(fields.has("auditLogs"));
    });
  });

  describe("ExpenseAllocation Model Schema Invariants", () => {
    const allocModel = getModel("ExpenseAllocation");

    it("verifies ExpenseAllocation model exists in Prisma schema", () => {
      assert.ok(allocModel, "ExpenseAllocation model must be defined");
    });

    it("verifies ExpenseAllocation fields and unique constraint", () => {
      assert.ok(allocModel);
      const fields = new Map(allocModel.fields.map((f) => [f.name, f]));

      const amountMinor = fields.get("amountMinor");
      assert.ok(amountMinor);
      assert.strictEqual(amountMinor.type, "Int");
      assert.strictEqual(amountMinor.isRequired, true);

      // Unique constraint on (expenseId, userId) to prevent duplicates
      const uniqueIndex = allocModel.uniqueFields.some(
        (fields) => fields.includes("expenseId") && fields.includes("userId")
      );
      assert.ok(uniqueIndex, "ExpenseAllocation must enforce unique constraint on (expenseId, userId)");
    });
  });

  describe("ExpenseAuditLog Model Schema Invariants", () => {
    const auditModel = getModel("ExpenseAuditLog");

    it("verifies ExpenseAuditLog model exists in Prisma schema", () => {
      assert.ok(auditModel, "ExpenseAuditLog model must be defined");
    });

    it("verifies ExpenseAuditLog fields and json snapshot storage", () => {
      assert.ok(auditModel);
      const fields = new Map(auditModel.fields.map((f) => [f.name, f]));

      const action = fields.get("action");
      assert.ok(action);
      assert.strictEqual(action.type, "AuditAction");

      const previousSnapshot = fields.get("previousSnapshot");
      assert.ok(previousSnapshot);
      assert.strictEqual(previousSnapshot.type, "Json");

      const newSnapshot = fields.get("newSnapshot");
      assert.ok(newSnapshot);
      assert.strictEqual(newSnapshot.type, "Json");

      const timestamp = fields.get("timestamp");
      assert.ok(timestamp);
      assert.strictEqual(timestamp.type, "DateTime");
    });
  });

  describe("TripMember Model Schema Invariants", () => {
    const memberModel = getModel("TripMember");

    it("verifies TripMember unique constraint on (tripId, userId)", () => {
      assert.ok(memberModel);
      const unique = memberModel.uniqueFields.some(
        (fields) => fields.includes("tripId") && fields.includes("userId")
      );
      assert.ok(unique, "TripMember must enforce unique constraint on (tripId, userId)");
    });
  });
});
