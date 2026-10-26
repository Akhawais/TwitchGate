const fs = require(`fs`);
const path = require(`path`);
const SQLite3 = require(`better-sqlite3`);
const defaultScopes = require(`./scopes`);
const twitch = require(`./twitch`);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS channels
  (
      id            VARCHAR(255) NOT NULL PRIMARY KEY,
      access_token  VARCHAR(255) NOT NULL,
      refresh_token VARCHAR(255) NOT NULL,
      last_updated  TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scopes
  (
      scope    VARCHAR(255) NOT NULL PRIMARY KEY,
      disabled SMALLINT
  );
`;

// Columns added after 2.0.0, applied to existing databases on startup
const CHANNEL_COLUMNS = {
  login: `VARCHAR(255)`,
  scopes: `TEXT`,
  expires_at: `TIMESTAMP`,
  needs_reauth: `SMALLINT NOT NULL DEFAULT 0`,
};

const openDatabase = (dbPath) => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new SQLite3(dbPath);
  db.pragma(`journal_mode = WAL`);
  db.exec(SCHEMA);

  const existing = db.prepare(`PRAGMA table_info(channels)`).all().map(column => column.name);
  for (const [name, type] of Object.entries(CHANNEL_COLUMNS)) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE channels ADD COLUMN ${name} ${type}`);
  }

  if (db.prepare(`SELECT COUNT(*) AS count FROM scopes`).get().count === 0) {
    const insert = db.prepare(`INSERT INTO scopes VALUES (?, NULL)`);
    db.transaction(() => defaultScopes.forEach(scope => insert.run(scope)))();
  }

  return db;
};

// Import tokens from configs written by 0.0.2 (single channel) or 1.x (per-channel maps).
// Existing rows are never overwritten, so this is safe to run on every start.
const migrateLegacyConfig = async (db, config) => {
  const insert = db.prepare(`INSERT OR IGNORE INTO channels (id, access_token, refresh_token, last_updated) VALUES (?, ?, ?, ?)`);
  let imported = 0;

  if (typeof config.access_token === `string` && config.access_token !== ``) {
    let accessToken = config.access_token;
    let refresh = config.refresh_token;
    let user;
    try {
      user = await twitch.validateToken(accessToken);
    } catch (err) {
      if (!refresh) throw new Error(`Cannot upgrade 0.0.2 config: ${twitch.describeError(err)}. Re-authorise via /gate/auth.`);
      const refreshed = await twitch.refreshToken(config, refresh);
      accessToken = refreshed.access_token;
      refresh = refreshed.refresh_token;
      user = await twitch.validateToken(accessToken);
    }
    imported += insert.run(user.user_id, accessToken, refresh, Date.now()).changes;
  } else if (config.access_token && typeof config.access_token === `object`) {
    for (const [channelId, accessToken] of Object.entries(config.access_token)) {
      imported += insert.run(channelId, accessToken, config.refresh_token[channelId], Date.now()).changes;
    }
  }

  if (Array.isArray(config.scope)) {
    const insertScope = db.prepare(`INSERT OR IGNORE INTO scopes VALUES (?, NULL)`);
    config.scope.forEach(scope => insertScope.run(scope));
  }

  if (imported > 0) {
    console.warn(`Imported ${imported} channel(s) from the legacy config. You can now remove access_token, refresh_token and scope from config.json.`);
  }
};

module.exports = { openDatabase, migrateLegacyConfig };
