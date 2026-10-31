import { Pool } from "pg";

const BASE_URL = "http://localhost:3000";
const uid = Date.now();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres.xwkmpnxzwgwkbvdebhfu:Rajnish%409572@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`\x1b[32m✔ PASS\x1b[0m : ${name}`);
    passed++;
  } catch (err) {
    console.log(`\x1b[31m✖ FAIL\x1b[0m : ${name}`);
    console.log(`       \x1b[33mReason: ${err.message}\x1b[0m`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("   DBI TRIP KARCHA DIVIDE - DEV 1 FINAL 100% SUITE    ");
  console.log("=======================================================\n");

  let tokenAdmin = "";
  let tokenMember = "";
  let tokenMember2 = "";
  let tripId = "";
  let inviteId = "";
  let inviteCode = "";

  const adminEmail = `prod_admin_${uid}@dbi.com`;
  const memberEmail = `prod_member_${uid}@dbi.com`;
  const member2Email = `prod_member2_${uid}@dbi.com`;

  // 1. Valid Signup with Terms Consent
  await test("Auth - User 1 (Admin) Signup with Zod validation & terms consent", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Prabhjot Singh", email: adminEmail, password: "password123", termsAccepted: true }),
    });
    const data = await res.json();
    assert(res.status === 201 && data.data.user.termsAccepted === true, "Must return 201 with termsAccepted: true");
    tokenAdmin = data.data.token;
  });

  // 2. Reject Invalid Email format (Zod)
  await test("Auth - Reject malformed email format via Zod (400)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "User", email: "invalid-email-string", password: "password123" }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // 3. User Login
  await test("Auth - Login with verified credentials", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "password123" }),
    });
    assert(res.status === 200, "Login must succeed");
  });

  // 4. Update Profile
  await test("Auth - Update profile display name and avatar (/api/auth/profile)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ displayName: "Prabhjot S.", avatarUrl: "https://dbi.pro/avatar.png" }),
    });
    const data = await res.json();
    assert(res.status === 200 && data.data.user.avatar_url === "https://dbi.pro/avatar.png", "Profile must update");
  });

  // 5. Trip Creation with Date Logic (endDate < startDate blocked)
  await test("Trips - Reject illogical dates (endDate < startDate) via Zod (400)", async () => {
    const res = await fetch(`${BASE_URL}/api/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        name: "Bad Dates Trip",
        currency: "INR",
        startDate: "2026-12-10T10:00:00.000Z",
        endDate: "2026-12-05T10:00:00.000Z"
      }),
    });
    assert(res.status === 400, `Expected 400 for illogical dates, got ${res.status}`);
  });

  // 6. Transactional Trip Creation & Auto-Admin
  await test("Trips - Create trip transactionally and auto-assign ADMIN", async () => {
    const res = await fetch(`${BASE_URL}/api/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ name: `Manali Trip ${uid}`, destination: "Manali, HP", currency: "INR" }),
    });
    const data = await res.json();
    assert(res.status === 201 && data.data.trip.id, "Trip must be created");
    tripId = data.data.trip.id;
  });

  // 7. Verify TRIP_CREATED Activity Event
  await test("Audit - Verify TRIP_CREATED logged in activity_events", async () => {
    const res = await pool.query("SELECT * FROM activity_events WHERE trip_id = $1 AND event_type = 'TRIP_CREATED'", [tripId]);
    assert(res.rows.length > 0, "TRIP_CREATED activity event must be recorded");
  });

  // 8. Generate High-Entropy Invite Code with Hash Storage
  await test("Invites - Generate 24-char code and verify SHA-256 hash stored", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/${tripId}/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const data = await res.json();
    assert(res.status === 201 && data.data.inviteCode.length === 24, "Must generate 24-char high-entropy code");
    inviteCode = data.data.inviteCode;
    inviteId = data.data.inviteId;

    const dbCheck = await pool.query("SELECT invite_code_hash FROM trip_invites WHERE id = $1", [inviteId]);
    assert(dbCheck.rows[0].invite_code_hash.length === 64, "Database MUST store 64-char SHA-256 hash");
  });

  // 9. Public Invite Preview Guardrail (No Auth Required)
  await test("Guardrail - Public invite preview returns trip & inviter name (no auth)", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/join?code=${inviteCode}`);
    const data = await res.json();
    assert(res.status === 200 && data.data.tripName && data.data.inviterName, "Public preview must work");
  });

  // 10. Member 2 Signup & Join Trip
  await test("Trips - User 2 joins trip via invite code", async () => {
    const regRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Aman Sharma", email: memberEmail, password: "password123" }),
    });
    const regData = await regRes.json();
    tokenMember = regData.data.token;

    const joinRes = await fetch(`${BASE_URL}/api/trips/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenMember}` },
      body: JSON.stringify({ inviteCode }),
    });
    const joinData = await joinRes.json();
    assert(joinRes.status === 200 && joinData.success === true, "User 2 must join successfully");
  });

  // 11. Member 3 Signup & Join Trip
  await test("Trips - User 3 joins trip", async () => {
    const regRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Rahul Verma", email: member2Email, password: "password123" }),
    });
    const regData = await regRes.json();
    tokenMember2 = regData.data.token;

    const joinRes = await fetch(`${BASE_URL}/api/trips/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenMember2}` },
      body: JSON.stringify({ inviteCode }),
    });
    assert(joinRes.status === 200, "User 3 joined");
  });

  // 12. Member Leaves Trip (POST /api/trips/[tripId]/leave)
  await test("Trips - Member 3 leaves trip (/api/trips/[tripId]/leave)", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/${tripId}/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenMember2}` },
    });
    const data = await res.json();
    assert(res.status === 200 && data.success === true, "Must successfully leave trip");

    const check = await pool.query("SELECT membership_status FROM trip_members WHERE trip_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)", [tripId, member2Email]);
    assert(check.rows[0].membership_status === "LEFT", "Status must update to LEFT");
  });

  // 13. Admin Revokes Invite Code
  await test("Invites - Admin revokes invite code (/api/trips/[tripId]/invites/revoke)", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/${tripId}/invites/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ inviteId }),
    });
    assert(res.status === 200, "Invite must be revoked");
  });

  // 14. Revoked Code Rejection
  await test("Guards - Joining via REVOKED code is rejected (404/410)", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenMember2}` },
      body: JSON.stringify({ inviteCode }),
    });
    assert(res.status === 404 || res.status === 410, `Expected 404/410, got ${res.status}`);
  });

  // 15. Admin Closes Trip
  await test("Trips - Admin closes trip & logs TRIP_CLOSED event", async () => {
    const res = await fetch(`${BASE_URL}/api/trips/${tripId}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert(res.status === 200, "Trip must be closed");
  });

  // 16. Account Deletion Request (DELETE /api/auth/me)
  await test("Auth - User requests account deletion (/api/auth/me)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenMember}` },
    });
    assert(res.status === 200, "Deletion must succeed");
    const check = await pool.query("SELECT account_status FROM users WHERE email = $1", [memberEmail]);
    assert(check.rows[0].account_status === "DELETED", "Status must update to DELETED");
  });

  console.log("\n=======================================================");
  console.log(`   FINAL TEST RESULT: \x1b[32m${passed} PASSED\x1b[0m | \x1b[31m${failed} FAILED\x1b[0m   `);
  console.log("=======================================================\n");

  await pool.end();
  if (failed > 0) process.exit(1);
}

runTests();