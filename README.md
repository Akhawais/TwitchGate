# TwitchGate

TwitchGate is a REST proxy to the Twitch APIs. It can authenticate and proxy requests for either Kraken or Helix.

This is useful if you create and maintain a lot of apps for a single user/channel and need a central place to manage an OAuth token so you don't have to set up code and a Twitch app for every application you make.

This is designed to be ran in a local network that is not accessible to the Internet. If your apps are hosted on separate servers, consider setting up a VPN between them to continue using this gate.

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

## Starting the app

Run `node index`

The app will be hosted at your specified `host` and `port` in the config. The OAuth app will be hosted at `port` + 1.
