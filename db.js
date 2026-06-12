import { DatabaseSync } from 'node:sqlite';

// Single persistent file. Survives restarts -> requirement "persistent between runs".
const db = new DatabaseSync('events.db');

// WAL improves concurrent read/write behaviour; foreign keys enforce referential integrity.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,          -- event name must be unique
    total_seats INTEGER NOT NULL CHECK(total_seats > 0),
    event_date  TEXT    NOT NULL,                 -- ISO 8601 string
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL,
    user_name    TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id)
  );

  -- A user may hold at most ONE active row per event.
  -- Partial unique index ignores cancelled rows, so a user can re-register after cancelling.
  -- This is the DB-level guard against "same user registers twice" AND duplicate requests.
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_registration
    ON registrations(event_id, user_name) WHERE status = 'active';
`);

export default db;
