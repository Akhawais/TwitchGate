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
let channels = {};
const SQLite3 = require(`better-sqlite3`);

// Upgrade from 0.0.2
require(`./upgrade`);

if (!fs.existsSync(`db/twitchgate.db`)) {
  throw new Error(`Database not found.`);
}

const db = new SQLite3(`db/twitchgate.db`);
const rows = db.prepare(`SELECT * FROM channels`).all();
for (let row of rows) {
  channels[row.id] = row;
}
console.log(`Loaded`, Object.keys(channels).length, `channels.`);

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
    data: req.method === `GET` ? null : req.body,
  }).then((response) => {
    res.status(response.status).json(response.data);
  }).catch((err) => {
    res.status(err.response.status).json(err.response.data);
  });
});

const checkAndSetToken = async (channel) => {
  if (channels[channel] === undefined) {
    return `reauth`;
  }

  if (channels[channel].refresh_token === undefined) {
    return `reauth`;
  }

  try {
    let response = await axios.post(`https://id.twitch.tv/oauth2/token`, null, {
      params: {
        grant_type: `refresh_token`,
        client_id: config.client_id,
        client_secret: config.client_secret,
        refresh_token: channels[channel].refresh_token,
      },
    });
    channels[channel].access_token = response.data.access_token;
    channels[channel].refresh_token = response.data.refresh_token;
    channels[channel].last_updated = Date.now();
    db.prepare(`UPDATE channels SET access_token = @access_token, refresh_token = @refresh_token, last_updated = @last_updated WHERE id = @id`)
      .run(channels[channel]);
    return `ok`;
  } catch (err) {
    console.error(err);
    return `reauth`;
  }
};

