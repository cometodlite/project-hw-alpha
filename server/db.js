import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = "server/data/hw.sqlite";

export function nowIso() {
  return new Date().toISOString();
}

export function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

export function decodeJson(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createDb(databasePath = process.env.DATABASE_PATH || DEFAULT_DB_PATH) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      public_user_code TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      email_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS player_state (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      save_version INTEGER NOT NULL DEFAULT 1,
      schema_version TEXT NOT NULL,
      inventory_json TEXT NOT NULL,
      housing_json TEXT NOT NULL,
      unlocks_json TEXT NOT NULL,
      life_skills_json TEXT NOT NULL,
      activity_stats_json TEXT NOT NULL,
      farm_plot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      coin INTEGER NOT NULL DEFAULT 0,
      free_bling INTEGER NOT NULL DEFAULT 0,
      paid_bling INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS currency_ledger (
      ledger_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      currency TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, currency, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      purchase_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_transaction_id TEXT,
      mock_payment_token TEXT,
      status TEXT NOT NULL,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      paid_at TEXT,
      granted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS grant_records (
      grant_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      purchase_id TEXT REFERENCES purchases(purchase_id) ON DELETE SET NULL,
      product_id TEXT,
      reward_data_json TEXT NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      entitlement_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      entitlement_type TEXT NOT NULL,
      entitlement_key TEXT NOT NULL,
      status TEXT NOT NULL,
      purchase_id TEXT REFERENCES purchases(purchase_id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE(user_id, entitlement_type, entitlement_key)
    );

    CREATE TABLE IF NOT EXISTS refund_cases (
      refund_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      purchase_id TEXT NOT NULL REFERENCES purchases(purchase_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      requested_reason TEXT,
      refundable_amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      revoke_required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restore_events (
      restore_event_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      restored_purchase_count INTEGER NOT NULL DEFAULT 0,
      restored_entitlement_count INTEGER NOT NULL DEFAULT 0,
      synced_wallet INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      audit_id TEXT PRIMARY KEY,
      admin_token_label TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      target_id TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
