import { query } from "../db";
import { AuthUser } from "../auth";

export interface AdminUser {
  userId: string;
  email?: string;
  displayName: string;
}

/**
 * Returns the admin's profile if `authUser` is an active platform admin,
 * otherwise null. Platform admin is a DB flag (`users.is_platform_admin`),
 * independent from any trip-level ADMIN role.
 */
export async function requireAdmin(authUser: AuthUser | null): Promise<AdminUser | null> {
  if (!authUser) return null;

  const result = await query(
    "SELECT id, email, display_name FROM users WHERE id = $1 AND account_status = 'ACTIVE' AND is_platform_admin = true",
    [authUser.userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return { userId: row.id, email: row.email, displayName: row.display_name };
}

/**
 * Promotes a user to platform admin if their email is listed in the
 * PLATFORM_ADMIN_EMAILS environment variable (comma-separated). Called after
 * signup/login so an operator can bootstrap admin access purely via
 * configuration, without a manual DB write or a privileged open endpoint.
 */
export async function syncPlatformAdminStatus(userId: string, email: string): Promise<void> {
  const list = (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (list.length === 0) return;
  if (!list.includes(email.toLowerCase())) return;

  await query("UPDATE users SET is_platform_admin = true WHERE id = $1 AND is_platform_admin = false", [userId]);
}
