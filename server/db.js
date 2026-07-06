const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const nativeBinding = nativeBindingPath();
  const db = new Database(path.join(dataDir, 'chatlet.db'), nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      referrer TEXT DEFAULT '',
      current_page TEXT DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',          -- open | closed
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender TEXT NOT NULL,                          -- visitor | agent | system
      body TEXT NOT NULL,
      offline INTEGER NOT NULL DEFAULT 0,            -- 1 = left while no agent was online
      agent_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS canned_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shortcut TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_visitor ON conversations(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_conv_site ON conversations(site_id);
    CREATE INDEX IF NOT EXISTS idx_visitors_site ON visitors(site_id);
  `);

  // Seed a default site so the quick-start embed works out of the box.
  const count = db.prepare('SELECT COUNT(*) AS n FROM sites').get().n;
  if (count === 0) {
    db.prepare('INSERT INTO sites (id, name) VALUES (?, ?)')
      .run(crypto.randomBytes(8).toString('hex'), 'My Website');
  }

  return db;
}

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

module.exports = { openDb, getSetting, setSetting };
