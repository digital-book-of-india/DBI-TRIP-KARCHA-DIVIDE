import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateExactSplit } from "../lib/splits/splitEngine";

describe("Exact Split Tests", () => {
  it("accepts correct exact total allocation", () => {
    const allocations = [
      { userId: "u1", amountMinor: 4000 },
      { userId: "u2", amountMinor: 3500 },
      { userId: "u3", amountMinor: 2500 },
    ];
    const results = calculateExactSplit(10000, allocations);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].amountMinor, 4000);
    assert.strictEqual(results[1].amountMinor, 3500);
    assert.strictEqual(results[2].amountMinor, 2500);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("rejects total mismatch when exact shares sum is less or greater than amountMinor", () => {
    // Sum is 9000 vs 10000
    const under = [
      { userId: "u1", amountMinor: 4000 },
      { userId: "u2", amountMinor: 5000 },
    ];
    assert.throws(() => calculateExactSplit(10000, under), /does not match expense amount/);

    // Sum is 11000 vs 10000
    const over = [
      { userId: "u1", amountMinor: 6000 },
      { userId: "u2", amountMinor: 5000 },
    ];
    assert.throws(() => calculateExactSplit(10000, over), /does not match expense amount/);
  });

  it("rejects negative allocations", () => {
    const allocations = [
      { userId: "u1", amountMinor: 12000 },
      { userId: "u2", amountMinor: -2000 },
    ];
    assert.throws(() => calculateExactSplit(10000, allocations), /cannot be negative/);
  });

  it("allows zero allocation for a participant (e.g. non-contributing member)", () => {
    const allocations = [
      { userId: "u1", amountMinor: 10000 },
      { userId: "u2", amountMinor: 0 },
    ];
    const results = calculateExactSplit(10000, allocations);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].amountMinor, 10000);
    assert.strictEqual(results[1].amountMinor, 0);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("rejects duplicate participants in exact split", () => {
    const allocations = [
      { userId: "u1", amountMinor: 5000 },
      { userId: "u1", amountMinor: 5000 },
    ];
    assert.throws(() => calculateExactSplit(10000, allocations), /Duplicate participant ID/);
  });

  it("rejects non-integer allocation amounts", () => {
    const allocations = [
      { userId: "u1", amountMinor: 5000.5 },
      { userId: "u2", amountMinor: 4999.5 },
    ];
    assert.throws(() => calculateExactSplit(10000, allocations), /safe integer/);
  });
});
