// Shared Google Sheets client (service account, read-write).
// Used by BOTH the Telegram bot (bot.js) and the platform server (src/server/*),
// so it lives in one place. Credentials are read lazily on first use, so simply
// requiring this module never throws — handy for tests that don't touch Sheets.
const { google } = require("googleapis");

let _cached = null;

function getSheetsClient() {
  if (_cached) return _cached;
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _cached = google.sheets({ version: "v4", auth });
  return _cached;
}

module.exports = { getSheetsClient };
