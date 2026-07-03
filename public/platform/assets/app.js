/* StarX platform — vanilla JS SPA. Talks only to /api/* (the datasource seam). */
(function () {
  "use strict";

  // ── Tiny helpers ───────────────────────────────────────────────────────────
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts));
    if (res.status === 401) { location.href = "/platform/login"; throw new Error("unauthorized"); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  function toast(msg, bad) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    setTimeout(function () { t.className = "toast"; }, 2400);
  }

  function table(headers, bodyRows) {
    return "<table><thead><tr>" + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + bodyRows + "</tbody></table>";
  }
  function pill(on) { return on ? '<span class="pill on">active</span>' : '<span class="pill off">off</span>'; }
  function fmtTime(t) { return esc(String(t || "").replace("T", " ").slice(0, 16)); }

  var state = { role: "", isAdmin: false, points: [], workers: [] };

  // ── Modal ────────────────────────────────────────────────────────────────────
  var modalSave = null;
  function openModal(title, html, onSave) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = html;
    $("#modal").classList.remove("hidden");
    modalSave = onSave;
    var first = $("#modal-body input, #modal-body select");
    if (first) first.focus();
  }
  function closeModal() { $("#modal").classList.add("hidden"); modalSave = null; }

  // ── Map (Leaflet) ──────────────────────────────────────────────────────────
  var map = null, markers = null;
  function ensureMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map").setView([48.4, 31.0], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  function plotVisits(list) {
    ensureMap();
    if (!map) return;
    markers.clearLayers();
    var pts = [];
    (list || []).forEach(function (v) {
      var lat = parseFloat(v.lat), lng = parseFloat(v.lng);
      if (isFinite(lat) && isFinite(lng)) {
        markers.addLayer(L.marker([lat, lng]).bindPopup(
          "<b>" + esc(v.pointName || "—") + "</b><br>" + esc(v.workerName || "") + "<br>" + fmtTime(v.timestamp)));
        pts.push([lat, lng]);
      }
    });
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
    setTimeout(function () { map.invalidateSize(); }, 120);
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  function showView(v) {
    $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.view === v); });
    $$(".view").forEach(function (s) { s.classList.add("hidden"); });
    $("#view-" + v).classList.remove("hidden");
    if (v === "dashboard") loadDashboard();
    else if (v === "points") loadPoints();
    else if (v === "workers") loadWorkers();
    else if (v === "visits") loadVisits();
    else if (v === "bot") loadBot();
    else if (v === "import") renderMapping();
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  function renderTop(sel, obj) {
    var entries = Object.keys(obj || {}).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    var el = $(sel);
    if (!entries.length) { el.innerHTML = '<div class="empty">No data yet</div>'; return; }
    el.innerHTML = entries.map(function (e) {
      return '<div class="list-row"><span>' + esc(e[0]) + '</span><span class="v">' + e[1] + "</span></div>";
    }).join("");
  }
  async function loadDashboard() {
    try {
      var s = await api("/api/stats");
      $("#s-visits").textContent  = s.totals.visits;
      $("#s-today").textContent   = s.totals.today;
      $("#s-points").textContent  = s.totals.pointsActive;
      $("#s-workers").textContent = s.totals.workersActive;
      renderTop("#top-workers", s.byWorker);
      renderTop("#top-points", s.byPoint);
      plotVisits(s.recent);
    } catch (e) { toast(e.message, true); }
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  function pointForm(p) {
    p = p || {};
    return '' +
      '<div class="field"><label>Name</label><input id="f-name" value="' + esc(p.name || "") + '"></div>' +
      '<div class="field"><label>Address</label><input id="f-address" value="' + esc(p.address || "") + '"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Latitude</label><input id="f-lat" value="' + esc(p.lat || "") + '"></div>' +
        '<div class="field"><label>Longitude</label><input id="f-lng" value="' + esc(p.lng || "") + '"></div>' +
      '</div>' +
      '<div class="field"><label>Status</label><select id="f-active">' +
        '<option value="1"' + (p.active !== false ? " selected" : "") + ">Active</option>" +
        '<option value="0"' + (p.active === false ? " selected" : "") + ">Inactive</option>" +
      "</select></div>";
  }
  function pointPayload() {
    return { name: $("#f-name").value, address: $("#f-address").value, lat: $("#f-lat").value, lng: $("#f-lng").value, active: $("#f-active").value !== "0" };
  }
  async function loadPoints() {
    var wrap = $("#points-wrap");
    try {
      var data = await api("/api/points");
      state.points = data.points;
      if (!data.points.length) { wrap.innerHTML = '<div class="empty">No points yet. Add one or import from Excel.</div>'; return; }
      var heads = ["Name", "Address", "Lat", "Lng", "Status"];
      if (state.isAdmin) heads.push("Actions");
      wrap.innerHTML = table(heads, data.points.map(function (p) {
        return "<tr><td>" + esc(p.name) + '</td><td class="muted">' + esc(p.address) + "</td><td>" + esc(p.lat) + "</td><td>" + esc(p.lng) + "</td><td>" + pill(p.active) + "</td>" +
          (state.isAdmin ? '<td><div class="tbl-actions"><button class="btn ghost sm" data-edit-point="' + p.row + '">Edit</button><button class="btn danger sm" data-del-point="' + p.row + '">Delete</button></div></td>' : "") +
          "</tr>";
      }).join(""));
    } catch (e) { wrap.innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; }
  }
  function editPoint(row) {
    var p = state.points.filter(function (x) { return x.row === row; })[0];
    if (!p) return;
    openModal("Edit point", pointForm(p), async function () {
      try { var body = pointPayload(); body.id = p.id; await api("/api/points/" + row, { method: "PUT", body: JSON.stringify(body) }); closeModal(); toast("Saved"); loadPoints(); }
      catch (e) { toast(e.message, true); }
    });
  }
  async function delPoint(row) {
    if (!confirm("Delete this point?")) return;
    try { await api("/api/points/" + row, { method: "DELETE" }); toast("Deleted"); loadPoints(); } catch (e) { toast(e.message, true); }
  }

  // ── Workers ──────────────────────────────────────────────────────────────────
  function workerForm(w) {
    w = w || {};
    return '' +
      '<div class="field"><label>Name</label><input id="f-name" value="' + esc(w.name || "") + '"></div>' +
      '<div class="field"><label>Telegram ID</label><input id="f-tid" value="' + esc(w.telegramId || "") + '" placeholder="numbers only"></div>' +
      '<div class="field"><label>Phone</label><input id="f-phone" value="' + esc(w.phone || "") + '"></div>' +
      '<div class="field"><label>Status</label><select id="f-active">' +
        '<option value="1"' + (w.active !== false ? " selected" : "") + ">Active</option>" +
        '<option value="0"' + (w.active === false ? " selected" : "") + ">Inactive</option>" +
      "</select></div>";
  }
  function workerPayload() {
    return { name: $("#f-name").value, telegramId: $("#f-tid").value, phone: $("#f-phone").value, active: $("#f-active").value !== "0" };
  }
  async function loadWorkers() {
    var wrap = $("#workers-wrap");
    try {
      var data = await api("/api/workers");
      state.workers = data.workers;
      if (!data.workers.length) { wrap.innerHTML = '<div class="empty">No workers yet. Add one or import from Excel.</div>'; return; }
      var heads = ["Name", "Telegram ID", "Phone", "Status"];
      if (state.isAdmin) heads.push("Actions");
      wrap.innerHTML = table(heads, data.workers.map(function (w) {
        return "<tr><td>" + esc(w.name) + '</td><td class="muted">' + esc(w.telegramId) + "</td><td>" + esc(w.phone) + "</td><td>" + pill(w.active) + "</td>" +
          (state.isAdmin ? '<td><div class="tbl-actions"><button class="btn ghost sm" data-edit-worker="' + w.row + '">Edit</button><button class="btn danger sm" data-del-worker="' + w.row + '">Delete</button></div></td>' : "") +
          "</tr>";
      }).join(""));
    } catch (e) { wrap.innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; }
  }
  function editWorker(row) {
    var w = state.workers.filter(function (x) { return x.row === row; })[0];
    if (!w) return;
    openModal("Edit worker", workerForm(w), async function () {
      try { await api("/api/workers/" + row, { method: "PUT", body: JSON.stringify(workerPayload()) }); closeModal(); toast("Saved"); loadWorkers(); }
      catch (e) { toast(e.message, true); }
    });
  }
  async function delWorker(row) {
    if (!confirm("Delete this worker?")) return;
    try { await api("/api/workers/" + row, { method: "DELETE" }); toast("Deleted"); loadWorkers(); } catch (e) { toast(e.message, true); }
  }

  // ── Visits ───────────────────────────────────────────────────────────────────
  function photoCell(v) {
    var n = v.photoCount || 0;
    if (!n) return '<span class="muted">—</span>';
    var html = "";
    for (var i = 0; i < n; i++) {
      var src = "/api/visits/" + encodeURIComponent(v.visitId) + "/photo/" + i;
      html += '<img class="thumb" src="' + src + '" alt="check-in photo" data-full="' + src + '" loading="lazy">';
    }
    return '<div class="thumbs">' + html + "</div>";
  }
  async function loadVisits() {
    var wrap = $("#visits-wrap");
    try {
      var data = await api("/api/visits?limit=500");
      if (!data.visits.length) { wrap.innerHTML = '<div class="empty">No check-ins yet.</div>'; return; }
      wrap.innerHTML = table(["Time", "Worker", "Point", "Location", "Photos", "Note"], data.visits.map(function (v) {
        return "<tr><td>" + fmtTime(v.timestamp) + "</td><td>" + esc(v.workerName || v.workerTelegramId) + "</td><td>" + esc(v.pointName || v.pointId) + "</td><td>" +
          (v.mapsLink ? '<a href="' + esc(v.mapsLink) + '" target="_blank" rel="noopener">map ↗</a>' : '<span class="muted">—</span>') +
          "</td><td>" + photoCell(v) + '</td><td class="muted">' + esc(v.note || "") + "</td></tr>";
      }).join(""));
    } catch (e) { wrap.innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; }
  }

  // Lightbox: click a thumbnail to view the full photo.
  function openLightbox(src) {
    var lb = $("#lightbox");
    $("#lightbox-img").src = src;
    lb.classList.remove("hidden");
  }
  function closeLightbox() { $("#lightbox").classList.add("hidden"); $("#lightbox-img").src = ""; }

  // ── Bot ──────────────────────────────────────────────────────────────────────
  function renderBot(s) {
    var on = !!(s && s.running);
    var pill = $("#bot-pill");
    pill.className = "pill " + (on ? "on" : "off");
    pill.textContent = on ? "running" : "off";
    if (on) {
      var uname = s.username ? ("@" + esc(s.username)) : "your bot";
      var link = s.username ? ' — <a href="https://t.me/' + esc(s.username) + '" target="_blank" rel="noopener">open ' + uname + " ↗</a>" : "";
      $("#bot-status").innerHTML = "Bot <b>" + uname + "</b> is live and receiving check-ins." + link;
    } else {
      $("#bot-status").textContent = "The bot is off. Paste a token below and turn it on.";
    }
    // Toggle buttons/token card (respecting admin gating handled by applyAdmin).
    $("#bot-start").classList.toggle("hidden", on || !state.isAdmin);
    $("#bot-stop").classList.toggle("hidden", !on || !state.isAdmin);
    $("#bot-token-card").classList.toggle("hidden", on || !state.isAdmin);
  }
  async function loadBot() {
    try { renderBot(await api("/api/bot/status")); }
    catch (e) { $("#bot-status").textContent = e.message; }
  }
  async function startBot() {
    var token = ($("#bot-token").value || "").trim();
    if (!token) { toast("Paste your BotFather token first.", true); return; }
    var btn = $("#bot-start"); btn.disabled = true; btn.textContent = "Starting…";
    try {
      var s = await api("/api/bot/start", { method: "POST", body: JSON.stringify({ token: token }) });
      $("#bot-token").value = "";
      toast(s.username ? ("Bot @" + s.username + " is live") : "Bot started");
      renderBot(s);
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = "Turn bot ON"; }
  }
  async function stopBot() {
    if (!confirm("Turn the bot off? Workers won't be able to check in until it's back on.")) return;
    try { renderBot(await api("/api/bot/stop", { method: "POST" })); toast("Bot stopped"); }
    catch (e) { toast(e.message, true); }
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  var POINT_FIELDS  = [{ key: "name", label: "Name" }, { key: "address", label: "Address" }, { key: "lat", label: "Latitude" }, { key: "lng", label: "Longitude" }, { key: "id", label: "ID (optional)" }];
  var WORKER_FIELDS = [{ key: "telegramId", label: "Telegram ID" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }];
  var POINT_ORDER   = ["id", "name", "address", "lat", "lng"];
  var WORKER_ORDER  = ["telegramId", "name", "phone"];
  var SYNONYMS = {
    name: ["name", "назв", "title", "point", "stop", "магаз", "клієнт", "клиент"],
    address: ["address", "addr", "адрес", "вулиц", "street", "місто", "город"],
    lat: ["lat", "широт"], lng: ["lng", "lon", "long", "довгот", "долгот"],
    id: ["id", "code", "код", "артик"], telegramId: ["telegram", "tid", "chat", "telega"],
    phone: ["phone", "tel", "моб", "тел", "номер"],
  };
  var parsed = null;

  function guessCol(key, headers) {
    var keys = SYNONYMS[key] || [key];
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || "").toLowerCase();
      for (var j = 0; j < keys.length; j++) if (h.indexOf(keys[j]) !== -1) return i;
    }
    return -1;
  }
  function fieldOptions(headers, guess) {
    var html = '<option value="-1"' + (guess === -1 ? " selected" : "") + ">— skip —</option>";
    headers.forEach(function (h, i) {
      html += '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + esc(h || ("Column " + (i + 1))) + "</option>";
    });
    return html;
  }
  function renderMapping() {
    var box = $("#imp-map"), run = $("#imp-run");
    if (!parsed) { box.innerHTML = ""; run.classList.add("hidden"); return; }
    var fields = $("#imp-target").value === "points" ? POINT_FIELDS : WORKER_FIELDS;
    box.innerHTML = '<div class="map-grid">' + fields.map(function (f) {
      return "<label>" + esc(f.label) + '</label><select data-field="' + f.key + '">' + fieldOptions(parsed.headers, guessCol(f.key, parsed.headers)) + "</select>";
    }).join("") + '</div><p class="muted">' + parsed.count + " rows ready to import.</p>";
    if (state.isAdmin) run.classList.remove("hidden");
  }
  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ── Wire up ──────────────────────────────────────────────────────────────────
  function applyAdmin() { $$(".admin-only").forEach(function (el) { el.classList.toggle("hidden", !state.isAdmin); }); }

  async function init() {
    // Tabs
    $$(".tab").forEach(function (t) { t.onclick = function () { showView(t.dataset.view); }; });

    // Modal
    $("#modal-cancel").onclick = closeModal;
    $("#modal-save").onclick = function () { if (modalSave) modalSave(); };
    $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });

    // Delegated row actions
    document.addEventListener("click", function (e) {
      var t = e.target;
      var th = t.closest(".thumb");             if (th) return openLightbox(th.dataset.full);
      var ep = t.closest("[data-edit-point]");  if (ep) return editPoint(+ep.dataset.editPoint);
      var dp = t.closest("[data-del-point]");   if (dp) return delPoint(+dp.dataset.delPoint);
      var ew = t.closest("[data-edit-worker]"); if (ew) return editWorker(+ew.dataset.editWorker);
      var dw = t.closest("[data-del-worker]");  if (dw) return delWorker(+dw.dataset.delWorker);
    });

    // Hide thumbnails that fail to load (e.g. seeded demo visits have no real photo,
    // or the bot is off). Uses capture because 'error' events don't bubble.
    document.addEventListener("error", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("thumb")) e.target.remove();
    }, true);

    // Lightbox close (click backdrop or press Esc).
    $("#lightbox").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLightbox(); });

    // Add buttons
    $("#add-point").onclick = function () {
      openModal("Add point", pointForm({}), async function () {
        try { await api("/api/points", { method: "POST", body: JSON.stringify(pointPayload()) }); closeModal(); toast("Point added"); loadPoints(); }
        catch (e) { toast(e.message, true); }
      });
    };
    $("#add-worker").onclick = function () {
      openModal("Add worker", workerForm({}), async function () {
        try { await api("/api/workers", { method: "POST", body: JSON.stringify(workerPayload()) }); closeModal(); toast("Worker added"); loadWorkers(); }
        catch (e) { toast(e.message, true); }
      });
    };
    $("#reload-visits").onclick = loadVisits;

    // Bot
    $("#bot-start").onclick = startBot;
    $("#bot-stop").onclick = stopBot;
    $("#bot-token").addEventListener("keydown", function (e) { if (e.key === "Enter") startBot(); });

    // Import
    $("#imp-target").onchange = renderMapping;
    $("#imp-file").onchange = async function (e) {
      var file = e.target.files[0];
      if (!file) return;
      try { var b64 = await fileToB64(file); parsed = await api("/api/import/parse", { method: "POST", body: JSON.stringify({ data: b64 }) }); renderMapping(); toast("Parsed " + parsed.count + " rows"); }
      catch (err) { toast(err.message, true); }
    };
    $("#imp-run").onclick = async function () {
      if (!parsed) return;
      var target = $("#imp-target").value;
      var order = target === "points" ? POINT_ORDER : WORKER_ORDER;
      var sel = {};
      $$("#imp-map select[data-field]").forEach(function (s) { sel[s.dataset.field] = parseInt(s.value, 10); });
      var rows = parsed.rows.map(function (r) {
        return order.map(function (k) { var ci = sel[k]; return (ci >= 0 && ci < r.length) ? r[ci] : ""; });
      });
      try { var res = await api("/api/import/" + target, { method: "POST", body: JSON.stringify({ rows: rows }) }); toast("Imported " + res.written + " " + target); parsed = null; $("#imp-file").value = ""; renderMapping(); }
      catch (err) { toast(err.message, true); }
    };
    $("#setup-btn").onclick = async function () {
      if (!confirm("Create the workers / points / visits tabs in your connected sheet?")) return;
      try { var res = await api("/api/setup", { method: "POST" }); toast(res.created && res.created.length ? "Created: " + res.created.join(", ") : "Sheet is ready"); }
      catch (e) { toast(e.message, true); }
    };

    // Who am I
    try {
      var me = await api("/api/me");
      $("#company").textContent = me.company || "";
      state.role = me.role; state.isAdmin = me.role === "admin";
    } catch (e) { /* api() already redirects on 401 */ }
    applyAdmin();

    loadDashboard();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/platform/assets/sw.js").catch(function () {});
  document.addEventListener("DOMContentLoaded", init);
})();
