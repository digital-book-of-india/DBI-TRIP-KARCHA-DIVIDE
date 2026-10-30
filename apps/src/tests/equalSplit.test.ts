import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateEqualSplit } from "../lib/splits/splitEngine";

describe("Equal Split Tests", () => {
  it("splits ₹100 equally between 2 participants", () => {
    const participants = ["user_1", "user_2"];
    const results = calculateEqualSplit(10000, participants);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].amountMinor, 5000);
    assert.strictEqual(results[1].amountMinor, 5000);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("splits ₹100 equally between 3 participants with deterministic remainder distribution", () => {
    // ₹100 = 10000 paise. 10000 / 3 = 3333 remainder 1.
    // User 1 gets 3334, User 2 gets 3333, User 3 gets 3333.
    const participants = ["user_1", "user_2", "user_3"];
    const results = calculateEqualSplit(10000, participants);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].userId, "user_1");
    assert.strictEqual(results[0].amountMinor, 3334);

    assert.strictEqual(results[1].userId, "user_2");
    assert.strictEqual(results[1].amountMinor, 3333);

    assert.strictEqual(results[2].userId, "user_3");
    assert.strictEqual(results[2].amountMinor, 3333);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("splits among many participants without losing a single paise", () => {
    // 7 participants dividing 10000 paise (1428 remainder 4)
    // First 4 get 1429, last 3 get 1428
    const participants = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];
    const results = calculateEqualSplit(10000, participants);

    assert.strictEqual(results.length, 7);
    assert.strictEqual(results[0].amountMinor, 1429);
    assert.strictEqual(results[1].amountMinor, 1429);
    assert.strictEqual(results[2].amountMinor, 1429);
    assert.strictEqual(results[3].amountMinor, 1429);
    assert.strictEqual(results[4].amountMinor, 1428);
    assert.strictEqual(results[5].amountMinor, 1428);
    assert.strictEqual(results[6].amountMinor, 1428);

    const sum = results.reduce((acc, curr) => acc + curr.amountMinor, 0);
    assert.strictEqual(sum, 10000);
  });

  it("handles one participant correctly", () => {
    const results = calculateEqualSplit(5432, ["sole_user"]);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].amountMinor, 5432);
    assert.strictEqual(results[0].userId, "sole_user");
  });

  it("rejects zero and negative amounts", () => {
    assert.throws(() => calculateEqualSplit(0, ["u1", "u2"]), /positive integer/);
    assert.throws(() => calculateEqualSplit(-1000, ["u1", "u2"]), /positive integer/);
    assert.throws(() => calculateEqualSplit(100.5, ["u1", "u2"]), /safe integer/);
  });

  it("rejects duplicate participant IDs", () => {
    assert.throws(
      () => calculateEqualSplit(10000, ["user_1", "user_2", "user_1"]),
      /Duplicate participant ID/
    );
  });

  it("rejects empty participant list", () => {
    assert.throws(() => calculateEqualSplit(10000, []), /At least one participant/);
  });
});
