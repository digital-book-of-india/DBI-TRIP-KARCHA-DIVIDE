import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateExpenseStructure,
  validateExpenseIntegrity,
  assertExpenseIntegrity,
  ExpenseValidationError,
  ExpenseValidationInput,
} from "../lib/validation/expenseValidation";

describe("Expense Integrity Validation Tests", () => {
  const tripId = "trip_123";
  const validPayer = "user_payer";
  const member1 = "user_1";
  const member2 = "user_2";
  const nonMember = "user_stranger";

  const defaultMembers = new Set([validPayer, member1, member2]);

  it("passes validation for a fully valid expense", async () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "EQUAL",
      allocations: [
        { userId: member1, amountMinor: 5000 },
        { userId: member2, amountMinor: 5000 },
      ],
    };

    const result = await validateExpenseIntegrity(input, {
      tripMemberUserIds: defaultMembers,
    });

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.errors.length, 0);

    // assertExpenseIntegrity should not throw
    await assert.doesNotReject(() =>
      assertExpenseIntegrity(input, { tripMemberUserIds: defaultMembers })
    );
  });

  it("detects non-member payer with structured error", async () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: nonMember, // Not in defaultMembers
      amountMinor: 10000,
      splitType: "EQUAL",
      allocations: [
        { userId: member1, amountMinor: 5000 },
        { userId: member2, amountMinor: 5000 },
      ],
    };

    const result = await validateExpenseIntegrity(input, {
      tripMemberUserIds: defaultMembers,
    });

    assert.strictEqual(result.isValid, false);
    const payerError = result.errors.find(
      (e) => e.field === "payerId" && e.code === "NOT_A_TRIP_MEMBER"
    );
    assert.ok(payerError, "Expected NOT_A_TRIP_MEMBER error for payer");
    assert.match(payerError.message, /not an active member/);
  });

  it("detects non-member allocation participant with structured error", async () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "EQUAL",
      allocations: [
        { userId: member1, amountMinor: 5000 },
        { userId: nonMember, amountMinor: 5000 }, // Non-member
      ],
    };

    const result = await validateExpenseIntegrity(input, {
      tripMemberUserIds: defaultMembers,
    });

    assert.strictEqual(result.isValid, false);
    const participantError = result.errors.find(
      (e) => e.field === "allocations[1].userId" && e.code === "NOT_A_TRIP_MEMBER"
    );
    assert.ok(participantError, "Expected NOT_A_TRIP_MEMBER error for participant");
    assert.match(participantError.message, /not an active member/);
  });

  it("detects allocation sum mismatch with structured error", () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "EXACT",
      allocations: [
        { userId: member1, amountMinor: 4000 },
        { userId: member2, amountMinor: 5000 }, // Sum is 9000, expected 10000
      ],
    };

    const result = validateExpenseStructure(input);
    assert.strictEqual(result.isValid, false);

    const sumError = result.errors.find(
      (e) => e.field === "allocations" && e.code === "ALLOCATION_SUM_MISMATCH"
    );
    assert.ok(sumError, "Expected ALLOCATION_SUM_MISMATCH error");
    assert.match(sumError.message, /Sum of allocation amounts \(9000 paise\) does not match/);
  });

  it("detects invalid split type with structured error", () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "ARBITRARY_TYPE", // Invalid split type
      allocations: [
        { userId: member1, amountMinor: 5000 },
        { userId: member2, amountMinor: 5000 },
      ],
    };

    const result = validateExpenseStructure(input);
    assert.strictEqual(result.isValid, false);

    const splitTypeError = result.errors.find(
      (e) => e.field === "splitType" && e.code === "INVALID_SPLIT_TYPE"
    );
    assert.ok(splitTypeError, "Expected INVALID_SPLIT_TYPE error");
    assert.match(splitTypeError.message, /splitType must be one of/);
  });

  it("detects duplicate participant IDs with structured error", () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "EQUAL",
      allocations: [
        { userId: member1, amountMinor: 5000 },
        { userId: member1, amountMinor: 5000 }, // Duplicate member1
      ],
    };

    const result = validateExpenseStructure(input);
    assert.strictEqual(result.isValid, false);

    const dupError = result.errors.find((e) => e.code === "DUPLICATE_PARTICIPANT");
    assert.ok(dupError, "Expected DUPLICATE_PARTICIPANT error");
  });

  it("detects non-positive and unsafe amountMinor", () => {
    const inputZero: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 0,
      splitType: "EQUAL",
      allocations: [{ userId: member1, amountMinor: 0 }],
    };
    const resZero = validateExpenseStructure(inputZero);
    assert.strictEqual(resZero.isValid, false);
    assert.ok(resZero.errors.some((e) => e.code === "INVALID_AMOUNT"));

    const inputFloat: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 100.5,
      splitType: "EQUAL",
      allocations: [{ userId: member1, amountMinor: 100.5 }],
    };
    const resFloat = validateExpenseStructure(inputFloat);
    assert.strictEqual(resFloat.isValid, false);
    assert.ok(resFloat.errors.some((e) => e.code === "INVALID_AMOUNT"));
  });

  it("detects negative allocation amounts", () => {
    const input: ExpenseValidationInput = {
      tripId,
      payerId: validPayer,
      amountMinor: 10000,
      splitType: "EXACT",
      allocations: [
        { userId: member1, amountMinor: 12000 },
        { userId: member2, amountMinor: -2000 },
      ],
    };

    const result = validateExpenseStructure(input);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.code === "INVALID_ALLOCATION_AMOUNT"));
  });

  it("assertExpenseIntegrity throws typed ExpenseValidationError on failures", async () => {
    const invalidInput: ExpenseValidationInput = {
      tripId,
      payerId: nonMember,
      amountMinor: -500,
      splitType: "INVALID",
      allocations: [],
    };

    await assert.rejects(
      () => assertExpenseIntegrity(invalidInput, { tripMemberUserIds: defaultMembers }),
      (err: unknown) => {
        assert.ok(err instanceof ExpenseValidationError);
        assert.ok(err.errors.length > 0);
        return true;
      }
    );
  });
});
