CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  iterations    INTEGER NOT NULL DEFAULT 100000,
  role          TEXT    NOT NULL CHECK (role IN ('owner','editor')),
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sections (
  id        TEXT    PRIMARY KEY,
  label     TEXT    NOT NULL,
  position  INTEGER NOT NULL,
  page_path TEXT    NOT NULL
);

CREATE TABLE assets (
  r2_key      TEXT PRIMARY KEY,
  thumb_key   TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  mime        TEXT    NOT NULL,
  sha256      TEXT    NOT NULL,
  origin      TEXT    NOT NULL CHECK (origin IN ('migration','upload')),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bound       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE slots (
  id           TEXT PRIMARY KEY,
  page_path    TEXT NOT NULL,
  label        TEXT NOT NULL,
  optional     INTEGER NOT NULL DEFAULT 0,
  r2_key       TEXT REFERENCES assets(r2_key),
  original_src TEXT NOT NULL,
  alt          TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_slots_page ON slots(page_path);

CREATE TABLE collections (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  section_id TEXT NOT NULL REFERENCES sections(id),
  page_path  TEXT NOT NULL,
  cover_key  TEXT REFERENCES assets(r2_key),
  event_date TEXT,
  published  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE collection_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL REFERENCES assets(r2_key),
  alt           TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL
);
CREATE INDEX idx_ci_collection ON collection_images(collection_id, position);

CREATE TABLE pending_publish (
  page_path  TEXT PRIMARY KEY,
  marked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_ip_at ON login_attempts(ip, at);
