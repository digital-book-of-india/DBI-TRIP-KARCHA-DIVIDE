/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from "@prisma/client";
import { Pool, PoolClient, QueryResult } from "pg";

// -------------------------------------------------------------
// 1. PRISMA CLIENT SINGLETON (Developer 2 & Developer 3)
// -------------------------------------------------------------

declare global {
  var prismaGlobal: PrismaClient | undefined;
  var pgPoolGlobal: Pool | undefined;
}

let activePrisma: PrismaClient =
  global.prismaGlobal ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = activePrisma;
}

export function getPrisma(): PrismaClient {
  return activePrisma;
}

export function setPrismaClient(client: PrismaClient) {
  activePrisma = client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    return (activePrisma as any)[prop];
  },
});

export async function connectDB(): Promise<PrismaClient> {
  return activePrisma;
}

// -------------------------------------------------------------
// 2. PG CONNECTION POOL & LIFECYCLE (Developer 1 Auth & Trips)
// -------------------------------------------------------------

function getPgPool(): Pool {
  if (!global.pgPoolGlobal) {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/dbi_trip_karcha?schema=public";

    global.pgPoolGlobal = new Pool({
      connectionString,
      ssl: process.env.DATABASE_URL?.includes("supabase.com")
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return global.pgPoolGlobal;
}

export const pool = new Proxy({} as Pool, {
  get(_target, prop: string | symbol) {
    return (getPgPool() as any)[prop];
  },
});

let isInitialized = false;

export async function initDB(): Promise<void> {
  if (isInitialized) return;

  // NOTE ON ID TYPES: these tables are also modeled in prisma/schema.prisma
  // (User, Trip, TripMember, TripInvite, ActivityEvent) because Developer 2/3
  // Prisma tables (expenses, settlements, notifications, ...) hold foreign
  // keys into them. Prisma declares every id/relation field as `String`
  // (Postgres TEXT), so these raw-SQL-managed tables must use TEXT ids too —
  // a native `UUID` column type here would make `prisma migrate`/`db push`
  // fail to create matching foreign key constraints on the Prisma-owned
  // tables (Postgres requires FK column types to match). We still generate
  // random UUID-shaped values for the ids, just stored as TEXT.
  const ddl = `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      terms_accepted BOOLEAN DEFAULT true,
      account_status TEXT DEFAULT 'ACTIVE',
      is_platform_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      destination TEXT DEFAULT '',
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      currency TEXT DEFAULT 'INR',
      created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trip_members (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'MEMBER',
      membership_status TEXT DEFAULT 'JOINED',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(trip_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS trip_invites (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
      invite_code_hash TEXT UNIQUE NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      max_uses INT DEFAULT 50,
      uses_count INT DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      entity_id TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;
    ALTER TABLE trip_invites ADD COLUMN IF NOT EXISTS invite_code_hash TEXT;
    ALTER TABLE trip_invites ADD COLUMN IF NOT EXISTS invitee_email TEXT;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS share_code TEXT UNIQUE;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_trips_share_code ON trips (share_code);

    CREATE INDEX IF NOT EXISTS idx_trip_members_trip ON trip_members (trip_id);
    CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members (user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_events_trip_created ON activity_events (trip_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trip_invites_hash ON trip_invites (invite_code_hash);
  `;

  await getPgPool().query(ddl);
  isInitialized = true;
}

export async function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  await initDB();
  return getPgPool().query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  await initDB();
  return getPgPool().connect();
}

export async function logActivity(
  executor: { query: (text: string, params?: any[]) => Promise<any> },
  tripId: string,
  actorUserId: string,
  eventType: string,
  entityId?: string | null,
  metadata?: Record<string, any>
): Promise<any> {
  return executor.query(
    `INSERT INTO activity_events (trip_id, actor_user_id, event_type, entity_id, metadata_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tripId, actorUserId, eventType, entityId || null, metadata ? JSON.stringify(metadata) : null]
  );
}

export default prisma;
