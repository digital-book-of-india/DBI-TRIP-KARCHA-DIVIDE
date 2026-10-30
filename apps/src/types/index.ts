export type ExpenseCategory = "stay" | "travel" | "food" | "tickets" | "shopping" | "other";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "DISPUTED";

export type TripRole = "ADMIN" | "MEMBER";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
