const fs = require(`fs`);
const path = require(`path`);

const ROOT = path.join(__dirname, `..`);

const isBlank = value => value === undefined || value === null || value === ``;

const loadConfig = () => {
  const configPath = process.env.TWITCHGATE_CONFIG || path.join(ROOT, `config`, `config.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Copy config/config.example.json to config/config.json first.`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, `utf8`));

  if (isBlank(config.client_id)) throw new Error(`You must include a Client ID in the config file.`);
  if (isBlank(config.client_secret)) throw new Error(`You must include a Client Secret in the config file.`);
  if (isBlank(config.redirect_uri)) throw new Error(`You must include a Redirect URI in the config file.`);

  config.host = config.host || `127.0.0.1`;
  config.port = Number(config.port || 2570);
  config.db_path = path.resolve(ROOT, process.env.TWITCHGATE_DB || config.db_path || path.join(`db`, `twitchgate.db`));
  config.api_keys = config.api_keys || {};

  return config;
};

module.exports = { loadConfig };
