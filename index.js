const express = require(`express`);
const axios = require(`axios`);
const nocache = require(`nocache`);
const auth = require(`basic-auth`);
const app = express();
const app2 = express();
require(`express-ws`)(app2);
const fs = require(`fs`);
const bodyParser = require(`body-parser`);
const WebSocket = require(`ws`);
let config = require(`./config/config.json`);

// Upgrade from 0.0.2
require(`./upgrade`);

const saveConfig = () => {
  fs.writeFile(`./config/config.json`, JSON.stringify(config, null, 4), (err) => {
    if (err) console.error(err);
    console.log(`Saved!`);
  });
};

if (!(config.client_id && config.client_id !== `` && config.client_id !== null)) { throw new Error(`You must include a Client ID in the config file.`); }
if (!(config.client_secret && config.client_secret !== `` && config.client_secret !== null)) { throw new Error(`You must include a Client Secret in the config file.`); }

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(nocache());
app2.use(bodyParser.json());
app2.use(bodyParser.urlencoded({ extended: true }));
app2.use(nocache());

app.all(`/*`, (req, res) => {
  let newHeaders = req.headers;
  delete newHeaders.host;

  newHeaders[`client-id`] = config.client_id;

  axios({
    method: req.method,
    url: `https://api.twitch.tv${req.originalUrl}`,
    headers: newHeaders,
    data: req.body,
  }).then((response) => {
    res.status(response.status).json(response.data);
  }).catch((err) => {
    res.status(err.response.status).json(err.response.data);
  });
});

const checkAndSetToken = async (channel) => {
  if (config.access_token[channel] === ``) {
    return `reauth`;
  }

  try {
    let response = await axios.post(`https://id.twitch.tv/oauth2/token`, null, {
      params: {
        grant_type: `refresh_token`,
        client_id: config.client_id,
        client_secret: config.client_secret,
        refresh_token: config.refresh_token[channel],
      },
    });
    config.access_token[channel] = response.data.access_token;
    config.refresh_token[channel] = response.data.refresh_token;
    saveConfig();
    return `ok`;
  } catch (err) {
    console.error(err);
    return `reauth`;
  }
};

const attemptAuthorisedResponse = async (req, res) => {
  let newHeaders = req.headers;
  delete newHeaders.host;

  if (config.access_token.length === 0) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }

  const user = auth(req);
  let channel = Object.keys(config.access_token)[0] || ``;

  if (user !== undefined && user.user !== ``) {
    channel = user.name;
  }

  if (config.access_token[channel] === undefined || config.access_token[channel] === ``) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }

  newHeaders.authorization = `${/^\/helix/.test(req.originalUrl) ? `Bearer` : `OAuth`} ${config.access_token[channel]}`;
  newHeaders[`client-id`] = `${config.client_id}`;

  try {
    let response = await axios({
      method: req.method,
      url: `https://api.twitch.tv${req.originalUrl}`,
      headers: newHeaders,
      data: req.body,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.log(err.response.headers);
    if (err.response.status === 401 && ((err.response.headers[`www-authenticate`] !== undefined && err.response.headers[`www-authenticate`].includes(`invalid_token`)) || err.response.data.message.includes(`oauth token`))) {
      let check = await checkAndSetToken(channel);
      if (check === `reauth`) {
        res.status(501).json({ error: `Re-authorisation required.` });
        return;
      }
      await attemptAuthorisedResponse(req, res);
      return;
    }

    res.status(err.response.status).json(err.response.data);
  }
};
const attemptAuthorisedWebsocket = async (ws, req) => {
  if (config.access_token.length === 0) {
    ws.close(1008, `Initial authorisation required.`);
    return;
  }

  const user = auth(req);
  let channel = Object.keys(config.access_token)[0] || ``;

  if (user !== undefined && user.user !== ``) {
    channel = user.name;
  }

  if (config.access_token[channel] === undefined || config.access_token[channel] === ``) {
    ws.close(1008, `Initial authorisation required.`);
    return;
  }
  ws.send(JSON.stringify({ type: `connect`, channel_id: channel }));
  const upstream = new WebSocket(`wss://irc-ws.chat.twitch.tv/`);
  upstream.on(`open`, () => {
    upstream.send(`PASS oauth:${config.access_token[channel]}`);
    upstream.send(`NICK ${channel}`);
    ws.send(JSON.stringify({ type: `handover` }));
  });
  upstream.on(`message`, x => ws.send(x));
  ws.on(`message`, x => upstream.send(x));
  upstream.on(`close`, () => ws.close(1000));
  ws.on(`close`, () => upstream.close(1000));
};
app2.get(`/gate/auth`, (req, res) => {
  let state = ``;
  if (req.query.state) state = `&state=${req.query.state}`;
  res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${config.client_id}&redirect_uri=${config.redirect_uri}&response_type=code&scope=${config.scope.join(` `)}${state}`);
});
app2.get(`/gate/auth/return`, async (req, res) => {
  if ((config.state_code !== undefined && config.state_code !== null && config.state_code !== ``) && (req.query.state === undefined || req.query.state !== config.state_code)) {
    res.status(401).json({ error: `Invalid authorisation.` });
    return;
  }
  if (req.query.error) {
    res.status(401).json({ error: `Failed to authorise.`, twitch: req.query });
  } else {
    try {
      let authorisationResponse = await axios.post(`https://id.twitch.tv/oauth2/token`, null, {
        params: {
          grant_type: `authorization_code`,
          redirect_uri: config.redirect_uri,
          client_id: config.client_id,
          client_secret: config.client_secret,
          code: req.query.code,
        },
      });
      let userResponse = await axios.get(`https://api.twitch.tv/kraken/user`, {
        headers: {
          authorization: `OAuth ${authorisationResponse.data.access_token}`,
        },
      });
      config.access_token[userResponse.data._id] = authorisationResponse.data.access_token;
      config.refresh_token[userResponse.data._id] = authorisationResponse.data.refresh_token;
      saveConfig();
      res.status(200).json({ status: `OK, saved ${userResponse.data.name} (Twitch ID: ${userResponse.data._id})` });
    } catch (err) {
      res.status(401).json({ error: `Failed to get code.`, code: err.response.status, twitch: err.response.data });
    }
  }
});
app2.ws(`/chat`, attemptAuthorisedWebsocket);
app2.all(`/*`, attemptAuthorisedResponse);


app.listen(config.port, config.host);
console.log(`Client App started on ${config.host}:${config.port}`);

app2.listen(config.port + 1, config.host);
console.log(`OAuth App started on ${config.host}:${config.port + 1}`);
