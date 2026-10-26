const express = require(`express`);
const nocache = require(`nocache`);
const expressWs = require(`express-ws`);
const { loadConfig } = require(`./lib/config`);
const { openDatabase, migrateLegacyConfig } = require(`./lib/db`);
const { TokenManager, describeChannel } = require(`./lib/tokens`);
const proxy = require(`./lib/proxy`);
const { chat, pubsub } = require(`./lib/chat`);
const twitch = require(`./lib/twitch`);

const main = async () => {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  await migrateLegacyConfig(db, config);

  const tokens = new TokenManager(db, config);
  console.log(`Loaded`, tokens.list().length, `channels.`);
  if (Object.keys(config.api_keys).length === 0) {
    console.warn(`No api_keys configured: any client that can reach the gate can use its tokens.`);
  }
  tokens.startMaintenance();

  const rawBody = express.raw({ type: () => true, limit: `10mb` });

  // Client App: unauthenticated passthrough that only adds the Client-ID
  const app = express();
  app.disable(`x-powered-by`);
  app.use(nocache());
  app.all(`/*`, rawBody, proxy.passthrough(config));

  // OAuth App: authenticated proxy, token API and authorisation flow
  const app2 = express();
  expressWs(app2);
  app2.disable(`x-powered-by`);
  app2.use(nocache());

  const stateRequired = config.state_code !== undefined && config.state_code !== null && config.state_code !== ``;

  app2.get(`/gate/auth`, (req, res) => {
    if (stateRequired && req.query.state !== config.state_code) {
      res.status(401).json({ error: `Invalid authorisation.` });
      return;
    }
    const scopes = db.prepare(`SELECT scope FROM scopes WHERE disabled IS NULL`).all().map(row => row.scope);
    res.redirect(twitch.authoriseUrl(config, scopes, req.query.state));
  });

  app2.get(`/gate/auth/return`, async (req, res) => {
    if (stateRequired && req.query.state !== config.state_code) {
      res.status(401).json({ error: `Invalid authorisation.` });
      return;
    }
    if (req.query.error) {
      res.status(401).json({ error: `Failed to authorise.`, twitch: req.query });
      return;
    }
    try {
      const channel = await tokens.addFromAuthorisation(await twitch.exchangeCode(config, req.query.code));
      console.log(`Authorised ${channel.login} (${channel.id}).`);
      res.status(200).json({ status: `OK, saved ${channel.login} (Twitch ID: ${channel.id})` });
    } catch (err) {
      console.error(`Authorisation failed: ${twitch.describeError(err)}`);
      res.status(401).json({
        error: `Failed to get code.`,
        code: err.response ? err.response.status : null,
        twitch: err.response ? err.response.data : null,
      });
    }
  });

  app2.get(`/gate/access_token`, async (req, res) => {
    try {
      const { channelName } = proxy.identify(req, config);
      const channel = tokens.resolve(channelName);
      const fresh = req.query.verify === `yes` ? await tokens.validate(channel.id) : await tokens.usable(channel);
      res.status(200).json(Object.assign({ access_token: fresh.access_token }, describeChannel(fresh)));
    } catch (err) {
      proxy.sendError(res, err);
    }
  });

  app2.get(`/gate/channels`, (req, res) => {
    try {
      proxy.identify(req, config);
      res.status(200).json({ channels: tokens.list().map(describeChannel) });
    } catch (err) {
      proxy.sendError(res, err);
    }
  });

  app2.get(`/gate/health`, (req, res) => {
    const channels = tokens.list();
    res.status(200).json({
      status: `ok`,
      channels: channels.length,
      needs_reauth: channels.filter(channel => channel.needs_reauth).map(channel => channel.login || channel.id),
    });
  });

  app2.ws(`/chat`, chat(config, tokens));
  app2.ws(`/pubsub`, pubsub());
  app2.all(`/*`, rawBody, proxy.authorised(config, tokens));

  const servers = [
    app.listen(config.port, config.host, () => console.log(`Client App started on ${config.host}:${config.port}`)),
    app2.listen(config.port + 1, config.host, () => console.log(`OAuth App started on ${config.host}:${config.port + 1}`)),
  ];

  const shutdown = () => {
    tokens.stop();
    servers.forEach(server => server.close());
    db.close();
    process.exit(0);
  };
  process.on(`SIGINT`, shutdown);
  process.on(`SIGTERM`, shutdown);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
