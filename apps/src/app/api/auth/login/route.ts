import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, error: "Authentication is managed by the main application" },
    { status: 410 }
  );
}
