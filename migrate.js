const fs = require(`fs`);
const SQLite3 = require(`better-sqlite3`);
let config = require(`./config/config.json`);

// Upgrade from 1.x to 2.x
if (typeof config.access_token === `object`) {
  if (!fs.existsSync(`db/twitchgate.db`)) {
    console.error(`Upgrade from 1.x`);
    try {
      fs.mkdirSync(`db`);
    } catch (e) {
      //
    }
    const db = new SQLite3(`db/twitchgate.db`);
    db.prepare(`CREATE TABLE channels
                    (
                        id            VARCHAR(255) NOT NULL PRIMARY KEY,
                        access_token  VARCHAR(255) NOT NULL,
                        refresh_token VARCHAR(255) NOT NULL,
                        last_updated  TIMESTAMP
                    )`).run();
    db.prepare(`CREATE TABLE scopes
                    (
                        scope    VARCHAR(255) NOT NULL PRIMARY KEY,
                        disabled SMALLINT
                    )`).run();

    const stmt = db.prepare(`INSERT INTO channels
                                     VALUES (?, ?, ?, ?)`);
    for (let channelId of Object.keys(config.access_token)) {
      stmt.run(channelId, config.access_token[channelId], config.refresh_token[channelId], Date.now());
    }

    const stmt2 = db.prepare(`INSERT INTO scopes
                                      VALUES (?, NULL)`);
    for (let scope of Object.values(config.scope)) {
      stmt2.run(scope);
    }
    db.close();
    console.warn(`Migration complete.`);
  } else {
    console.warn(`Nothing to migrate.`);
  }
}