const attemptAuthorisedResponse = async (req, res, retried = false) => {
  let newHeaders = req.headers;
  delete newHeaders.host;

  if (channels.length === 0) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }

  const user = auth(req);
  let channel = Object.keys(channels)[0] || ``;

  if (user !== undefined && user.user !== ``) {
    channel = user.name;
  }

  if (channels[channel] === undefined || channels[channel].access_token === undefined || channels[channel].access_token === ``) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }

  newHeaders.authorization = `${/^\/helix/.test(req.originalUrl) ? `Bearer` : `OAuth`} ${channels[channel].access_token}`;
  newHeaders[`client-id`] = `${config.client_id}`;

  try {
    let response = await axios({
      method: req.method,
      url: `https://api.twitch.tv${req.originalUrl}`,
      headers: newHeaders,
      data: req.method === `GET` ? null : req.body,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(err.response.headers);
    if (err.response.status === 401 && ((err.response.headers[`www-authenticate`] !== undefined && err.response.headers[`www-authenticate`].includes(`invalid_token`)) || err.response.data.message.match(/oauth token/i) !== null)) {
      let check = await checkAndSetToken(channel);
      if (check === `reauth` || retried) {
        res.status(501).json({ error: `Re-authorisation required.` });
        return;
      }
      await attemptAuthorisedResponse(req, res, true);
      return;
    }

    res.status(err.response.status).json(err.response.data);
  }
};
const attemptAuthorisedWebsocket = async (ws, req) => {
  if (channels.length === 0) {
    ws.close(1008, `Initial authorisation required.`);
    return;
  }

  const user = auth(req);
  let channel = Object.keys(channels)[0] || ``;

  if (user !== undefined && user.user !== ``) {
    channel = user.name;
  }

  if (channels[channel] === undefined || channels[channel].access_token === undefined || channels[channel].access_token === ``) {
    ws.close(1008, `Initial authorisation required.`);
    return;
  }

  try {
    await axios.get(`https://id.twitch.tv/oauth2/validate`, {
      headers: {
        Authorization: `Bearer ${channels[channel].access_token}`,
      },
    });
  } catch (err) {
    if (err.response && err.response.status === 401) {
      let check = await checkAndSetToken(channel);
      if (check === `reauth`) {
        ws.close(1008, `Re-authorisation required.`);
        return;
      }
    }
    console.error(err);
  }

  ws.send(JSON.stringify({ type: `connect`, channel_id: channel }));
  const upstream = new WebSocket(`wss://irc-ws.chat.twitch.tv/`);
  upstream.on(`open`, () => {
    upstream.send(`PASS oauth:${channels[channel].access_token}`);
    upstream.send(`NICK ${channel}`);
    ws.send(JSON.stringify({ type: `handover` }));
  });
  upstream.on(`message`, x => ws.send(x));
  ws.on(`message`, x => upstream.send(x));
  upstream.on(`close`, () => ws.close(1000));
  ws.on(`close`, () => upstream.close(1000));
};
const attemptAuthorisedPubsub = async (ws) => {
  if (channels.length === 0) {
    ws.close(1008, `Initial authorisation required.`);
    return;
  }

  let channel = Object.keys(channels)[0] || ``;

  ws.send(JSON.stringify({ type: `connect`, channel_id: channel }));
  const upstream = new WebSocket(`wss://pubsub-edge.twitch.tv/`);
  upstream.on(`open`, () => {
    ws.send(JSON.stringify({ type: `handover` }));
  });
  upstream.on(`message`, x => ws.send(x));
  ws.on(`message`, async (x) => {
    let channelMatch = x.match(/!(?:[\w-]+)\.(\d+)!/);
    if (channelMatch !== null) {
      const authChannel = channelMatch[1];
      if (channels[authChannel] === undefined || channels[authChannel].access_token === undefined || channels[authChannel].access_token === ``) {
        ws.close(1008, `Initial authorisation required.`);
        return;
      }
      try {
        await axios.get(`https://id.twitch.tv/oauth2/validate`, {
          headers: {
            Authorization: `Bearer ${channels[authChannel].access_token}`,
          },
        });
      } catch (err) {
        if (err.response && err.response.status === 401) {
          let check = await checkAndSetToken(authChannel);
          if (check === `reauth`) {
            ws.close(1008, `Re-authorisation required.`);
            return;
          }
        }
        console.error(err);
      }
      x = x.replace(`!CHANNEL_TOKEN.${authChannel}!`, channels[authChannel].access_token);
    }
    upstream.send(x);
  });
  upstream.on(`close`, () => ws.close(1000));
  ws.on(`close`, () => upstream.close(1000));
};
app2.get(`/gate/access_token`, async (req, res) => {
  if (channels.length === 0) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }

  const user = auth(req);
  let channel = Object.keys(channels)[0] || ``;

  if (user !== undefined && user.user !== ``) {
    channel = user.name;
  }

  if (channels[channel] === undefined || channels[channel].access_token === undefined || channels[channel].access_token === ``) {
    res.status(501).json({ error: `Initial authorisation required.` });
    return;
  }
  if (req.query.verify === `yes`) {
    try {
      await axios.get(`https://id.twitch.tv/oauth2/validate`, {
        headers: {
          Authorization: `Bearer ${channels[channel].access_token}`,
        },
      });
    } catch (err) {
      if (err.response && err.response.status === 401) {
        let check = await checkAndSetToken(channel);
        if (check === `reauth`) {
          res.status(501).json({ error: `Re-authorisation required.` });
          return;
        }
      }
      console.error(err);
    }
  }
  res.status(200).json({ access_token: channels[channel].access_token });
});
app2.get(`/gate/auth`, (req, res) => {
  let state = ``;
  if (req.query.state) state = `&state=${req.query.state}`;
  const scopes = db.prepare(`SELECT scope FROM scopes WHERE disabled IS NULL`).all();
  const scopeString = scopes.map(scopeObject => scopeObject.scope).join(` `);
  res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${config.client_id}&redirect_uri=${config.redirect_uri}&response_type=code&scope=${scopeString}${state}`);
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
      let userResponse = await axios.get(`https://id.twitch.tv/oauth2/validate`, {
        headers: {
          Authorization: `Bearer ${authorisationResponse.data.access_token}`,
        },
      });
      channels[userResponse.data.user_id] = {
        id: userResponse.data.user_id,
        access_token: authorisationResponse.data.access_token,
        refresh_token: authorisationResponse.data.refresh_token,
        last_updated: Date.now(),
      };
      db.prepare(`INSERT INTO channels (id, access_token, refresh_token, last_updated) VALUES (@id, @access_token, @refresh_token, @last_updated) ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, last_updated = excluded.last_updated`)
        .run(channels[userResponse.data.user_id]);
      res.status(200).json({ status: `OK, saved ${userResponse.data.login} (Twitch ID: ${userResponse.data.login})` });
    } catch (err) {
      res.status(401).json({ error: `Failed to get code.`, code: err.response.status, twitch: err.response.data });
    }
  }
});
app2.ws(`/chat`, attemptAuthorisedWebsocket);
app2.ws(`/pubsub`, attemptAuthorisedPubsub);
app2.all(`/*`, attemptAuthorisedResponse);


app.listen(config.port, config.host);
console.log(`Client App started on ${config.host}:${config.port}`);

app2.listen(config.port + 1, config.host);
console.log(`OAuth App started on ${config.host}:${config.port + 1}`);
