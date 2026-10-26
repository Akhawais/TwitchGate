const twitch = require(`./twitch`);

const REFRESH_MARGIN = 5 * 60 * 1000; // refresh tokens this long before they expire
const VALIDATE_INTERVAL = 60 * 60 * 1000; // Twitch requires validating tokens hourly
const MAINTENANCE_INTERVAL = 60 * 1000;

class GateError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const label = channel => (channel.login ? `${channel.login} (${channel.id})` : channel.id);

class TokenManager {
  constructor(db, config) {
    this.config = config;
    this.channels = new Map();
    this.inflight = new Map();
    this.validatedAt = new Map();
    this.updateStmt = db.prepare(`UPDATE channels
      SET access_token = @access_token, refresh_token = @refresh_token, login = @login, scopes = @scopes,
          expires_at = @expires_at, needs_reauth = @needs_reauth, last_updated = @last_updated
      WHERE id = @id`);
    this.upsertStmt = db.prepare(`INSERT INTO channels (id, access_token, refresh_token, login, scopes, expires_at, needs_reauth, last_updated)
      VALUES (@id, @access_token, @refresh_token, @login, @scopes, @expires_at, @needs_reauth, @last_updated)
      ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
          login = excluded.login, scopes = excluded.scopes, expires_at = excluded.expires_at,
          needs_reauth = excluded.needs_reauth, last_updated = excluded.last_updated`);

    // rowid order keeps "the first channel added" as the default
    for (const row of db.prepare(`SELECT * FROM channels ORDER BY rowid`).all()) {
      this.channels.set(row.id, row);
    }
  }

  list() {
    return [...this.channels.values()];
  }

  // Find a channel by Twitch ID or login; with no name, the first channel added
  resolve(name) {
    if (this.channels.size === 0) throw new GateError(501, `Initial authorisation required.`);

    let channel = this.list()[0];
    if (name) {
      const lower = name.toLowerCase();
      channel = this.channels.get(name) || this.list().find(c => c.login && c.login.toLowerCase() === lower);
    }
    if (!channel) throw new GateError(501, `Initial authorisation required.`);
    if (channel.needs_reauth) throw new GateError(501, `Re-authorisation required.`);
    return channel;
  }

  save(channel) {
    channel.last_updated = Date.now();
    this.updateStmt.run({
      id: channel.id,
      access_token: channel.access_token,
      refresh_token: channel.refresh_token,
      login: channel.login,
      scopes: channel.scopes,
      expires_at: channel.expires_at,
      needs_reauth: channel.needs_reauth ? 1 : 0,
      last_updated: channel.last_updated,
    });
  }

  // Concurrent callers share a single refresh per channel. Pass the token that failed:
  // if another request has already replaced it, the new token is returned without refreshing again.
  refresh(id, staleToken) {
    const channel = this.channels.get(id);
    if (staleToken && channel.access_token !== staleToken) return Promise.resolve(channel);
    if (!this.inflight.has(id)) {
      this.inflight.set(id, this.doRefresh(channel).finally(() => this.inflight.delete(id)));
    }
    return this.inflight.get(id);
  }

  async doRefresh(channel) {
    let data;
    try {
      data = await twitch.refreshToken(this.config, channel.refresh_token);
    } catch (err) {
      if (err.response && (err.response.status === 400 || err.response.status === 401)) {
        channel.needs_reauth = 1;
        this.save(channel);
        console.error(`Refresh token for ${label(channel)} was rejected (${twitch.describeError(err)}). Re-authorise via /gate/auth.`);
        throw new GateError(501, `Re-authorisation required.`);
      }
      console.error(`Could not refresh token for ${label(channel)}: ${twitch.describeError(err)}`);
      throw new GateError(502, `Could not reach Twitch to refresh the token.`);
    }

    channel.access_token = data.access_token;
    channel.refresh_token = data.refresh_token || channel.refresh_token;
    channel.expires_at = Date.now() + (data.expires_in * 1000);
    if (Array.isArray(data.scope)) channel.scopes = JSON.stringify(data.scope);
    this.save(channel);
    this.validatedAt.set(channel.id, Date.now());

    // Refresh responses don't include the login, which channels imported from 2.0.0 lack
    if (!channel.login) {
      try {
        this.applyValidation(channel, await twitch.validateToken(channel.access_token));
      } catch (err) {
        // Best effort; the hourly validation will fill it in
      }
    }
    console.log(`Refreshed token for ${label(channel)}.`);
    return channel;
  }

  applyValidation(channel, info) {
    channel.login = info.login;
    channel.scopes = JSON.stringify(info.scopes || []);
    channel.expires_at = Date.now() + (info.expires_in * 1000);
    this.save(channel);
    this.validatedAt.set(channel.id, Date.now());
  }

  // Check the token with Twitch, refreshing it if it has been revoked or has expired
  async validate(id) {
    const channel = this.channels.get(id);
    try {
      this.applyValidation(channel, await twitch.validateToken(channel.access_token));
      return channel;
    } catch (err) {
      if (!err.response || err.response.status !== 401) {
        console.error(`Could not validate token for ${label(channel)}: ${twitch.describeError(err)}`);
        throw new GateError(502, `Could not reach Twitch to validate the token.`);
      }
    }
    await this.refresh(id, channel.access_token);
    return channel;
  }

  // Refresh ahead of expiry so callers are never handed a token that is about to die
  async usable(channel) {
    if (channel.expires_at && channel.expires_at - Date.now() < REFRESH_MARGIN) {
      return this.refresh(channel.id, channel.access_token);
    }
    return channel;
  }

  async addFromAuthorisation(tokenData) {
    const info = await twitch.validateToken(tokenData.access_token);
    const channel = {
      id: info.user_id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      login: info.login,
      scopes: JSON.stringify(info.scopes || []),
      expires_at: Date.now() + (info.expires_in * 1000),
      needs_reauth: 0,
      last_updated: Date.now(),
    };
    this.upsertStmt.run(channel);
    if (this.channels.has(channel.id)) {
      Object.assign(this.channels.get(channel.id), channel);
    } else {
      this.channels.set(channel.id, channel);
    }
    this.validatedAt.set(channel.id, Date.now());
    return this.channels.get(channel.id);
  }

  startMaintenance() {
    const maintain = async (channel) => {
      const lastValidated = this.validatedAt.get(channel.id) || 0;
      try {
        if (channel.expires_at && channel.expires_at - Date.now() < REFRESH_MARGIN) {
          await this.refresh(channel.id, channel.access_token);
        } else if (Date.now() - lastValidated > VALIDATE_INTERVAL) {
          await this.validate(channel.id);
        }
      } catch (err) {
        // Already logged; the next tick or request will try again
      }
    };
    const tick = () => Promise.all(this.list().filter(channel => !channel.needs_reauth).map(maintain));
    tick();
    this.timer = setInterval(tick, MAINTENANCE_INTERVAL);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }
}

// Public view of a channel, without its tokens
const describeChannel = channel => ({
  id: channel.id,
  login: channel.login || null,
  scopes: channel.scopes ? JSON.parse(channel.scopes) : null,
  expires_at: channel.expires_at ? new Date(channel.expires_at).toISOString() : null,
  needs_reauth: Boolean(channel.needs_reauth),
  last_updated: channel.last_updated ? new Date(channel.last_updated).toISOString() : null,
});

module.exports = { TokenManager, GateError, describeChannel };
