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
    setTimeout(function () { t.className = "toast"; }, 2600);
  }

  function tableWrap(headers, bodyRows, stack) {
    var cls = "table" + (stack ? " stack" : "");
    return '<div class="table-wrap' + (stack ? " stack-wrap" : "") + '"><table class="' + cls + '"><thead><tr>' +
      headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + bodyRows + "</tbody></table></div>";
  }
  function statusPill(on) { return on ? '<span class="pill on">activo</span>' : '<span class="pill off">inactivo</span>'; }
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
    map = L.map("map").setView([40.4, -3.7], 5);
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
    $$(".nav").forEach(function (t) { t.classList.toggle("active", t.dataset.view === v); });
    $$(".view").forEach(function (s) { s.classList.remove("active"); });
    var el = $("#view-" + v);
    if (el) el.classList.add("active");
    document.body.classList.remove("nav-open"); // close mobile drawer on navigation
    if (v === "dashboard") loadDashboard();
    else if (v === "points") loadPoints();
    else if (v === "workers") loadWorkers();
    else if (v === "visits") loadVisits();
    else if (v === "bot") loadBot();
    else if (v === "import") { renderMapping(); loadSettings(); }
    else if (v === "checkin") loadCheckin();
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  function renderBarlist(sel, obj) {
    var entries = Object.keys(obj || {}).map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    var el = $(sel);
    if (!entries.length) { el.innerHTML = '<div class="empty">Sin datos aún</div>'; return; }
    var max = entries[0][1] || 1;
    el.innerHTML = entries.map(function (e) {
      var pct = Math.max(4, Math.round((e[1] / max) * 100));
      return '<div class="bl-row"><span class="bl-name">' + esc(e[0]) + '</span>' +
        '<span class="bl-track"><span class="bl-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bl-val">' + e[1] + "</span></div>";
    }).join("");
  }

  // Build a small SVG line/area chart of visits per day from the recent list.
  function renderVisitsChart(recent) {
    var box = $("#chart-visits");
    var days = 14, buckets = {}, labels = [];
    var now = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now); d.setDate(now.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
      labels.push({ key: key, short: String(d.getDate()) });
    }
    var any = false;
    (recent || []).forEach(function (v) {
      var key = String(v.timestamp || "").slice(0, 10);
      if (key in buckets) { buckets[key]++; any = true; }
    });
    if (!any) { box.innerHTML = '<div class="empty">Sin visitas en los últimos ' + days + ' días</div>'; return; }

    var W = 720, H = 200, padL = 28, padR = 8, padT = 12, padB = 22;
    var vals = labels.map(function (l) { return buckets[l.key]; });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var iw = W - padL - padR, ih = H - padT - padB;
    var x = function (i) { return padL + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * iw); };
    var y = function (val) { return padT + ih - (val / maxV) * ih; };

    var gridLines = "", ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var gy = padT + (g / ticks) * ih;
      gridLines += '<line class="grid-line" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
    }
    var linePts = vals.map(function (val, i) { return x(i) + "," + y(val); }).join(" ");
    var areaPts = padL + "," + (padT + ih) + " " + linePts + " " + (W - padR) + "," + (padT + ih);
    var dots = vals.map(function (val, i) { return '<circle cx="' + x(i) + '" cy="' + y(val) + '" r="3" fill="#6366f1"/>'; }).join("");
    var xlabels = labels.map(function (l, i) {
      if (i % 2 !== 0 && i !== labels.length - 1) return "";
      return '<text class="axis-lbl" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l.short) + "</text>";
    }).join("");
    var ylabels = "";
    for (var t = 0; t <= ticks; t++) {
      var val = Math.round((maxV / ticks) * (ticks - t));
      ylabels += '<text class="axis-lbl" x="' + (padL - 6) + '" y="' + (padT + (t / ticks) * ih + 3) + '" text-anchor="end">' + val + "</text>";
    }

    box.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img">' +
      '<defs><linearGradient id="carea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#6366f1" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>' +
      gridLines + ylabels +
      '<polygon points="' + areaPts + '" fill="url(#carea)"/>' +
      '<polyline points="' + linePts + '" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + xlabels + "</svg>";
  }

  async function loadDashboard() {
    try {
      var s = await api("/api/stats");
      $("#s-visits").textContent  = s.totals.visits;
      $("#s-today").textContent   = s.totals.today;
      $("#s-points").textContent  = s.totals.pointsActive;
      $("#s-workers").textContent = s.totals.workersActive;
      renderBarlist("#top-workers", s.byWorker);
      renderBarlist("#top-points", s.byPoint);
      renderVisitsChart(s.recent);
      plotVisits(s.recent);
    } catch (e) { toast(e.message, true); }
    refreshBotBadge();
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  function pointForm(p) {
    p = p || {};
    return '' +
      '<div class="field"><label>Nombre</label><input id="f-name" value="' + esc(p.name || "") + '"></div>' +
      '<div class="field"><label>Dirección</label><input id="f-address" value="' + esc(p.address || "") + '"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Latitud</label><input id="f-lat" value="' + esc(p.lat || "") + '"></div>' +
        '<div class="field"><label>Longitud</label><input id="f-lng" value="' + esc(p.lng || "") + '"></div>' +
      '</div>' +
      '<div class="field"><label>Estado</label><select id="f-active">' +
        '<option value="1"' + (p.active !== false ? " selected" : "") + ">Activo</option>" +
        '<option value="0"' + (p.active === false ? " selected" : "") + ">Inactivo</option>" +
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
      if (!data.points.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay puntos. Añade uno o importa desde Excel.</div></div>'; return; }
      var heads = ["Nombre", "Dirección", "Geo", "Lat", "Lng", "Estado"];
      if (state.isAdmin) heads.push("Acciones");
      wrap.innerHTML = tableWrap(heads, data.points.map(function (p) {
        var geo = p.geolocated
          ? '<span class="pill on">sí</span>'
          : '<span class="pill off">pendiente</span>';
        return '<tr><td data-label="Nombre">' + esc(p.name) + '</td><td data-label="Dirección" class="muted">' + esc(p.address) + '</td><td data-label="Geo">' + geo + '</td><td data-label="Lat" class="mono">' + esc(p.lat) + '</td><td data-label="Lng" class="mono">' + esc(p.lng) + '</td><td data-label="Estado">' + statusPill(p.active) + "</td>" +
          (state.isAdmin ? '<td data-label="Acciones"><div class="tbl-actions"><button class="btn ghost sm" data-edit-point="' + p.row + '">Editar</button><button class="btn danger sm" data-del-point="' + p.row + '">Borrar</button></div></td>' : "") +
          "</tr>";
      }).join(""), true);
    } catch (e) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }
  function editPoint(row) {
    var p = state.points.filter(function (x) { return x.row === row; })[0];
    if (!p) return;
    openModal("Editar punto", pointForm(p), async function () {
      try { var body = pointPayload(); body.id = p.id; await api("/api/points/" + row, { method: "PUT", body: JSON.stringify(body) }); closeModal(); toast("Guardado"); loadPoints(); }
      catch (e) { toast(e.message, true); }
    });
  }
  async function delPoint(row) {
    if (!confirm("¿Borrar este punto?")) return;
    try { await api("/api/points/" + row, { method: "DELETE" }); toast("Borrado"); loadPoints(); } catch (e) { toast(e.message, true); }
  }

  // ── Workers ──────────────────────────────────────────────────────────────────
  function workerForm(w) {
    w = w || {};
    return '' +
      '<div class="field"><label>Nombre</label><input id="f-name" value="' + esc(w.name || "") + '"></div>' +
      '<div class="field"><label>ID de Telegram</label><input id="f-tid" value="' + esc(w.telegramId || "") + '" placeholder="solo números"></div>' +
      '<div class="field"><label>Teléfono</label><input id="f-phone" value="' + esc(w.phone || "") + '"></div>' +
      '<div class="field"><label>Estado</label><select id="f-active">' +
        '<option value="1"' + (w.active !== false ? " selected" : "") + ">Activo</option>" +
        '<option value="0"' + (w.active === false ? " selected" : "") + ">Inactivo</option>" +
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
      if (!data.workers.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay trabajadores. Añade uno o importa desde Excel.</div></div>'; return; }
      var heads = ["Nombre", "ID de Telegram", "Teléfono", "Estado"];
      if (state.isAdmin) heads.push("Acciones");
      wrap.innerHTML = tableWrap(heads, data.workers.map(function (w) {
        return '<tr><td data-label="Nombre">' + esc(w.name) + '</td><td data-label="ID de Telegram" class="mono">' + esc(w.telegramId) + '</td><td data-label="Teléfono">' + esc(w.phone) + '</td><td data-label="Estado">' + statusPill(w.active) + "</td>" +
          (state.isAdmin ? '<td data-label="Acciones"><div class="tbl-actions"><button class="btn ghost sm" data-edit-worker="' + w.row + '">Editar</button><button class="btn danger sm" data-del-worker="' + w.row + '">Borrar</button></div></td>' : "") +
          "</tr>";
      }).join(""), true);
    } catch (e) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }
  function editWorker(row) {
    var w = state.workers.filter(function (x) { return x.row === row; })[0];
    if (!w) return;
    openModal("Editar trabajador", workerForm(w), async function () {
      try { await api("/api/workers/" + row, { method: "PUT", body: JSON.stringify(workerPayload()) }); closeModal(); toast("Guardado"); loadWorkers(); }
      catch (e) { toast(e.message, true); }
    });
  }
  async function delWorker(row) {
    if (!confirm("¿Borrar este trabajador?")) return;
    try { await api("/api/workers/" + row, { method: "DELETE" }); toast("Borrado"); loadWorkers(); } catch (e) { toast(e.message, true); }
  }

  // ── Visits ───────────────────────────────────────────────────────────────────
  function photoCell(v) {
    var n = v.photoCount || 0;
    if (!n) return '<span class="muted">—</span>';
    var html = "";
    for (var i = 0; i < n; i++) {
      var src = "/api/visits/" + encodeURIComponent(v.visitId) + "/photo/" + i;
      html += '<img class="thumb" src="' + src + '" alt="foto de check-in" data-full="' + src + '" loading="lazy">';
    }
    return '<div class="thumbs">' + html + "</div>";
  }
  async function loadVisits() {
    var wrap = $("#visits-wrap");
    try {
      var data = await api("/api/visits?limit=500");
      if (!data.visits.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay check-ins.</div></div>'; return; }
      wrap.innerHTML = tableWrap(["Hora", "Trabajador", "Punto", "Ubicación", "Fotos", "Nota"], data.visits.map(function (v) {
        return '<tr><td data-label="Hora">' + fmtTime(v.timestamp) + '</td><td data-label="Trabajador">' + esc(v.workerName || v.workerTelegramId) + '</td><td data-label="Punto">' + esc(v.pointName || v.pointId) + '</td><td data-label="Ubicación">' +
          (v.mapsLink ? '<a href="' + esc(v.mapsLink) + '" target="_blank" rel="noopener">mapa ↗</a>' : '<span class="muted">—</span>') +
          '</td><td data-label="Fotos">' + photoCell(v) + '</td><td data-label="Nota" class="muted">' + esc(v.note || "") + "</td></tr>";
      }).join(""), true);
    } catch (e) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }

  // Lightbox: click a thumbnail to view the full photo.
  function openLightbox(src) { $("#lightbox-img").src = src; $("#lightbox").classList.remove("hidden"); }
  function closeLightbox() { $("#lightbox").classList.add("hidden"); $("#lightbox-img").src = ""; }

  // ── Bot ──────────────────────────────────────────────────────────────────────
  function setBadge(on) {
    var b = $("#bot-badge");
    b.className = "badge" + (on ? " ok" : "");
    b.innerHTML = '<span class="dot ' + (on ? "dot-ok" : "dot-muted") + '"></span> Bot ' + (on ? "en línea" : "apagado");
    var st = $("#st-bot");
    if (st) st.innerHTML = '<span class="dot ' + (on ? "dot-ok" : "dot-muted") + '"></span> ' + (on ? "En línea" : "Apagado");
  }
  async function refreshBotBadge() {
    try { setBadge(!!(await api("/api/bot/status")).running); } catch (e) { /* ignore */ }
  }
  function renderBot(s) {
    var on = !!(s && s.running);
    var configured = !(s && s.configured === false); // undefined (start/stop responses) → assume ok
    var pill = $("#bot-pill");
    pill.className = "pill " + (on ? "on" : "off");
    pill.textContent = on ? "en línea" : "apagado";
    if (on) {
      var uname = s.username ? ("@" + esc(s.username)) : "el bot";
      var link = s.username ? ' — <a href="https://t.me/' + esc(s.username) + '" target="_blank" rel="noopener">abrir ' + uname + " ↗</a>" : "";
      $("#bot-status").innerHTML = "El bot <b>" + uname + "</b> está en línea recibiendo check-ins." + link;
    } else if (!configured) {
      $("#bot-status").textContent = "El bot aún no está configurado en el servidor (falta TELEGRAM_TOKEN).";
    } else {
      $("#bot-status").textContent = "El bot está apagado. Pulsa «Encender bot» para activarlo.";
    }
    var startBtn = $("#bot-start");
    startBtn.classList.toggle("hidden", on || !state.isAdmin);
    startBtn.disabled = !configured;
    $("#bot-stop").classList.toggle("hidden", !on || !state.isAdmin);
    setBadge(on);
  }
  async function loadBot() {
    try { renderBot(await api("/api/bot/status")); }
    catch (e) { $("#bot-status").textContent = e.message; }
  }
  async function startBot() {
    var btn = $("#bot-start"); btn.disabled = true; btn.textContent = "Encendiendo…";
    try {
      var s = await api("/api/bot/start", { method: "POST" });
      toast(s.username ? ("Bot @" + s.username + " en línea") : "Bot encendido");
      renderBot(s);
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '<svg class="ic"><use href="#i-power"/></svg> Encender bot'; }
  }
  async function stopBot() {
    if (!confirm("¿Apagar el bot? Los trabajadores no podrán hacer check-in hasta que vuelva a encenderse.")) return;
    try { renderBot(await api("/api/bot/stop", { method: "POST" })); toast("Bot apagado"); }
    catch (e) { toast(e.message, true); }
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  var POINT_FIELDS  = [{ key: "name", label: "Nombre" }, { key: "address", label: "Dirección" }, { key: "lat", label: "Latitud" }, { key: "lng", label: "Longitud" }, { key: "id", label: "ID (opcional)" }];
  var WORKER_FIELDS = [{ key: "telegramId", label: "ID de Telegram" }, { key: "name", label: "Nombre" }, { key: "phone", label: "Teléfono" }];
  var POINT_ORDER   = ["id", "name", "address", "lat", "lng"];
  var WORKER_ORDER  = ["telegramId", "name", "phone"];
  var SYNONYMS = {
    name: ["name", "nombre", "назв", "title", "point", "stop", "магаз", "клієнт", "клиент"],
    address: ["address", "addr", "direcc", "адрес", "вулиц", "street", "місто", "город"],
    lat: ["lat", "latitud", "широт"], lng: ["lng", "lon", "long", "longitud", "довгот", "долгот"],
    id: ["id", "code", "codigo", "код", "артик"], telegramId: ["telegram", "tid", "chat", "telega"],
    phone: ["phone", "tel", "telefono", "моб", "тел", "номер"],
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
    var html = '<option value="-1"' + (guess === -1 ? " selected" : "") + ">— omitir —</option>";
    headers.forEach(function (h, i) {
      html += '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + esc(h || ("Columna " + (i + 1))) + "</option>";
    });
    return html;
  }
  function renderMapping() {
    var box = $("#imp-map"), run = $("#imp-run");
    if (!parsed) { box.innerHTML = ""; run.classList.add("hidden"); return; }
    var fields = $("#imp-target").value === "points" ? POINT_FIELDS : WORKER_FIELDS;
    box.innerHTML = '<div class="map-grid">' + fields.map(function (f) {
      return "<label>" + esc(f.label) + '</label><select data-field="' + f.key + '">' + fieldOptions(parsed.headers, guessCol(f.key, parsed.headers)) + "</select>";
    }).join("") + '</div><p class="muted">' + parsed.count + " filas listas para importar.</p>";
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

  // ── Check-in (worker PWA) ──────────────────────────────────────────────────────
  var checkin = { lat: "", lng: "" };
  async function loadCheckin() {
    var sel = $("#ci-point");
    try {
      var data = await api("/api/points");
      var active = (data.points || []).filter(function (p) { return p.active; });
      if (!active.length) { sel.innerHTML = '<option value="">No hay paradas asignadas</option>'; return; }
      sel.innerHTML = active.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name || p.address || p.id) + "</option>";
      }).join("");
    } catch (e) { sel.innerHTML = '<option value="">' + esc(e.message) + "</option>"; }
  }
  function captureLocation() {
    var st = $("#ci-geo-status");
    if (!navigator.geolocation) { st.textContent = "Este dispositivo no permite geolocalización."; return; }
    st.textContent = "Obteniendo ubicación…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      checkin.lat = String(pos.coords.latitude);
      checkin.lng = String(pos.coords.longitude);
      st.textContent = "✅ Ubicación capturada (" + checkin.lat.slice(0, 8) + ", " + checkin.lng.slice(0, 8) + ").";
    }, function () {
      st.textContent = "No se pudo obtener la ubicación. Permite el acceso e inténtalo de nuevo.";
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  async function submitCheckin() {
    var pointId = $("#ci-point").value;
    if (!pointId) { toast("Elige una parada.", true); return; }
    if (!checkin.lat || !checkin.lng) { toast("Captura tu ubicación primero.", true); return; }
    var btn = $("#ci-submit"); btn.disabled = true; btn.textContent = "Enviando…";
    try {
      var body = { pointId: pointId, lat: checkin.lat, lng: checkin.lng, note: $("#ci-note").value || "" };
      var file = $("#ci-photo").files[0];
      if (file) { body.photo = await fileToB64(file); body.photoContentType = file.type || "image/jpeg"; }
      await api("/api/checkin", { method: "POST", body: JSON.stringify(body) });
      toast("✅ Check-in enviado");
      checkin = { lat: "", lng: "" };
      $("#ci-photo").value = ""; $("#ci-note").value = "";
      $("#ci-geo-status").textContent = "Aún no capturada.";
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Enviar check-in'; }
  }

  // ── Settings (PWA toggle + connector status) ─────────────────────────────────
  function renderSettings(s) {
    var pwaOn = !!(s && s.pwaEnabled);
    var ps = $("#pwa-status");
    if (ps) ps.innerHTML = pwaOn
      ? '<span class="dot dot-ok"></span> Activa — los trabajadores pueden entrar por teléfono.'
      : '<span class="dot dot-muted"></span> Desactivada.';
    var pt = $("#pwa-toggle");
    if (pt) pt.innerHTML = '<svg class="ic"><use href="#i-power"/></svg> ' + (pwaOn ? "Desactivar PWA" : "Activar PWA");

    var connOn = !!(s && s.connectorEnabled);
    var cs = $("#conn-status");
    if (cs) cs.textContent = connOn ? "activo" : "desactivado";
    var ch = $("#conn-hint");
    if (ch) ch.textContent = connOn
      ? "El conector acepta peticiones con tu clave X-API-Key."
      : "Para activarlo, define INTEGRATION_API_KEY en el servidor y vuelve a desplegar.";
  }
  async function loadSettings() {
    try { renderSettings(await api("/api/settings")); }
    catch (e) { /* ignore for non-critical panel */ }
  }
  async function togglePwa() {
    var btn = $("#pwa-toggle"); btn.disabled = true;
    try {
      var cur = await api("/api/settings");
      var next = await api("/api/settings", { method: "POST", body: JSON.stringify({ pwaEnabled: !cur.pwaEnabled }) });
      renderSettings(next);
      toast(next.pwaEnabled ? "PWA activada" : "PWA desactivada");
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  // ── Wire up ──────────────────────────────────────────────────────────────────
  function applyAdmin() { $$(".admin-only").forEach(function (el) { el.classList.toggle("hidden", !state.isAdmin); }); }

  // Worker sessions get a stripped-down app: only the check-in view, no manager nav.
  function applyWorkerMode() {
    document.body.classList.add("worker-mode");
    $$(".nav").forEach(function (t) { t.classList.add("hidden"); });
    $("#bot-badge").classList.add("hidden");
    var nt = $("#nav-toggle"); if (nt) nt.classList.add("hidden");
    var side = $("#side-nav"); if (side) side.classList.add("hidden");
  }

  function toggleTheme() {
    var dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("starx-theme", dark ? "dark" : "light"); } catch (e) {}
    $("#theme-icon").textContent = dark ? "☀️" : "🌙";
    if (map) setTimeout(function () { map.invalidateSize(); }, 60);
  }

  async function init() {
    // Theme icon initial state
    $("#theme-icon").textContent = document.documentElement.classList.contains("dark") ? "☀️" : "🌙";
    $("#theme-toggle").onclick = toggleTheme;

    // Sidebar nav
    $$(".nav").forEach(function (t) { t.onclick = function () { showView(t.dataset.view); }; });

    // Mobile drawer
    $("#nav-toggle").onclick = function () { document.body.classList.toggle("nav-open"); };
    $("#nav-close").onclick = function () { document.body.classList.remove("nav-open"); };
    $("#nav-backdrop").onclick = function () { document.body.classList.remove("nav-open"); };

    // Modal
    $("#modal-cancel").onclick = closeModal;
    $("#modal-save").onclick = function () { if (modalSave) modalSave(); };
    $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });

    // Delegated row actions + thumbnails
    document.addEventListener("click", function (e) {
      var t = e.target;
      var th = t.closest(".thumb");             if (th) return openLightbox(th.dataset.full);
      var ep = t.closest("[data-edit-point]");  if (ep) return editPoint(+ep.dataset.editPoint);
      var dp = t.closest("[data-del-point]");   if (dp) return delPoint(+dp.dataset.delPoint);
      var ew = t.closest("[data-edit-worker]"); if (ew) return editWorker(+ew.dataset.editWorker);
      var dw = t.closest("[data-del-worker]");  if (dw) return delWorker(+dw.dataset.delWorker);
    });

    // Hide thumbnails that fail to load (bot off / seeded demo without a real photo).
    document.addEventListener("error", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("thumb")) e.target.remove();
    }, true);

    // Lightbox close (backdrop click or Esc)
    $("#lightbox").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeLightbox(); closeModal(); document.body.classList.remove("nav-open"); }
    });

    // Add buttons
    $("#add-point").onclick = function () {
      openModal("Añadir punto", pointForm({}), async function () {
        try { await api("/api/points", { method: "POST", body: JSON.stringify(pointPayload()) }); closeModal(); toast("Punto añadido"); loadPoints(); }
        catch (e) { toast(e.message, true); }
      });
    };
    $("#add-worker").onclick = function () {
      openModal("Añadir trabajador", workerForm({}), async function () {
        try { await api("/api/workers", { method: "POST", body: JSON.stringify(workerPayload()) }); closeModal(); toast("Trabajador añadido"); loadWorkers(); }
        catch (e) { toast(e.message, true); }
      });
    };
    $("#reload-visits").onclick = loadVisits;

    // Bot
    $("#bot-start").onclick = startBot;
    $("#bot-stop").onclick = stopBot;

    // Check-in (worker PWA)
    $("#ci-geo").onclick = captureLocation;
    $("#ci-submit").onclick = submitCheckin;

    // Settings (PWA toggle)
    var pwaBtn = $("#pwa-toggle"); if (pwaBtn) pwaBtn.onclick = togglePwa;

    // Import
    $("#imp-target").onchange = renderMapping;
    $("#imp-file").onchange = async function (e) {
      var file = e.target.files[0];
      if (!file) return;
      try { var b64 = await fileToB64(file); parsed = await api("/api/import/parse", { method: "POST", body: JSON.stringify({ data: b64 }) }); renderMapping(); toast("Analizadas " + parsed.count + " filas"); }
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
      try { var res = await api("/api/import/" + target, { method: "POST", body: JSON.stringify({ rows: rows }) }); toast("Importadas " + res.written + " filas"); parsed = null; $("#imp-file").value = ""; renderMapping(); }
      catch (err) { toast(err.message, true); }
    };
    $("#setup-btn").onclick = async function () {
      if (!confirm("¿Crear las pestañas workers / points / visits en tu hoja conectada?")) return;
      try { var res = await api("/api/setup", { method: "POST" }); toast(res.created && res.created.length ? "Creadas: " + res.created.join(", ") : "La hoja ya está lista"); }
      catch (e) { toast(e.message, true); }
    };

    // Who am I
    try {
      var me = await api("/api/me");
      $("#company").textContent = me.company ? "· " + me.company : "";
      $("#user").textContent = me.name || "";
      state.role = me.role; state.isAdmin = me.role === "admin";
    } catch (e) { /* api() already redirects on 401 */ }
    applyAdmin();

    // Workers land straight on the check-in screen with a stripped-down UI.
    if (state.role === "worker") {
      applyWorkerMode();
      var hello = $("#ci-hello");
      if (hello && state.role) hello.textContent = "Hola" + ($("#user").textContent ? ", " + $("#user").textContent : "") + ". Elige tu parada, comparte tu ubicación y añade una foto.";
      showView("checkin");
      return;
    }

    loadDashboard();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/platform/assets/sw.js").catch(function () {});
  document.addEventListener("DOMContentLoaded", init);
})();
