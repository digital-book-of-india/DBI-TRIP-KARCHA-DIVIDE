import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "../lib/auth/authMiddleware";
import { getJwtSecret } from "../lib/jwtSecret";
import { setupTestDb, teardownTestDb, testDb, createTestId } from "./testDb";
import { GET as getTripExpensesRoute } from "../app/api/trips/[tripId]/expenses/route";
import { POST as resolveIdentityRoute } from "../app/api/integration/identity/route";
import { POST as loginRoute } from "../app/api/auth/login/route";
import { POST as signupRoute } from "../app/api/auth/signup/route";

const mainAppUserId = "507f1f77bcf86cd799439011";
const integrationSecret = "trip-kharcha-integration-test-secret-32-bytes";
let previousIntegrationSecret: string | undefined;

function createToken(
  claims: Record<string, unknown>,
  secret = integrationSecret
): string {
  return jwt.sign(claims, secret, { algorithm: "HS256" });
}

function identityToken(subject = mainAppUserId, email = "main@example.test") {
  return jwt.sign(
    { typ: "trip-identity", aud: "trip-kharcha", email, name: "Main User" },
    integrationSecret,
    { algorithm: "HS256", subject, expiresIn: "60s" }
  );
}

function identityRequest(token: string) {
  return new NextRequest("http://localhost:3000/api/integration/identity", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

function expenseFeedRequest(token?: string) {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  return new NextRequest("http://localhost:3000/api/trips/trip-id/expenses", { headers });
}

describe("Main application access token authentication", () => {
  beforeEach(() => {
    previousIntegrationSecret = process.env.TRIP_KHARCHA_INTEGRATION_SECRET;
    process.env.TRIP_KHARCHA_INTEGRATION_SECRET = integrationSecret;
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
    if (previousIntegrationSecret === undefined) {
      delete process.env.TRIP_KHARCHA_INTEGRATION_SECRET;
    } else {
      process.env.TRIP_KHARCHA_INTEGRATION_SECRET = previousIntegrationSecret;
    }
  });

  it("resolves a signed main-app identity and accepts the gateway's scoped access token", async () => {
    const identityResponse = await resolveIdentityRoute(identityRequest(identityToken()));
    const identityBody = await identityResponse.json();
    assert.equal(identityResponse.status, 200);
    assert.match(identityBody.data.userId, /^[0-9a-f-]{36}$/i);
    assert.equal(testDb.mainAppIdentities.get(mainAppUserId)?.userId, identityBody.data.userId);
    assert.equal(testDb.users.has(identityBody.data.userId), true);

    const token = createToken({
      sub: mainAppUserId,
      userId: identityBody.data.userId,
      typ: "access",
      aud: "trip-kharcha",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const user = await getAuthenticatedUser(expenseFeedRequest(token));

    assert.equal(user?.userId, identityBody.data.userId);
  });

  it("links a matching legacy profile to the main-app subject", async () => {
    const legacyUserId = createTestId();
    testDb.addUser({ id: legacyUserId, name: "Legacy User", email: "Legacy@Example.test" });
    const response = await resolveIdentityRoute(identityRequest(identityToken(mainAppUserId, "legacy@example.test")));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.userId, legacyUserId);
    assert.equal(testDb.users.has(legacyUserId), true);
    assert.equal(testDb.users.has(mainAppUserId), false);
  });

  it("rejects an invalid identity assertion", async () => {
    const response = await resolveIdentityRoute(identityRequest(createToken({
      sub: mainAppUserId,
      typ: "access",
      aud: "trip-kharcha",
      exp: Math.floor(Date.now() / 1000) + 60,
    })));
    assert.equal(response.status, 401);
  });

  it("rejects a missing token", async () => {
    assert.equal(await getAuthenticatedUser(expenseFeedRequest()), null);
  });

  it("rejects malformed, expired, refresh, and incorrectly signed tokens with HTTP 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rejectedTokens = [
      "not-a-jwt",
      createToken({ sub: mainAppUserId, userId: mainAppUserId, typ: "access", aud: "trip-kharcha" }),
      createToken({ userId: mainAppUserId, typ: "access", aud: "trip-kharcha", exp: now + 60 }),
      createToken({ sub: mainAppUserId, userId: mainAppUserId, typ: "access", aud: "trip-kharcha", exp: now - 1 }),
      createToken({ sub: mainAppUserId, userId: mainAppUserId, typ: "refresh", aud: "trip-kharcha", exp: now + 60 }),
      createToken({ sub: mainAppUserId, userId: mainAppUserId, typ: "access", aud: "other-app", exp: now + 60 }),
      createToken({ sub: mainAppUserId, role: "USER", typ: "access", exp: now + 60 }, getJwtSecret()),
      jwt.sign(
        { sub: mainAppUserId, userId: mainAppUserId, typ: "access", aud: "trip-kharcha", exp: now + 60 },
        integrationSecret,
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

  it("signs scoped access tokens with the gateway's required claim shape", async () => {
    const token = createToken({
      sub: mainAppUserId,
      userId: createTestId(),
      typ: "access",
      aud: "trip-kharcha",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const decoded = jwt.decode(token);
    assert.ok(decoded && typeof decoded !== "string");
    assert.equal(decoded.sub, mainAppUserId);
    assert.equal(decoded.typ, "access");
    assert.equal(decoded.aud, "trip-kharcha");
    assert.equal(typeof decoded.userId, "string");
  });
});
