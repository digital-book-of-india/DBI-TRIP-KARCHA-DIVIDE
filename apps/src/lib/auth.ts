import { headers } from "next/headers";
import { getAuthenticatedUser } from "./auth/authMiddleware";

export type AuthUser = {
  userId: string;
  email?: string;
  name?: string;
};

export { getAuthenticatedUser } from "./auth/authMiddleware";

export async function getAuthUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();
  return getAuthenticatedUser({ headers: requestHeaders });
}
