# TwitchGate

TwitchGate is a proxy to the Twitch services that centrally manages OAuth tokens for all your apps. It proxies Helix requests and Twitch chat (IRC over WebSocket) with authentication silently handled, and can hand tokens out to apps that need to talk to Twitch directly.

This is useful if you create and maintain a lot of apps or microservices for one or more users/channels: there's a single Twitch app and a single place where tokens are stored, refreshed and validated, so none of your services need OAuth code of their own.

This is designed to be run on a local network that is not accessible from the Internet. If your apps are hosted on separate servers, consider setting up a VPN between them, and configure `api_keys` so only your own services can use the gate.

## Getting started

Requires Node.js 22 or later. Clone this repository and run `yarn` or `npm install` to install the dependencies.

## Configuration

Copy `config/config.example.json` to `config/config.json` (or run `npm run init`) and fill in:

- `client_id` / `client_secret`: your Twitch app's credentials
- `redirect_uri`: the OAuth app's address followed by `/gate/auth/return` (OAuth app is on `port` + 1)
- `state_code`: a long random string to stop other people authorising onto your gate (optional, leave empty to disable)
- `host` / `port`: where to listen
- `api_keys`: a map of service name to secret key, e.g. `{"chatbot": "…", "overlay": "…"}`. When set, every request to the gate must present one of these keys. Leave empty to allow any client (not recommended outside a trusted network)

`TWITCHGATE_CONFIG` and `TWITCHGATE_DB` environment variables override the config and database paths.

The scopes requested during authorisation are stored in the `scopes` table of `db/twitchgate.db`. Set `disabled` on any you don't need.

## Starting the proxy

Run `npm start`.

The database is created on first start, and older databases and configs (0.0.2 and 1.x tokens in `config.json`) are migrated automatically.

The Client App is hosted at `host`:`port`, and the OAuth App (the authenticated proxy) at `port` + 1.

## Running in Docker

The gate can be configured entirely with environment variables: `TWITCHGATE_CLIENT_ID`, `TWITCHGATE_CLIENT_SECRET`, `TWITCHGATE_REDIRECT_URI`, `TWITCHGATE_STATE_CODE` and `TWITCHGATE_API_KEYS` (comma-separated `name:key` pairs). These override `config.json` when both are present.

1. Copy `.env.example` to `.env` and fill it in. Add `TWITCHGATE_REDIRECT_URI` as an OAuth redirect URL on your Twitch app.
2. Copy `docker-compose.example.yml` to `docker-compose.yml`, and add your services to the `twitchgate` network.
3. Run `docker compose up -d`.
4. Add channels by opening `http://localhost:2571/gate/auth` in your browser.

Your services then use `http://twitchgate:2571` in place of `https://api.twitch.tv`.

Tokens are stored in the `twitchgate-data` volume (`/data` in the container), so they survive rebuilds. Back this volume up: losing it means re-authorising every channel.

To move an existing install into Docker, copy `db/twitchgate.db` into the volume before first start:

```sh
docker compose create
docker compose cp db/twitchgate.db twitchgate:/data/twitchgate.db
# The copy keeps your host user's ownership; the gate runs as `node` and needs to write to it
docker compose run --rm --no-deps --user root --entrypoint chown twitchgate node:node /data/twitchgate.db
docker compose up -d
```

## Adding channels

While logged in to Twitch as the channel/user you wish to add, open `/gate/auth` on the OAuth App (with `?state=<state_code>` if you set one).

Authorise on the Twitch OAuth screen, and you'll be redirected back to the gate, which shows a success message.

Repeat with as many channels/users as you need. Re-authorising an existing channel replaces its tokens.

## Token management

- Tokens are refreshed shortly before they expire, so services aren't handed a token that's about to die.
- Every token is validated hourly, as Twitch requires.
- When many requests hit an expired token at once, the gate refreshes it once and shares the result.
- If Twitch rejects a refresh token (e.g. the user disconnected the app), the channel is flagged as needing re-authorisation and shows up in `/gate/health`.

## Usage

### Choosing a channel and authenticating

Every endpoint on the OAuth App takes the channel and API key in either of two ways:

- **Basic auth**: username = channel (Twitch ID or login), password = API key
- **Headers**: `X-Gate-Channel` and `X-Gate-Key`. Use these when your Twitch SDK sets its own `Authorization` header

If no channel is given, the gate uses the first channel that was added.

### REST APIs

Replace `https://api.twitch.tv` with the OAuth App's URL. That's it!

e.g. `https://api.twitch.tv/helix/streams` => `http://gate.local:2571/helix/streams`

The gate adds the `Client-Id` and `Authorization` headers, retries once with a refreshed token if Twitch rejects it, and passes Twitch's response back untouched, including the `Ratelimit-*` headers.

The Client App (`port`) is an unauthenticated passthrough that only adds `Client-Id`, for app-token or public requests.

### Getting a token

`GET /gate/access_token` returns a token for apps that need to call Twitch directly:

```json
{ "access_token": "…", "id": "12345", "login": "mychannel", "scopes": ["…"], "expires_at": "2026-01-01T00:00:00.000Z", "needs_reauth": false, "last_updated": "…" }
```

Add `?verify=yes` to have the gate validate it with Twitch first. Cache it until `expires_at` rather than fetching it on every call.

### Channels and health

- `GET /gate/channels` lists the authorised channels, their scopes and token status (without tokens).
- `GET /gate/health` returns the number of channels and any that need re-authorisation. It needs no API key, for use by monitoring.

### IRC/WS

Connect to `/chat` with a WS client, passing the channel and API key as above.

Gate will send a `{"type":"connect", "channel_id": "....."}` JSON payload before it connects to Twitch.

Gate will send a `{"type":"handover"}` JSON payload when it has sent IRC credentials to Twitch. After this, continue as normal with the IRC/WS protocol. Anything you send before handover is held and delivered after login.

### EventSub (replaces PubSub)

Twitch shut down PubSub in April 2025, so `/pubsub` now closes immediately with an explanation.

Use EventSub instead: connect directly to `wss://eventsub.wss.twitch.tv/ws`, take the `session_id` from the welcome message, then create subscriptions through the gate with `POST /helix/eventsub/subscriptions` and `"transport": {"method": "websocket", "session_id": "…"}`. The gate signs the request with the channel's token.
