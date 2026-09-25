import { DatabaseSync } from 'node:sqlite';

// SQLite storage for accounts, progression, leaderboards, purchases and analytics.
// Node's built-in SQLite: no extra dependency. ':memory:' for tests; a file in production
// (swap for Postgres when running several server machines).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  look TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bought (
  account_id TEXT NOT NULL,
  item TEXT NOT NULL,
  source TEXT NOT NULL,              -- 'coins' or a purchase reference
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item)
);
CREATE TABLE IF NOT EXISTS best_times (
  account_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  time REAL NOT NULL,
  medal TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, level_id)
);
CREATE INDEX IF NOT EXISTS best_times_board ON best_times (level_id, time);
CREATE TABLE IF NOT EXISTS challenge_progress (
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  challenge TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day, challenge)
);
CREATE TABLE IF NOT EXISTS grants (
  claim_id TEXT PRIMARY KEY,         -- makes every reward idempotent
  account_id TEXT NOT NULL,
  xp INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  doubled INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  ref TEXT PRIMARY KEY,              -- payment provider's id (e.g. Stripe checkout session)
  account_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anon_id TEXT NOT NULL,
  session TEXT NOT NULL,
  name TEXT NOT NULL,
  props TEXT NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_anon ON events (anon_id, t);
CREATE TABLE IF NOT EXISTS errors (
  hash TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  stack TEXT NOT NULL,
  url TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    // WAL + busy timeout: several worker processes can share one database file. Switching a
    // new file to WAL needs an exclusive lock and ignores the busy timeout, so retry briefly
    // (the gateway also prepares the file before starting workers).
    this.db.exec('PRAGMA busy_timeout = 5000;');
    for (let attempt = 0; ; attempt++) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        this.db.exec(SCHEMA);
        break;
      } catch (e) {
        if (attempt >= 50 || !String((e as Error).message).includes('locked')) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); // sleep 100 ms
      }
    }
  }

  /** Runs `fn` in a transaction (all or nothing). */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.db.close();
  }
}
