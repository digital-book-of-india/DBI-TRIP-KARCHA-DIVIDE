import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rupeesToPaise,
  paiseToRupees,
  formatRupees,
  isValidPaise,
  isPositivePaise,
} from "../lib/currency/currencyEngine";

describe("Currency Engine Tests", () => {
  describe("Rupees to Paise Conversion", () => {
    it("converts ₹100 to 10000 paise (number and string formats)", () => {
      assert.strictEqual(rupeesToPaise(100), 10000);
      assert.strictEqual(rupeesToPaise("100"), 10000);
      assert.strictEqual(rupeesToPaise("₹100"), 10000);
      assert.strictEqual(rupeesToPaise("₹ 100"), 10000);
      assert.strictEqual(rupeesToPaise("Rs. 100"), 10000);
    });

    it("converts ₹100.50 to 10050 paise", () => {
      assert.strictEqual(rupeesToPaise(100.5), 10050);
      assert.strictEqual(rupeesToPaise("100.5"), 10050);
      assert.strictEqual(rupeesToPaise("100.50"), 10050);
      assert.strictEqual(rupeesToPaise("₹100.50"), 10050);
    });

    it("converts ₹1.99 to 199 paise", () => {
      assert.strictEqual(rupeesToPaise(1.99), 199);
      assert.strictEqual(rupeesToPaise("1.99"), 199);
      assert.strictEqual(rupeesToPaise("₹1.99"), 199);
    });

    it("converts ₹0 to 0 paise", () => {
      assert.strictEqual(rupeesToPaise(0), 0);
      assert.strictEqual(rupeesToPaise("0"), 0);
      assert.strictEqual(rupeesToPaise("0.00"), 0);
      assert.strictEqual(rupeesToPaise("₹0"), 0);
    });

    it("rejects amounts with more than two decimal places", () => {
      assert.throws(() => rupeesToPaise(100.555), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("100.555"), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("1.999"), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("0.001"), {
        name: "RangeError",
      });
    });

    it("rejects negative amounts", () => {
      assert.throws(() => rupeesToPaise(-100), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise(-0.01), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("-100"), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("-₹100"), {
        name: "RangeError",
      });
    });

    it("rejects invalid strings", () => {
      assert.throws(() => rupeesToPaise("abc"), /Invalid monetary amount/);
      assert.throws(() => rupeesToPaise(""), /empty/);
      assert.throws(() => rupeesToPaise("   "), /empty/);
      assert.throws(() => rupeesToPaise("10.2.3"), /Invalid monetary amount/);
      assert.throws(() => rupeesToPaise("$50"), /Invalid monetary amount/);
      assert.throws(() => rupeesToPaise(NaN), { name: "TypeError" });
      assert.throws(() => rupeesToPaise(Infinity), { name: "TypeError" });
      assert.throws(() => rupeesToPaise(-Infinity), { name: "TypeError" });
    });

    it("rejects unsafe integers and out-of-range values", () => {
      assert.throws(() => rupeesToPaise(Number.MAX_SAFE_INTEGER), {
        name: "RangeError",
      });
      assert.throws(() => rupeesToPaise("9999999999999999999999"), {
        name: "RangeError",
      });
    });
  });

  describe("Paise to Rupees Conversion & Formatting", () => {
    it("converts integer paise into rupees string for display", () => {
      assert.strictEqual(paiseToRupees(10000), "100.00");
      assert.strictEqual(paiseToRupees(10050), "100.50");
      assert.strictEqual(paiseToRupees(199), "1.99");
      assert.strictEqual(paiseToRupees(0), "0.00");
      assert.strictEqual(paiseToRupees(5), "0.05");
    });

    it("formats rupees with currency symbol", () => {
      assert.strictEqual(formatRupees(10050), "₹100.50");
      assert.strictEqual(formatRupees(10000, { includeSymbol: false }), "100.00");
    });

    it("rejects invalid and negative paise in display conversion", () => {
      assert.throws(() => paiseToRupees(-1), { name: "RangeError" });
      assert.throws(() => paiseToRupees(1.5), { name: "RangeError" });
      assert.throws(() => paiseToRupees(NaN), { name: "TypeError" });
      assert.throws(() => paiseToRupees(Number.MAX_SAFE_INTEGER + 1), { name: "RangeError" });
    });
  });

  describe("Paise Type Guard Validators", () => {
    it("validates safe non-negative paise with isValidPaise", () => {
      assert.strictEqual(isValidPaise(0), true);
      assert.strictEqual(isValidPaise(100), true);
      assert.strictEqual(isValidPaise(-1), false);
      assert.strictEqual(isValidPaise(1.5), false);
      assert.strictEqual(isValidPaise("100"), false);
    });

    it("validates strictly positive paise with isPositivePaise", () => {
      assert.strictEqual(isPositivePaise(1), true);
      assert.strictEqual(isPositivePaise(0), false);
      assert.strictEqual(isPositivePaise(-100), false);
    });
  });
});
