const crypto = require(`crypto`);
const axios = require(`axios`);
const basicAuth = require(`basic-auth`);
const twitch = require(`./twitch`);
const { GateError } = require(`./tokens`);

const STRIP_REQUEST_HEADERS = [
  `host`, `connection`, `keep-alive`, `proxy-authorization`, `proxy-connection`, `te`, `trailer`,
  `transfer-encoding`, `upgrade`, `content-length`, `accept-encoding`, `x-gate-channel`, `x-gate-key`,
];
const STRIP_RESPONSE_HEADERS = [`connection`, `keep-alive`, `transfer-encoding`, `content-length`, `content-encoding`];

const http = axios.create({
  timeout: 30000,
  maxRedirects: 0,
  responseType: `arraybuffer`,
  validateStatus: () => true,
});

const safeEqual = (a, b) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
};

// Work out which channel a client wants, and which service it is when API keys are configured.
// Basic auth (username = channel, password = API key) or the X-Gate-Channel / X-Gate-Key headers,
// the latter for clients whose Twitch SDK already sets its own Authorization header.
const identify = (req, config) => {
  const credentials = basicAuth(req);
  const channelName = req.headers[`x-gate-channel`] || (credentials && credentials.name) || undefined;
  const keys = Object.entries(config.api_keys);
  if (keys.length === 0) return { channelName, service: null };

  const key = req.headers[`x-gate-key`] || (credentials && credentials.pass) || ``;
  const match = keys.find(([, value]) => safeEqual(key, String(value)));
  if (!match) throw new GateError(401, `Invalid or missing API key.`);
  return { channelName, service: match[0] };
};

const requestHeaders = (req) => {
  const headers = Object.assign({}, req.headers);
  STRIP_REQUEST_HEADERS.forEach((name) => { delete headers[name]; });
  return headers;
};

const forward = (req, headers) => http({
  method: req.method,
  url: `${twitch.API_BASE}${req.originalUrl}`,
  headers,
  data: Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined,
});

// Pass Twitch's response straight through, including its Ratelimit-* headers
const relay = (res, response) => {
  res.status(response.status);
  for (const [name, value] of Object.entries(response.headers)) {
    if (!STRIP_RESPONSE_HEADERS.includes(name.toLowerCase())) res.set(name, value);
  }
  res.end(Buffer.from(response.data));
};

const sendError = (res, err) => {
  if (err instanceof GateError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(`Proxy error: ${twitch.describeError(err)}`);
  res.status(502).json({ error: `Could not reach Twitch.` });
};

const isInvalidToken = (response) => {
  if (response.status !== 401) return false;
  const challenge = response.headers[`www-authenticate`];
  if (challenge && challenge.includes(`invalid_token`)) return true;
  return /oauth token/i.test(Buffer.from(response.data).toString());
};

// Unauthenticated passthrough: only adds the Client-ID
const passthrough = config => async (req, res) => {
  const headers = requestHeaders(req);
  headers[`client-id`] = config.client_id;
  try {
    relay(res, await forward(req, headers));
  } catch (err) {
    sendError(res, err);
  }
};

// Authenticated proxy: signs the request as the chosen channel, refreshing once if Twitch rejects the token
const authorised = (config, tokens) => async (req, res) => {
  try {
    const { channelName } = identify(req, config);
    let channel = await tokens.usable(tokens.resolve(channelName));

    const headers = requestHeaders(req);
    headers[`client-id`] = config.client_id;
    headers.authorization = `Bearer ${channel.access_token}`;

    let response = await forward(req, headers);
    if (isInvalidToken(response)) {
      channel = await tokens.refresh(channel.id, channel.access_token);
      headers.authorization = `Bearer ${channel.access_token}`;
      response = await forward(req, headers);
    }
    relay(res, response);
  } catch (err) {
    sendError(res, err);
  }
};

module.exports = {
  identify,
  passthrough,
  authorised,
  sendError,
};
