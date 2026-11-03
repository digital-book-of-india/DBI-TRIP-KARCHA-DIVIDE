import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "../lib/auth/authMiddleware";
import { getJwtSecret } from "../lib/jwtSecret";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { signMainAppAccessToken } from "./testAuth";
import { GET as getTripExpensesRoute } from "../app/api/trips/[tripId]/expenses/route";
import { POST as loginRoute } from "../app/api/auth/login/route";
import { POST as signupRoute } from "../app/api/auth/signup/route";

const mainAppUserId = "507f1f77bcf86cd799439011";

function createToken(
  claims: Record<string, unknown>,
  secret = getJwtSecret()
): string {
  return jwt.sign(claims, secret, { algorithm: "HS256" });
}

function expenseFeedRequest(token?: string) {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  return new NextRequest("http://localhost:3000/api/trips/trip-id/expenses", { headers });
}

describe("Main application access token authentication", () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  it("accepts a valid HS256 access token and extracts its subject", async () => {
    const token = createToken({
      sub: mainAppUserId,
      role: "USER",
      typ: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const user = await getAuthenticatedUser(expenseFeedRequest(token));

    assert.equal(user?.userId, mainAppUserId);
    assert.equal(testDb.mainAppIdentities.get(mainAppUserId)?.userId, mainAppUserId);
    assert.equal(testDb.users.has(mainAppUserId), true);
  });

  it("resolves an explicitly linked legacy profile without changing its ID", async () => {
    const legacyUserId = createTestId();
    testDb.addUser({ id: legacyUserId, name: "Legacy User", email: "legacy@example.test" });
    testDb.mainAppIdentities.set(mainAppUserId, {
      subject: mainAppUserId,
      userId: legacyUserId,
    });
    const token = createToken({
      sub: mainAppUserId,
      role: "USER",
      typ: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const user = await getAuthenticatedUser(expenseFeedRequest(token));

    assert.equal(user?.userId, legacyUserId);
    assert.equal(testDb.users.has(legacyUserId), true);
    assert.equal(testDb.users.has(mainAppUserId), false);
  });

  it("rejects a missing token", async () => {
    assert.equal(await getAuthenticatedUser(expenseFeedRequest()), null);
  });

  it("rejects malformed, expired, refresh, and incorrectly signed tokens with HTTP 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rejectedTokens = [
      "not-a-jwt",
      createToken({ sub: mainAppUserId, role: "USER", typ: "access" }),
      createToken({ role: "USER", typ: "access", exp: now + 60 }),
      createToken({ sub: mainAppUserId, role: "USER", typ: "access", exp: now - 1 }),
      createToken({ sub: mainAppUserId, role: "USER", typ: "refresh", exp: now + 60 }),
      createToken({ sub: mainAppUserId, role: "USER", typ: "access", exp: now + 60 }, "wrong-test-secret"),
      jwt.sign(
        { sub: mainAppUserId, role: "USER", typ: "access", exp: now + 60 },
        getJwtSecret(),
        { algorithm: "HS384" }
      ),
    ];

    for (const token of rejectedTokens) {
      const response = await getTripExpensesRoute(expenseFeedRequest(token), {
        params: Promise.resolve({ tripId: createTestId() }),
      });
      assert.equal(response.status, 401);
    }
  });

  it("returns HTTP 401 when the token is missing", async () => {
    const response = await getTripExpensesRoute(expenseFeedRequest(), {
      params: Promise.resolve({ tripId: createTestId() }),
    });
    assert.equal(response.status, 401);
  });

  it("retires the standalone login and registration endpoints", async () => {
    const [loginResponse, signupResponse] = await Promise.all([
      loginRoute(),
      signupRoute(),
    ]);

    assert.equal(loginResponse.status, 410);
    assert.equal(signupResponse.status, 410);
  });

  it("signs test access tokens with the main application's required claim shape", async () => {
    const token = signMainAppAccessToken(mainAppUserId);
    const decoded = jwt.decode(token);
    assert.ok(decoded && typeof decoded !== "string");
    assert.equal(decoded.sub, mainAppUserId);
    assert.equal(decoded.typ, "access");
  });
});
