import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { SignupSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "local";
    const { allowed } = checkRateLimit(`signup_${ip}`, 10, 60000);
    if (!allowed) {
      return NextResponse.json({ success: false, error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { displayName, email, password, termsAccepted } = parsed.data;

    const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ success: false, error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      "INSERT INTO users (display_name, email, password_hash, terms_accepted) VALUES ($1, $2, $3, $4) RETURNING id, display_name, email, terms_accepted",
      [displayName.trim(), email, passwordHash, termsAccepted]
    );

    const user = result.rows[0];
    const token = signToken({ userId: user.id, email: user.email });

    return NextResponse.json(
      {
        success: true,
        data: {
          token,
          user: { id: user.id, displayName: user.display_name, email: user.email, termsAccepted: user.terms_accepted },
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}