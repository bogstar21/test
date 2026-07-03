// StarX entry point.
//
// Boots the web platform. The Telegram bot can be started two ways:
//   1. From the web app's "Bot" tab (paste a BotFather token → Encender).   ← main path
//   2. Automatically on boot, if TELEGRAM_TOKEN is set in the environment.
//
// Both share ONE process and ONE datasource, so a check-in from the bot shows up
// instantly in the platform's stats. `npm start` and `npm run bot` are now equivalent
// — the server owns the bot lifecycle via src/server/bot/manager.js.
const { startServer } = require("./src/server");

startServer();
