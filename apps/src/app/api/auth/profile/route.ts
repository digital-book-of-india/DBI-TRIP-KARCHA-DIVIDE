import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: Request) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { displayName, avatarUrl } = await req.json();
    if (!displayName && avatarUrl === undefined) {
      return NextResponse.json({ success: false, error: "At least one field to update is required" }, { status: 400 });
    }

    const res = await query(
      `UPDATE users
       SET display_name = COALESCE($1, display_name),
           avatar_url = COALESCE($2, avatar_url)
       WHERE id = $3
       RETURNING id, display_name, email, avatar_url`,
      [displayName || null, avatarUrl || null, auth.userId]
    );

    return NextResponse.json({ success: true, data: { user: res.rows[0] } });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to update profile" }, { status: 500 });
  }
}