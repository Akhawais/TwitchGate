const { loadConfig } = require(`./lib/config`);
const { openDatabase, migrateLegacyConfig } = require(`./lib/db`);

// Creates or upgrades the database. index.js does the same on start, so this is optional.
const main = async () => {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  await migrateLegacyConfig(db, config);
  db.close();
  console.warn(`Setup complete: ${config.db_path}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
