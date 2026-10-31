/* eslint-disable @typescript-eslint/no-explicit-any */
export type ExpenseCategory = "stay" | "travel" | "food" | "tickets" | "shopping" | "other";

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export type TripRole = "ADMIN" | "MEMBER";

export type MembershipStatus = "JOINED" | "LEFT";

export type TripStatus = "ACTIVE" | "ARCHIVED" | "CLOSED";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "DISPUTED";

export type AuditAction = "CREATED" | "EDITED" | "VOIDED";

export interface UserDTO {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  accountStatus: string;
  createdAt: string;
}

export interface TripDTO {
  id: string;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  currency: string;
  createdBy: string;
  status: TripStatus;
  createdAt: string;
}

export interface TripMemberDTO {
  memberId: string;
  userId: string;
  displayName: string;
  email: string;
  role: TripRole;
  joinedAt: string;
}

export interface TripInviteDTO {
  id: string;
  tripId: string;
  inviteCodeHash: string;
  createdBy: string;
  expiresAt: string;
  maxUses: number;
  usesCount: number;
  status: string;
}

export interface ActivityEventDTO {
  id: string;
  tripId: string;
  actorUserId: string;
  eventType: string;
  entityId?: string;
  metadataJson?: Record<string, any>;
  createdAt: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
