export type ExpenseCategory = "stay" | "travel" | "food" | "tickets" | "shopping" | "other";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "DISPUTED";

export type TripRole = "ADMIN" | "MEMBER";

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE";

export type AuditAction = "CREATED" | "EDITED" | "VOIDED";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
