// Bot manager — start/stop/inspect the Telegram bot AT RUNTIME, from the web app.
//
// This is what makes "create the bot from the platform" work: the admin pastes a
// BotFather token in the Bot tab, and this module spins up a live bot in the SAME
// process as the web server. No terminal, no env var, no restart. Stopping it kills
// polling cleanly so a new token can be started.
//
// The token lives only in memory (matching the in-memory MVP store): it is lost on
// restart. Set TELEGRAM_TOKEN in env if you want the bot to auto-start on boot.
const TelegramBot = require("node-telegram-bot-api");
const { attachHandlers } = require("./handlers");

let _bot = null;        // the live TelegramBot instance (or null when off)
let _username = "";     // @username of the running bot (from getMe)
let _startedAt = null;  // ISO timestamp of when polling started

function status() {
  return { running: !!_bot, username: _username, startedAt: _startedAt };
}

// Resolve a Telegram file_id to a direct download URL. The URL embeds the bot token,
// so callers MUST fetch it server-side and proxy the bytes — never hand it to the
// browser. Throws { code: "bot_off" } if the bot isn't running.
async function fileLink(fileId) {
  if (!_bot) { const e = new Error("bot_off"); e.code = "bot_off"; throw e; }
  return _bot.getFileLink(fileId);
}

// Validate a token and start polling. Rejects a bad token with a clear error BEFORE
// committing, so the UI can show "invalid token" instead of a silent failure.
async function start(token) {
  token = String(token || "").trim();
  if (!token) { const e = new Error("no_token"); e.code = "no_token"; throw e; }

  // Replace any bot that's already running.
  if (_bot) await stop();

  // polling:false so we can call getMe() to validate first, then start polling.
  const bot = new TelegramBot(token, { polling: false });
  let me;
  try {
    me = await bot.getMe();
  } catch (err) {
    const e = new Error("invalid_token");
    e.code = "invalid_token";
    throw e;
  }

  attachHandlers(bot);
  await bot.startPolling();

  _bot = bot;
  _username = me.username || "";
  _startedAt = new Date().toISOString();
  console.log(`🤖 StarX bot started (@${_username}).`);
  return status();
}

// Stop polling and forget the instance. Safe to call when already stopped.
async function stop() {
  if (!_bot) return status();
  try { await _bot.stopPolling({ cancel: true }); } catch (_e) { /* best effort */ }
  _bot = null;
  _username = "";
  _startedAt = null;
  console.log("🛑 StarX bot stopped.");
  return status();
}

module.exports = { start, stop, status, fileLink };
