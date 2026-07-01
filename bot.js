// StarX worker bot — the field check-in app.
//
// Flow:  /route  → tap a stop  → send location  → send photos → "✅ Done"
//        → a Visit row is written to the tenant's sheet (the platform shows it live).
//
// The web platform is started from here too (one process, one Railway service), so the
// bot and the dashboard always share the same datasource. If TELEGRAM_TOKEN is unset
// the platform still runs — only the bot is off.
const TelegramBot = require("node-telegram-bot-api");
const config = require("./src/server/config");
const { forTenant } = require("./src/server/datasource");
const { startServer } = require("./src/server");

// Always bring up the web platform.
startServer();

const TOKEN = process.env.TELEGRAM_TOKEN || "";
if (!TOKEN) {
  console.log("⚠️  TELEGRAM_TOKEN not set — web platform is up, but the check-in bot is OFF.");
} else {
  startBot();
}

function startBot() {
  const bot = new TelegramBot(TOKEN, { polling: true });

  // Single-tenant MVP: the bot serves the default tenant's data.
  function source() { return forTenant(config.defaultTenant()); }

  // ── In-memory per-user state ─────────────────────────────────────────────
  const states = new Map();
  const getState   = id => states.get(id) || { step: "idle" };
  const setState   = (id, s) => states.set(id, { ...getState(id), ...s });
  const clearState = id => states.delete(id);

  // ── Keyboards ────────────────────────────────────────────────────────────
  const locationKb = { keyboard: [[{ text: "📍 Send location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true };
  const doneKb      = { keyboard: [[{ text: "✅ Done" }], [{ text: "❌ Cancel" }]], resize_keyboard: true };
  const removeKb    = { remove_keyboard: true };

  async function findWorker(telegramId) {
    const workers = await source().listWorkers();
    return workers.find(w => String(w.telegramId) === String(telegramId) && w.active) || null;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/([_*\[\]()`])/g, "\\$1"); }

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/start/, async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    try {
      const worker = await findWorker(userId);
      if (!worker) {
        return bot.sendMessage(msg.chat.id,
          `👋 Welcome to *StarX*.\n\nYou're not registered yet. Ask your manager to add this Telegram ID as a worker:\n\n\`${userId}\``,
          { parse_mode: "Markdown" });
      }
      bot.sendMessage(msg.chat.id,
        `👋 Hi *${esc(worker.name || "there")}*!\n\nTap /route to see your stops and start checking in.`,
        { parse_mode: "Markdown" });
    } catch (e) {
      bot.sendMessage(msg.chat.id, "⚠️ Could not reach the database. Try again shortly.");
      console.error("/start error:", e.message);
    }
  });

  // ── /route — list active points as buttons ──────────────────────────────────
  bot.onText(/^\/route/, async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    try {
      const worker = await findWorker(userId);
      if (!worker) return bot.sendMessage(msg.chat.id, `You're not registered. Your Telegram ID: \`${userId}\``, { parse_mode: "Markdown" });

      const points = (await source().listPoints()).filter(p => p.active);
      if (!points.length) return bot.sendMessage(msg.chat.id, "No stops to visit yet. Your manager hasn't added any points.");

      setState(userId, { worker, routeMap: points });
      const buttons = points.slice(0, 40).map((p, i) => [{ text: `📍 ${p.name || p.address || p.id}`, callback_data: `ci:${i}` }]);
      bot.sendMessage(msg.chat.id, "🗺 *Your stops* — tap one to check in:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, "⚠️ Could not load your route. Try again shortly.");
      console.error("/route error:", e.message);
    }
  });

  // ── Tap a stop → ask for location ────────────────────────────────────────────
  bot.on("callback_query", async (q) => {
    const [action, idx] = (q.data || "").split(":");
    if (action !== "ci") return bot.answerCallbackQuery(q.id).catch(() => {});
    const userId = q.from.id;
    const st = getState(userId);
    const point = (st.routeMap || [])[parseInt(idx, 10)];
    if (!point) {
      await bot.answerCallbackQuery(q.id, { text: "Tap /route again.", show_alert: true }).catch(() => {});
      return;
    }
    setState(userId, { step: "waiting_location", pointId: point.id, pointName: point.name || point.address || point.id, photos: [] });
    await bot.answerCallbackQuery(q.id).catch(() => {});
    bot.sendMessage(q.message.chat.id,
      `📍 Checking in at *${esc(point.name || point.address || point.id)}*.\n\n*Step 1 of 2* — send your location:`,
      { parse_mode: "Markdown", reply_markup: locationKb });
  });

  // ── Location ─────────────────────────────────────────────────────────────────
  bot.on("location", (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_location") return;
    const { latitude, longitude } = msg.location;
    setState(userId, {
      step: "waiting_photos",
      lat: latitude, lng: longitude,
      mapsLink: `https://www.google.com/maps?q=${latitude},${longitude}`,
      photos: [],
    });
    bot.sendMessage(msg.chat.id,
      "✅ Location received.\n\n📸 *Step 2 of 2* — send one or more photos, then tap *✅ Done*.\n(You can tap *✅ Done* with no photo if none is needed.)",
      { parse_mode: "Markdown", reply_markup: doneKb });
  });

  // ── Photos ───────────────────────────────────────────────────────────────────
  bot.on("photo", (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_photos") return;
    const photos = st.photos || [];
    photos.push(msg.photo[msg.photo.length - 1].file_id);
    setState(userId, { photos });
    bot.sendMessage(msg.chat.id, `📸 Photo ${photos.length} received. Send more or tap *✅ Done*.`, { parse_mode: "Markdown", reply_markup: doneKb });
  });

  // ── Done / Cancel (plain text from the reply keyboard) ───────────────────────
  bot.on("message", async (msg) => {
    if (msg.chat.type !== "private") return;
    if (msg.location || msg.photo) return;
    const text = (msg.text || "").trim();
    if (text.startsWith("/")) return; // commands handled by onText
    const userId = msg.from.id;
    const st = getState(userId);

    if (text === "❌ Cancel") {
      clearState(userId);
      return bot.sendMessage(msg.chat.id, "Cancelled.", { reply_markup: removeKb });
    }

    if (text === "✅ Done") {
      if (st.step !== "waiting_photos") return bot.sendMessage(msg.chat.id, "Nothing to finish. Tap /route to start.", { reply_markup: removeKb });
      try {
        const worker = st.worker || await findWorker(userId);
        const visitId = await source().addVisit({
          timestamp: new Date().toISOString(),
          workerTelegramId: String(userId),
          workerName: worker ? worker.name : "",
          pointId: st.pointId, pointName: st.pointName,
          lat: st.lat, lng: st.lng, mapsLink: st.mapsLink,
          photoCount: (st.photos || []).length,
          photoFileIds: st.photos || [],
          note: "",
        });
        clearState(userId);
        bot.sendMessage(msg.chat.id,
          `✅ *Check-in saved* at *${esc(st.pointName)}*.\n📸 Photos: ${(st.photos || []).length}\n🆔 ${esc(visitId)}\n\nTap /route for the next stop.`,
          { parse_mode: "Markdown", reply_markup: removeKb });
      } catch (e) {
        console.error("finalize error:", e.message);
        bot.sendMessage(msg.chat.id, "⚠️ Could not save the check-in. Try *✅ Done* again.", { parse_mode: "Markdown", reply_markup: doneKb });
      }
    }
  });

  bot.setMyCommands([
    { command: "start", description: "Start / register" },
    { command: "route", description: "Show my stops and check in" },
  ]).catch(() => {});

  bot.on("polling_error", (e) => console.error("polling_error:", e.message));
  console.log("🤖 StarX check-in bot is running...");
}
