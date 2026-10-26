// Scopes requested on /gate/auth for a fresh install. Disable any in the scopes table.
module.exports = [
  `analytics:read:extensions`,
  `analytics:read:games`,
  `bits:read`,
  `channel:bot`,
  `channel:read:ads`,
  `channel:manage:ads`,
  `channel:manage:broadcast`,
  `channel:read:charity`,
  `channel:edit:commercial`,
  `channel:read:editors`,
  `channel:manage:extensions`,
  `channel:read:goals`,
  `channel:read:guest_star`,
  `channel:manage:guest_star`,
  `channel:read:hype_train`,
  `channel:manage:moderators`,
  `channel:read:polls`,
  `channel:manage:polls`,
  `channel:read:predictions`,
  `channel:manage:predictions`,
  `channel:manage:raids`,
  `channel:read:redemptions`,
  `channel:manage:redemptions`,
  `channel:manage:schedule`,
  `channel:read:stream_key`,
  `channel:read:subscriptions`,
  `channel:manage:videos`,
  `channel:read:vips`,
  `channel:manage:vips`,
  `clips:edit`,

  `moderation:read`,
  `moderator:manage:announcements`,
  `moderator:manage:automod`,

  `moderator:read:automod_settings`,
  `moderator:manage:automod_settings`,

  `moderator:read:banned_users`,
  `moderator:manage:banned_users`,

  `moderator:read:blocked_terms`,
  `moderator:manage:blocked_terms`,

  `moderator:read:chat_messages`,
  `moderator:manage:chat_messages`,

  `moderator:read:chat_settings`,
  `moderator:manage:chat_settings`,

  `moderator:read:chatters`,
  `moderator:read:followers`,
  `moderator:read:moderators`,

  `moderator:read:guest_star`,
  `moderator:manage:guest_star`,

  `moderator:read:shield_mode`,
  `moderator:manage:shield_mode`,

  `moderator:read:shoutouts`,
  `moderator:manage:shoutouts`,

  `moderator:read:suspicious_users`,

  `moderator:read:unban_requests`,
  `moderator:manage:unban_requests`,

  `moderator:read:vips`,

  `moderator:read:warnings`,
  `moderator:manage:warnings`,

  `user:bot`,

  `user:edit`,
  `user:edit:broadcast`,

  `user:manage:blocked_users`,
  `user:read:blocked_users`,

  `user:read:broadcast`,
  `user:read:email`,
  `user:read:emotes`,
  `user:read:moderated_channels`,
  `user:read:follows`,
  `user:read:subscriptions`,
  `user:read:chat`,
  `user:manage:chat_color`,

  `channel:moderate`,
  `chat:edit`,
  `chat:read`,
  `whispers:read`,
  `whispers:edit`,
  `user:write:chat`,
  `user:read:whispers`,
  `user:manage:whispers`,
];
