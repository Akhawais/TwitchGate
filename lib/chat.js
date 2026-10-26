const WebSocket = require(`ws`);
const twitch = require(`./twitch`);
const { GateError } = require(`./tokens`);
const { identify } = require(`./proxy`);

const POLICY_VIOLATION = 1008;
const INTERNAL_ERROR = 1011;

const send = (socket, data) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(data);
};

// Bridges a client to Twitch IRC over WebSocket, logging in as the chosen channel
const chat = (config, tokens) => async (ws, req) => {
  let upstream = null;
  // Listen straight away so nothing the client sends during authorisation is lost
  const pending = [];
  ws.on(`message`, (data) => {
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    } else {
      pending.push(data);
    }
  });
  ws.on(`close`, () => {
    if (upstream) upstream.terminate();
  });

  let channel;
  try {
    const { channelName } = identify(req, config);
    channel = await tokens.validate(tokens.resolve(channelName).id);
  } catch (err) {
    ws.close(err instanceof GateError && err.status !== 502 ? POLICY_VIOLATION : INTERNAL_ERROR, err.message);
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) return;

  send(ws, JSON.stringify({ type: `connect`, channel_id: channel.id }));
  upstream = new WebSocket(twitch.IRC_URL);
  upstream.on(`open`, () => {
    upstream.send(`PASS oauth:${channel.access_token}`);
    upstream.send(`NICK ${channel.login || channel.id}`);
    send(ws, JSON.stringify({ type: `handover` }));
    pending.splice(0).forEach(data => upstream.send(data));
  });
  upstream.on(`message`, data => send(ws, data));
  upstream.on(`error`, (err) => {
    console.error(`Chat upstream error for ${channel.id}: ${err.message}`);
  });
  upstream.on(`close`, () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000);
  });
};

// Twitch shut PubSub down in April 2025; EventSub replaces it
const pubsub = () => (ws) => {
  ws.close(POLICY_VIOLATION, `PubSub was shut down by Twitch. Use EventSub via /helix/eventsub/subscriptions.`);
};

module.exports = { chat, pubsub };
