# TwitchGate

TwitchGate is a proxy to the Twitch services. It can authenticate and proxy requests for Kraken (v5) or Helix (New Twitch API). It also proxies Twitch WS connections with authentication silently handled, including PubSub and IRC/WS.

This is useful if you create and maintain a lot of apps for a single user/channel and need a central place to manage an OAuth token so you don't have to set up code and a Twitch app for every application you make.

This is designed to be ran in a local network that is not accessible to the Internet. If your apps are hosted on separate servers, consider setting up a VPN between them to use this gate.

## Getting started

Clone this repository and run `yarn` or `npm install` to install the necessary dependencies.

## Configuration
Rename `config.example.json` to `config.json` and then add the following fields:

- Your Twitch App's Client ID
- Your Twitch App's Client Secret
- Leave `access_token` and `refresh_token` blank
- The Redirect URI for the app which is the domain and port followed by `/gate/auth/return`
- `state_code` : A long random string to prevent other people authorising onto your gate accidentally (OPTIONAL - Leave empty to disable)
- Scopes, try and make this as broad as you need for all your apps, but not too much.

## Starting the proxy

Run `node index`

The app will be hosted at your specified `host` and `port` in the config. The OAuth app will be hosted at `port` + 1.

## Setup

Whilst logged in with the channel/user you wish to add to TwitchGate, head to `/gate/auth` (including the `state` as a query param if you have set this in the config).

Authorise on the Twitch OAuth screen, and you'll be redirected back to the gate which should show a success message.

Repeat with as many channels/users as you need.

## Usage

### REST APIs

Replace `https://api.twitch.tv` with your Twitch Gate URL. That's it!

e.g. `https://api.twitch.tv/helix/streams` => `http://gate.local:2571/helix/streams`

You must specify the Twitch user you wish to authenticate as by including a Basic Authorization header with the request, with the Twitch ID as the basic auth `username`.

If omitted, Gate will authenticate as the first Twitch user added during Setup.

### IRC/WS

Connect to `/chat` with a WS client. Like the REST APIs, pass the Twitch ID of the user you want to connect as in the `username` of a Basic Authorization header with the connection request.

Gate will send a `{"type":"connect", "channel_id": "....."}` JSON payload before it connects to Twitch.

Gate will send a `{"type":"handover"}` JSON payload when it has sent IRC credentials to Twitch. After this, continue as normal with the IRC/WS protocol.

### PubSub

Connect to `/pubsub` with a WS client. Gate will send a `{"type":"connect", "channel_id": "....."}` JSON payload before it connects to PubSub.

Gate will send a `{"type":"handover"}` JSON payload when it has connected to PubSub. After this, continue as normal with the PubSub protocol.

When subscribing to privileged topics, an `auth_token` field is required as per the PubSub protocol.

By entering `!CHANNEL_TOKEN.000000!` in this field, where 000000 is the Twitch ID of the channel you want to authenticate as, TwitchGate will replace this with a valid token for that channel.

This is different to the REST and IRC method since the Twitch PubSub endpoint is channel-agnostic.


