const axios = require(`axios`);

// Overridable so the gate can be pointed at a mock Twitch for testing
const API_BASE = process.env.TWITCHGATE_API_BASE || `https://api.twitch.tv`;
const ID_BASE = process.env.TWITCHGATE_ID_BASE || `https://id.twitch.tv`;
const IRC_URL = process.env.TWITCHGATE_IRC_URL || `wss://irc-ws.chat.twitch.tv/`;

const http = axios.create({ timeout: 15000 });

// Summarise an axios error without dumping its config, which contains tokens and the client secret
const describeError = (err) => {
  if (err.response) {
    const { data } = err.response;
    const message = data && (data.message || data.error);
    return `HTTP ${err.response.status}${message ? `: ${message}` : ``}`;
  }
  return err.code || err.message;
};

const requestToken = async (config, params) => {
  const response = await http.post(`${ID_BASE}/oauth2/token`, null, {
    params: Object.assign({
      client_id: config.client_id,
      client_secret: config.client_secret,
    }, params),
  });
  return response.data;
};

const exchangeCode = (config, code) => requestToken(config, {
  grant_type: `authorization_code`,
  redirect_uri: config.redirect_uri,
  code,
});

const refreshToken = (config, refresh) => requestToken(config, {
  grant_type: `refresh_token`,
  refresh_token: refresh,
});

// Returns { client_id, login, user_id, scopes, expires_in }
const validateToken = async (accessToken) => {
  const response = await http.get(`${ID_BASE}/oauth2/validate`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  return response.data;
};

const authoriseUrl = (config, scopes, state) => {
  const params = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    response_type: `code`,
    scope: scopes.join(` `),
  });
  if (state) params.set(`state`, state);
  return `${ID_BASE}/oauth2/authorize?${params}`;
};

module.exports = {
  API_BASE,
  IRC_URL,
  describeError,
  exchangeCode,
  refreshToken,
  validateToken,
  authoriseUrl,
};
