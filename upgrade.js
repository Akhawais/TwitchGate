const axios = require(`axios`);
const fs = require(`fs`);
let config = require(`./config/config.json`);

const saveConfig = () => {
  fs.writeFile(`./config/config.json`, JSON.stringify(config, null, 4), (err) => {
    if (err) console.error(err);
    console.log(`Saved!`);
  });
};

const checkAndSetToken = async () => {
  if (config.access_token === ``) {
    return `reauth`;
  }

  try {
    let response = await axios.post(`https://id.twitch.tv/oauth2/token`, null, {
      params: {
        grant_type: `refresh_token`,
        client_id: config.client_id,
        client_secret: config.client_secret,
        refresh_token: config.refresh_token,
      },
    });
    config.access_token = response.data.access_token;
    config.refresh_token = response.data.refresh_token;
    saveConfig();
    return `ok`;
  } catch (err) {
    console.error(err);
    return `reauth`;
  }
};

// Upgrade from 0.0.2

if (typeof config.access_token === `string`) {
  axios({
    method: `GET`,
    url: `https://api.twitch.tv/kraken/user`,
    headers: {
      Authorization: `OAuth ${config.access_token}`,
      'Client-ID': config.client_id,
    },
  }).then((response) => {
    let channelID = response.data._id;
    let accessToken = config.access_token;
    let refreshToken = config.refresh_token;
    config.access_token = {};
    config.refresh_token = {};
    config.access_token[channelID] = accessToken;
    config.refresh_token[channelID] = refreshToken;
    saveConfig();
  }).catch(async (err) => {
    console.log(err.response.headers);
    console.log(err.response.data);
    if (err.response.status === 401 && ((err.response.headers[`www-authenticate`] !== undefined && err.response.headers[`www-authenticate`].includes(`invalid_token`)) || err.response.data.message.includes(`oauth token`))) {
      let check = await checkAndSetToken();
      if (check === `reauth`) {
        throw new Error(`Re-authorisation required for new channel.`);
      }
      throw new Error(`Token updated. Please restart app to finish upgrade.`);
    }
  });
}
