import { Pool, PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

let pool: Pool;

declare global {
  var pgPool: Pool | undefined;
}

if (!global.pgPool) {
  global.pgPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}
pool = global.pgPool;

let isInitialized = false;

export async function initDB() {
  if (isInitialized) return;

  const ddl = `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      terms_accepted BOOLEAN DEFAULT true,
      account_status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      destination TEXT DEFAULT '',
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      currency TEXT DEFAULT 'INR',
      created_by UUID REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trip_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'MEMBER',
      membership_status TEXT DEFAULT 'JOINED',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(trip_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS trip_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
      invite_code_hash TEXT UNIQUE NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      max_uses INT DEFAULT 50,
      uses_count INT DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      entity_id UUID,
      metadata_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT true;
    ALTER TABLE trip_invites ADD COLUMN IF NOT EXISTS invite_code_hash TEXT;

    -- Secondary Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_trip_members_trip ON trip_members (trip_id);
    CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members (user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_events_trip_created ON activity_events (trip_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trip_invites_hash ON trip_invites (invite_code_hash);
  `;

  await pool.query(ddl);
  isInitialized = true;
}

export async function query(text: string, params?: any[]) {
  await initDB();
  return pool.query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  await initDB();
  return pool.connect();
}

export async function logActivity(
  executor: { query: (text: string, params?: any[]) => Promise<any> },
  tripId: string,
  actorUserId: string,
  eventType: string,
  entityId?: string | null,
  metadata?: Record<string, any>
) {
  return executor.query(
    `INSERT INTO activity_events (trip_id, actor_user_id, event_type, entity_id, metadata_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tripId, actorUserId, eventType, entityId || null, metadata ? JSON.stringify(metadata) : null]
  );
}