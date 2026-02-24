import crypto from "node:crypto";

import { sql } from "@vercel/postgres";

type StoredUser = {
  email: string;
  password_hash: string;
  agreed_to_legal: boolean;
};

let schemaReady = false;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) {
    return false;
  }

  const computed = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

async function ensureSchema() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not set. Configure a persistent database for multi-device login.");
  }

  if (schemaReady) {
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      agreed_to_legal BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  schemaReady = true;
}

export async function createUser(params: {
  email: string;
  password: string;
  agreedToLegal: boolean;
}): Promise<{ ok: true } | { ok: false; reason: "exists" }> {
  await ensureSchema();
  const email = normalizeEmail(params.email);
  const passwordHash = hashPassword(params.password);

  try {
    await sql`
      INSERT INTO app_users (email, password_hash, agreed_to_legal)
      VALUES (${email}, ${passwordHash}, ${params.agreedToLegal})
    `;
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { ok: false, reason: "exists" };
    }
    throw error;
  }
}

export async function verifyUserCredentials(params: {
  email: string;
  password: string;
}): Promise<{ ok: true; email: string } | { ok: false }> {
  await ensureSchema();
  const email = normalizeEmail(params.email);
  const result = await sql<StoredUser>`
    SELECT email, password_hash, agreed_to_legal
    FROM app_users
    WHERE email = ${email}
    LIMIT 1
  `;

  const row = result.rows[0];
  if (!row) {
    return { ok: false };
  }
  if (!verifyPassword(params.password, row.password_hash)) {
    return { ok: false };
  }

  return { ok: true, email: row.email };
}
