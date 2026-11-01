import { NextResponse } from "next/server";

/**
 * Error with an HTTP status code attached, for service-layer code
 * (ledger/settlement/notification/report services) to throw instead of the
 * previous `const error: any = new Error(...); error.status = x; throw error;`
 * pattern, which required `no-explicit-any` everywhere it appeared.
 */
export class HttpError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Shared error-response helper for routes/services that throw plain
 * `Error` objects carrying an optional `.status` (as the ledger/settlement/
 * notification/report services do), replacing the repeated
 * `catch (err: any) { const status = err.status || 500; ... }` pattern.
 */
export function errorResponse(err: unknown, fallbackMessage: string): NextResponse {
  const status = hasStatus(err) ? err.status : 500;
  const message = err instanceof Error ? err.message : fallbackMessage;
  return NextResponse.json({ success: false, error: message || fallbackMessage }, { status: status || 500 });
}

function hasStatus(err: unknown): err is { status: number } {
  return typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number";
}
