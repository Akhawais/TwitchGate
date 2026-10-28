const fs = require(`fs`);
const path = require(`path`);

const ROOT = path.join(__dirname, `..`);

const isBlank = value => value === undefined || value === null || value === ``;

// Environment variables take precedence over config.json, so the gate can run without a config file (e.g. in Docker)
const ENV_OVERRIDES = {
  client_id: `TWITCHGATE_CLIENT_ID`,
  client_secret: `TWITCHGATE_CLIENT_SECRET`,
  redirect_uri: `TWITCHGATE_REDIRECT_URI`,
  state_code: `TWITCHGATE_STATE_CODE`,
  host: `TWITCHGATE_HOST`,
  port: `TWITCHGATE_PORT`,
};

const loadConfig = () => {
  const configPath = process.env.TWITCHGATE_CONFIG || path.join(ROOT, `config`, `config.json`);
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, `utf8`));
  } else if (process.env.TWITCHGATE_CONFIG) {
    throw new Error(`Config not found at ${configPath}.`);
  }

  for (const [key, name] of Object.entries(ENV_OVERRIDES)) {
    if (!isBlank(process.env[name])) config[key] = process.env[name];
  }
  // TWITCHGATE_API_KEYS is a comma-separated list of name:key pairs
  if (!isBlank(process.env.TWITCHGATE_API_KEYS)) {
    config.api_keys = {};
    for (const pair of process.env.TWITCHGATE_API_KEYS.split(`,`)) {
      const separator = pair.indexOf(`:`);
      if (separator < 1) throw new Error(`TWITCHGATE_API_KEYS must be a comma-separated list of name:key pairs.`);
      config.api_keys[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
    }
  }

  if (isBlank(config.client_id)) throw new Error(`You must include a Client ID in the config file or TWITCHGATE_CLIENT_ID.`);
  if (isBlank(config.client_secret)) throw new Error(`You must include a Client Secret in the config file or TWITCHGATE_CLIENT_SECRET.`);
  if (isBlank(config.redirect_uri)) throw new Error(`You must include a Redirect URI in the config file or TWITCHGATE_REDIRECT_URI.`);

  config.host = config.host || `127.0.0.1`;
  config.port = Number(config.port || 2570);
  config.db_path = path.resolve(ROOT, process.env.TWITCHGATE_DB || config.db_path || path.join(`db`, `twitchgate.db`));
  config.api_keys = config.api_keys || {};

  return config;
};

module.exports = { loadConfig };
