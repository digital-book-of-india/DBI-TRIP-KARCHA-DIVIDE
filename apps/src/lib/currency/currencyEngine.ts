/**
 * Currency Engine
 *
 * Provides safe conversions between Rupees and Paise without floating-point arithmetic drift.
 * All internal financial amounts are represented in integer paise (minor units).
 */

/**
 * Converts a rupee amount (numeric or string) into integer paise.
 *
 * Rules:
 * - Rejects non-finite values (NaN, Infinity).
 * - Rejects negative values.
 * - Rejects values with more than two decimal places (no silent rounding).
 * - Uses string and integer parsing to prevent floating-point multiplication errors.
 * - Validates safe integer limits.
 */
export function rupeesToPaise(amount: number | string): number {
  if (amount === null || amount === undefined) {
    throw new TypeError("Monetary amount must be provided");
  }

  if (typeof amount !== "number" && typeof amount !== "string") {
    throw new TypeError("Monetary amount must be a number or a string");
  }

  let str: string;

  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || Number.isNaN(amount)) {
      throw new TypeError("Monetary amount must be a finite number");
    }

    if (amount < 0) {
      throw new RangeError("Monetary amount cannot be negative");
    }

    str = amount.toString();

    // Check for scientific notation (e.g. 1e20, 1e-7)
    if (str.toLowerCase().includes("e")) {
      throw new RangeError("Exponential notation is not supported for currency conversion");
    }
  } else {
    // String input processing
    str = amount.trim();

    // Remove optional currency symbols and prefixes
    if (str.startsWith("₹")) {
      str = str.slice(1).trim();
    } else if (str.toLowerCase().startsWith("rs.")) {
      str = str.slice(3).trim();
    } else if (str.toLowerCase().startsWith("rs")) {
      str = str.slice(2).trim();
    }

    if (str === "") {
      throw new Error("Monetary amount string cannot be empty");
    }

    if (str.startsWith("-")) {
      throw new RangeError("Monetary amount cannot be negative");
    }

    // Must match standard decimal format (e.g. "100", "100.5", "100.50")
    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new Error(`Invalid monetary amount format: "${amount}"`);
    }
  }

  const parts = str.split(".");

  if (parts.length > 2) {
    throw new Error(`Invalid monetary amount format: "${str}"`);
  }

  const wholeStr = parts[0];
  const fracStr = parts[1] ?? "";

  // Reject more than two decimal places instead of silently rounding
  if (fracStr.length > 2) {
    throw new RangeError(
      `Monetary amounts cannot have more than two decimal places. Received "${str}" with ${fracStr.length} decimal places.`
    );
  }

  // Pad fraction to 2 decimal digits: "5" -> "50", "" -> "00", "99" -> "99"
  const paddedFrac = fracStr.padEnd(2, "0");

  // Remove leading zeros for whole part unless whole part is just "0"
  const cleanWhole = wholeStr.replace(/^0+(?=\d)/, "");

  const paiseStr = cleanWhole + paddedFrac;
  const paise = Number(paiseStr);

  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Calculated paise value (${paiseStr}) exceeds JavaScript safe integer limits`);
  }

  return paise;
}

/**
 * Converts integer paise into a standard decimal rupees string for display (e.g. 10050 -> "100.50").
 */
export function paiseToRupees(paise: number): string {
  if (typeof paise !== "number" || !Number.isFinite(paise) || Number.isNaN(paise)) {
    throw new TypeError("Paise must be a finite number");
  }

  if (!Number.isSafeInteger(paise)) {
    throw new RangeError("Paise must be a safe integer");
  }

  if (paise < 0) {
    throw new RangeError("Paise cannot be negative");
  }

  const whole = Math.floor(paise / 100);
  const frac = paise % 100;

  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * Formats integer paise into a formatted rupees string with currency symbol (e.g. 10050 -> "₹100.50").
 */
export function formatRupees(paise: number, options: { includeSymbol?: boolean } = { includeSymbol: true }): string {
  const formatted = paiseToRupees(paise);
  return options.includeSymbol ? `₹${formatted}` : formatted;
}

/**
 * Checks whether the given value is a safe, non-negative integer paise.
 */
export function isValidPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates that the given value is a positive safe integer paise (strictly > 0).
 */
export function isPositivePaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// Aliases for convenience
export const toPaise = rupeesToPaise;
export const fromPaise = paiseToRupees;
