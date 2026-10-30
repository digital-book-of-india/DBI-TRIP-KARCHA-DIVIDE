import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePercentageSplit } from "../lib/splits/splitEngine";

describe("Percentage Split Tests", () => {
  it("splits 50/50 on ₹100", () => {
    const allocations = [
      { userId: "u1", percentage: 50 },
      { userId: "u2", percentage: 50 },
    ];
    const results = calculatePercentageSplit(10000, allocations);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].amountMinor, 5000);
    assert.strictEqual(results[1].amountMinor, 5000);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("splits 33.33 / 33.33 / 33.34 on ₹100 (10000 paise)", () => {
    const allocations = [
      { userId: "u1", percentage: 33.33 },
      { userId: "u2", percentage: 33.33 },
      { userId: "u3", percentage: 33.34 },
    ];
    const results = calculatePercentageSplit(10000, allocations);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].amountMinor, 3333);
    assert.strictEqual(results[1].amountMinor, 3333);
    assert.strictEqual(results[2].amountMinor, 3334);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("distributes fractional paise remainders deterministically without losing money", () => {
    // 33.33, 33.33, 33.34 on 1000 paise (₹10)
    // raw shares: 333.3, 333.3, 333.4
    // base shares: 333, 333, 333 = 999. Remainder = 1 paise.
    // u3 has fraction 0.4 > 0.3, so u3 gets the remainder paise.
    const allocations = [
      { userId: "u1", percentage: 33.33 },
      { userId: "u2", percentage: 33.33 },
      { userId: "u3", percentage: 33.34 },
    ];
    const results = calculatePercentageSplit(1000, allocations);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].amountMinor, 333);
    assert.strictEqual(results[1].amountMinor, 333);
    assert.strictEqual(results[2].amountMinor, 334);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 1000);
  });

  it("rejects percentage total mismatch", () => {
    // Under 100%
    const under = [
      { userId: "u1", percentage: 40 },
      { userId: "u2", percentage: 50 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, under), /Percentage allocations must sum to exactly 100%/);

    // Over 100%
    const over = [
      { userId: "u1", percentage: 60 },
      { userId: "u2", percentage: 50 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, over), /Percentage allocations must sum to exactly 100%/);
  });

  it("rejects negative percentages", () => {
    const allocations = [
      { userId: "u1", percentage: 50 },
      { userId: "u2", percentage: -10 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, allocations), /cannot be negative/);
  });

  it("rejects invalid percentage values", () => {
    const nanAlloc = [
      { userId: "u1", percentage: NaN },
      { userId: "u2", percentage: 100 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, nanAlloc), /must be a valid finite number/);

    const exceedAlloc = [
      { userId: "u1", percentage: 105 },
      { userId: "u2", percentage: 0 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, exceedAlloc), /cannot exceed 100%/);
  });

  it("rejects duplicate participants in percentage split", () => {
    const duplicate = [
      { userId: "u1", percentage: 50 },
      { userId: "u1", percentage: 50 },
    ];
    assert.throws(() => calculatePercentageSplit(10000, duplicate), /Duplicate participant ID/);
  });
});
