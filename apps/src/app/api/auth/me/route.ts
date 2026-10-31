import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await query(
    "SELECT id, display_name, email, avatar_url, account_status, terms_accepted, created_at FROM users WHERE id = $1",
    [auth.userId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: { user: result.rows[0] } });
}

// PDF Requirement: Account deletion request (soft delete)
export async function DELETE() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  await query("UPDATE users SET account_status = 'DELETED' WHERE id = $1", [auth.userId]);
  return NextResponse.json({ success: true, message: "Account deletion request processed successfully" });
}