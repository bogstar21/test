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
    if (!res.ok) {
      // Prefer the human-readable `detail` (e.g. the geofence "estás a X m…" message)
      // over the machine code so toasts read naturally. Keep both on the error.
      var err = new Error(data.detail || data.error || ("HTTP " + res.status));
      err.code = data.error; err.detail = data.detail;
      throw err;
    }
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
  function skeleton(n) { var r = ""; for (var i = 0; i < (n || 5); i++) r += '<div class="sk"></div>'; return '<div class="sk-wrap">' + r + "</div>"; }
  function fmtTime(t) { return esc(String(t || "").replace("T", " ").slice(0, 16)); }
  // Human duration between two ISO timestamps (used by check-out / visit detail).
  function durationText(startIso, endIso) {
    var a = Date.parse(startIso), b = Date.parse(endIso);
    if (!isFinite(a) || !isFinite(b) || b < a) return "—";
    var min = Math.round((b - a) / 60000);
    if (min < 60) return min + " min";
    return Math.floor(min / 60) + " h " + (min % 60) + " min";
  }

  var state = { role: "", isAdmin: false, code: "", points: [], workers: [], visits: [], pointStats: {} };
  // View-level filters (kept between reloads so search/date survive a refresh).
  var filters = {
    pointsQ: "", pointsWorker: "",
    workersQ: "",
    visitsQ: "", visitsFrom: "", visitsTo: "",
  };
  var selectedPoints = {}; // row → true, for bulk assignment
  // Dashboard filters (apply to the charts + map, computed from the recent visits list).
  var dashFilters = { worker: "", source: "", from: "", to: "" };
  var lastRecent = [];

  // ── Modal ────────────────────────────────────────────────────────────────────
  var modalSave = null;
  function openModal(title, html, onSave) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = html;
    $("#modal").classList.remove("hidden");
    modalSave = onSave || null;
    // A read-only modal (no onSave) hides the Save button and relabels Cancel as "Close".
    var save = $("#modal-save"), cancel = $("#modal-cancel");
    if (save) save.style.display = modalSave ? "" : "none";
    if (cancel) cancel.textContent = modalSave ? "Cancelar" : "Cerrar";
    var first = $("#modal-body input, #modal-body select");
    if (first) first.focus();
  }
  function closeModal() { $("#modal").classList.add("hidden"); modalSave = null; }

  // ── Map (Leaflet) ──────────────────────────────────────────────────────────
  // Flat, minimal basemap from CARTO — light (near-white) or dark (near-black) to match
  // the app theme. No API key needed.
  var map = null, markers = null, tileLayer = null;
  function tileUrl() {
    var dark = document.documentElement.classList.contains("dark");
    return "https://{s}.basemaps.cartocdn.com/" + (dark ? "dark_all" : "light_all") + "/{z}/{x}/{y}.png";
  }
  function applyMapTheme() {
    if (!map || typeof L === "undefined") return;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(tileUrl(), {
      maxZoom: 19, subdomains: "abcd",
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
  }
  function ensureMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([40.4, -3.7], 5);
    applyMapTheme();
    markers = L.layerGroup().addTo(map);
  }
  var SRC_COLOR = { bot: "#e04a2d", pwa: "#22c55e" };
  var mapLegend = null;
  function ensureLegend() {
    if (mapLegend || !map || typeof L === "undefined") return;
    mapLegend = L.control({ position: "bottomright" });
    mapLegend.onAdd = function () {
      var d = L.DomUtil.create("div", "map-legend");
      d.innerHTML =
        '<span><i style="background:' + SRC_COLOR.bot + '"></i>Bot</span>' +
        '<span><i style="background:' + SRC_COLOR.pwa + '"></i>App</span>';
      return d;
    };
    mapLegend.addTo(map);
  }
  function plotVisits(list) {
    ensureMap();
    if (!map) return;
    ensureLegend();
    markers.clearLayers();
    var pts = [];
    (list || []).forEach(function (v) {
      var lat = parseFloat(v.lat), lng = parseFloat(v.lng);
      if (isFinite(lat) && isFinite(lng)) {
        var color = SRC_COLOR[v.source] || SRC_COLOR.bot;
        var photos = (v.photoCount || 0) > 0 ? "<br>" + v.photoCount : "";
        markers.addLayer(L.circleMarker([lat, lng], {
          radius: 7, color: color, weight: 2, fillColor: color, fillOpacity: 0.55,
        }).bindPopup(
          "<b>" + esc(v.pointName || "—") + "</b><br>" + esc(v.workerName || "") +
          "<br><span style='color:" + color + "'>●</span> " + (v.source === "pwa" ? "App" : "Bot") +
          "<br>" + fmtTime(v.timestamp) + photos));
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
    else if (v === "stats") loadStats();
    else if (v === "import") renderMapping();
    else if (v === "settings") { loadSettings(); loadBot(); }
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
      return '<div class="bl-row" title="' + esc(e[0]) + ': ' + e[1] + '"><span class="bl-name">' + esc(e[0]) + '</span>' +
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
    var dots = vals.map(function (val, i) {
      return '<circle class="pt-dot" cx="' + x(i) + '" cy="' + y(val) + '" r="3.4" fill="#e04a2d">' +
        '<title>' + esc(labels[i].key) + ' · ' + val + ' check-in' + (val === 1 ? "" : "s") + '</title></circle>';
    }).join("");
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
      '<stop offset="0%" stop-color="#e04a2d" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#e04a2d" stop-opacity="0"/></linearGradient></defs>' +
      gridLines + ylabels +
      '<polygon points="' + areaPts + '" fill="url(#carea)"/>' +
      '<polyline points="' + linePts + '" fill="none" stroke="#e04a2d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + xlabels + "</svg>";
  }

  // Donut: check-ins split by source (bot vs PWA), built from the filtered recent list.
  function renderSourceChart(list) {
    var box = $("#chart-source");
    if (!box) return;
    var counts = { bot: 0, pwa: 0 };
    (list || []).forEach(function (v) { counts[(v.source === "pwa") ? "pwa" : "bot"]++; });
    var total = counts.bot + counts.pwa;
    if (!total) { box.innerHTML = '<div class="empty">Sin check-ins en este rango</div>'; return; }
    var r = 52, C = 2 * Math.PI * r, cx = 70, cy = 70, f1 = counts.bot / total;
    var seg = function (color, frac, offsetFrac, label, count) {
      return '<circle class="donut-seg" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color +
        '" stroke-width="18" stroke-dasharray="' + (frac * C) + ' ' + C + '" stroke-dashoffset="' + (-offsetFrac * C) +
        '" transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + label + ': ' + count + ' (' + Math.round(frac * 100) + '%)</title></circle>';
    };
    box.innerHTML =
      '<div class="donut-wrap">' +
      '<svg viewBox="0 0 140 140" width="132" height="132" role="img">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--glass-2)" stroke-width="18"/>' +
      seg("#e04a2d", f1, 0, "Bot", counts.bot) + seg("#22c55e", counts.pwa / total, f1, "App", counts.pwa) +
      '<text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" font-size="26" font-weight="700" fill="var(--strong)">' + total + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="11" fill="var(--faint)">check-ins</text>' +
      '</svg>' +
      '<div class="donut-legend">' +
        '<div><span class="dot" style="background:#e04a2d"></span> Bot <b>' + counts.bot + '</b> <span class="muted">' + Math.round(f1 * 100) + '%</span></div>' +
        '<div><span class="dot" style="background:#22c55e"></span> App <b>' + counts.pwa + '</b> <span class="muted">' + Math.round((counts.pwa / total) * 100) + '%</span></div>' +
      '</div></div>';
  }

  // Shared SVG bar-chart renderer (used by the weekday and hourly breakdowns). Bars sit
  // flush on the baseline with only the top corners rounded — no floating "pill" for
  // small values — plus a light grid, a value label above each bar, and a hover tooltip.
  var _barchartSeq = 0;
  function renderBarsSVG(sel, cats, counts, opts) {
    opts = opts || {};
    var box = (typeof sel === "string") ? $(sel) : sel;
    if (!box) return;
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    if (!total) { box.innerHTML = '<div class="empty">' + (opts.emptyText || "Sin datos") + '</div>'; return; }

    var n = counts.length;
    var W = 720, H = opts.height || 190, padL = 30, padR = 10, padT = 24, padB = 24;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = Math.max.apply(null, counts.concat([1]));
    var slot = iw / n;
    var barW = Math.max(4, Math.min(opts.maxBarWidth || 30, slot * 0.58));
    var baseY = padT + ih;
    var ticks = 3, gridLines = "";
    for (var g = 0; g <= ticks; g++) {
      var gy = padT + (g / ticks) * ih;
      gridLines += '<line class="grid-line" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
    }

    var gid = "bcg" + (_barchartSeq++);
    var bars = "", labelsSvg = "";
    for (var i = 0; i < n; i++) {
      var c = counts[i];
      var cx = padL + slot * i + slot / 2;
      if (!opts.showLabel || opts.showLabel(i)) {
        labelsSvg += '<text class="axis-lbl" x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(String(cats[i])) + "</text>";
      }
      if (c > 0) {
        var bh = Math.max(4, (c / max) * ih);
        var top = baseY - bh;
        var r = Math.min(6, barW / 2, bh);
        var x0 = cx - barW / 2, x1 = cx + barW / 2;
        var d = "M" + x0 + "," + baseY + " L" + x0 + "," + (top + r) +
          " Q" + x0 + "," + top + " " + (x0 + r) + "," + top +
          " L" + (x1 - r) + "," + top + " Q" + x1 + "," + top + " " + x1 + "," + (top + r) +
          " L" + x1 + "," + baseY + " Z";
        var tip = opts.tooltip ? opts.tooltip(i, c) : (cats[i] + ": " + c);
        bars += '<g class="bar-seg"><title>' + esc(String(tip)) + '</title><path d="' + d + '" fill="url(#' + gid + ')"/></g>';
        labelsSvg += '<text class="bar-val" x="' + cx + '" y="' + (top - 6) + '" text-anchor="middle">' + c + "</text>";
      }
    }

    box.innerHTML =
      '<svg class="barchart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-2)"/></linearGradient></defs>' +
      gridLines +
      '<line class="axis-base" x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '"/>' +
      bars + labelsSvg + "</svg>";
  }

  var WEEKDAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  var WEEKDAY_FULL  = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  function weekdayCounts(list) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    (list || []).forEach(function (v) {
      var d = new Date(v.timestamp);
      if (isNaN(d.getTime())) return;
      counts[(d.getDay() + 6) % 7]++; // JS 0=Sun → Monday-first
    });
    return counts;
  }

  // Bars: check-ins by weekday (Monday-first), from the filtered recent list.
  function renderWeekdayChart(list) {
    var box = $("#chart-weekday");
    if (!box) return;
    renderBarsSVG(box, WEEKDAY_SHORT, weekdayCounts(list), {
      emptyText: "Sin check-ins en este rango",
      tooltip: function (i, c) { return WEEKDAY_FULL[i] + ": " + c + " check-in" + (c === 1 ? "" : "s"); },
    });
  }

  // Filtered slice of the recent-visits list, per the dashboard filter bar.
  function filteredRecent() {
    return (lastRecent || []).filter(function (v) {
      if (dashFilters.worker && String(v.workerName || v.workerTelegramId || "") !== dashFilters.worker) return false;
      if (dashFilters.source && (v.source || "bot") !== dashFilters.source) return false;
      var day = String(v.timestamp || "").slice(0, 10);
      if (dashFilters.from && day < dashFilters.from) return false;
      if (dashFilters.to && day > dashFilters.to) return false;
      return true;
    });
  }
  function fillDashWorkers() {
    var sel = $("#dash-worker");
    if (!sel) return;
    var names = {};
    (lastRecent || []).forEach(function (v) { var n = v.workerName || v.workerTelegramId; if (n) names[n] = true; });
    sel.innerHTML = '<option value="">Todos los trabajadores</option>' +
      Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    sel.value = dashFilters.worker;
  }
  // Rebuild every filter-aware widget (charts + map + top lists) from the recent list.
  function renderDashWidgets() {
    var list = filteredRecent();
    var byWorker = {}, byPoint = {};
    list.forEach(function (v) {
      var w = v.workerName || v.workerTelegramId; if (w) byWorker[w] = (byWorker[w] || 0) + 1;
      var p = v.pointName || v.pointId; if (p) byPoint[p] = (byPoint[p] || 0) + 1;
    });
    renderBarlist("#top-workers", byWorker);
    renderBarlist("#top-points", byPoint);
    renderVisitsChart(list);
    renderSourceChart(list);
    renderWeekdayChart(list);
    plotVisits(list);
    var scope = $("#dash-scope");
    if (scope) {
      var active = dashFilters.worker || dashFilters.source || dashFilters.from || dashFilters.to;
      var T = (window.LF && window.LF.t) ? window.LF.t : function (s) { return s; };
      scope.textContent = (active ? T("Filtrado:") : T("Mostrando")) + " " + list.length + " " + T("de") + " " +
        (lastRecent || []).length + " " + T("check-ins recientes") + (active ? ". " + T("Los KPIs de arriba son totales globales.") : ".");
    }
  }

  async function loadDashboard() {
    try {
      var s = await api("/api/stats");
      $("#s-visits").textContent  = s.totals.visits;
      $("#s-today").textContent   = s.totals.today;
      $("#s-points").textContent  = s.totals.pointsActive;
      $("#s-workers").textContent = s.totals.workersActive;
      var sub = $("#s-points-sub");
      if (sub) {
        var un = s.totals.pointsUnassigned || 0;
        sub.textContent = un ? window.LF.tf("{n} sin asignar", { n: un }) : window.LF.t("paradas a visitar");
        sub.classList.toggle("warn", un > 0);
      }
      lastRecent = s.recent || [];
      fillDashWorkers();
      renderDashWidgets();
    } catch (e) { toast(e.message, true); }
    refreshBotBadge();
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  function pointForm(p) {
    p = p || {};
    var opts = '<option value="">— Sin asignar —</option>' + (state.workers || []).map(function (w) {
      return '<option value="' + esc(w.workerId) + '"' + (String(p.workerId || "") === String(w.workerId) ? " selected" : "") + ">" + esc(w.name || w.phone || w.workerId) + "</option>";
    }).join("");
    return '' +
      '<div class="field"><label>Nombre</label><input id="f-name" value="' + esc(p.name || "") + '"></div>' +
      '<div class="field"><label>Dirección</label><input id="f-address" value="' + esc(p.address || "") + '"></div>' +
      '<div class="field"><label>Trabajador asignado</label><select id="f-worker">' + opts + "</select></div>" +
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
    // workerId is always sent (empty = unassign) so the manager can reassign points here.
    return { name: $("#f-name").value, address: $("#f-address").value, workerId: $("#f-worker").value, lat: $("#f-lat").value, lng: $("#f-lng").value, active: $("#f-active").value !== "0" };
  }
  // Populate the worker <select> controls (points filter + bulk-assign) from state.workers.
  function fillWorkerSelects() {
    var opts = (state.workers || []).map(function (w) {
      return '<option value="' + esc(w.workerId) + '">' + esc(w.name || w.phone || w.workerId) + "</option>";
    }).join("");
    var f = $("#points-worker-filter");
    if (f) {
      f.innerHTML = '<option value="">Todos los trabajadores</option><option value="__none__">— Sin asignar —</option>' + opts;
      f.value = filters.pointsWorker;
    }
    var b = $("#points-bulk-worker");
    if (b) b.innerHTML = '<option value="">— Sin asignar —</option>' + opts;
  }

  function pointMatches(p) {
    var q = filters.pointsQ.trim().toLowerCase();
    if (q) {
      var hay = (String(p.name || "") + " " + String(p.address || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (filters.pointsWorker === "__none__") return !p.workerId;
    if (filters.pointsWorker) return String(p.workerId) === String(filters.pointsWorker);
    return true;
  }

  function updateBulkbar() {
    var bar = $("#points-bulkbar");
    if (!bar || !state.isAdmin) return;
    var rows = Object.keys(selectedPoints).filter(function (r) { return selectedPoints[r]; });
    bar.classList.toggle("hidden", rows.length === 0);
    var cnt = $("#points-bulk-count");
    if (cnt) cnt.textContent = window.LF.tf(rows.length === 1 ? "{n} seleccionado" : "{n} seleccionados", { n: rows.length });
  }

  async function loadPoints() {
    $("#points-wrap").innerHTML = skeleton();
    try {
      var data = await api("/api/points");
      state.points = data.points;
      // Load workers too so the assign dropdown (and the column below) can name them.
      try { state.workers = (await api("/api/workers")).workers || state.workers; } catch (e) {}
      // Per-point activity (visit count + last visit) for the "Actividad" column.
      try {
        var vis = (await api("/api/visits?limit=5000")).visits || [];
        var stats = {};
        vis.forEach(function (v) {
          var pid = String(v.pointId || "");
          if (!pid) return;
          var s = stats[pid] || (stats[pid] = { count: 0, last: "" });
          s.count++;
          if (String(v.timestamp || "") > s.last) s.last = String(v.timestamp || "");
        });
        state.pointStats = stats;
      } catch (e) { state.pointStats = state.pointStats || {}; }
      fillWorkerSelects();
      loadPointsFromState();
    } catch (e) { $("#points-wrap").innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }

  // Re-render the points table from cached state (used by search/filter without a refetch).
  function loadPointsFromState() {
    var wrap = $("#points-wrap");
    try {
      if (!state.points.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay puntos. Añade uno o importa desde Excel.</div></div>'; updateBulkbar(); return; }
      var rows = state.points.filter(pointMatches);
      if (!rows.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Ningún punto coincide con el filtro.</div></div>'; updateBulkbar(); return; }
      var heads = [];
      if (state.isAdmin) heads.push("");
      heads = heads.concat(["Nombre", "Dirección", "Trabajador", "Actividad", "Geo", "Lat", "Lng", "Estado"]);
      if (state.isAdmin) heads.push("Acciones");
      var stats = state.pointStats || {};
      wrap.innerHTML = tableWrap(heads, rows.map(function (p) {
        var geo = p.geolocated
          ? '<span class="pill on">sí</span>'
          : '<span class="pill off">pendiente</span>';
        var worker = p.workerName ? esc(p.workerName) : '<span class="muted">— sin asignar —</span>';
        var st = stats[String(p.id)] || { count: 0, last: "" };
        var activity = st.count
          ? '<b>' + st.count + '</b> ' + (st.count === 1 ? "visita" : "visitas") +
            '<div class="muted" style="font-size:11.5px">última ' + esc(String(st.last).slice(0, 10)) + '</div>'
          : '<span class="muted">sin visitas</span>';
        var check = state.isAdmin
          ? '<td data-label=""><input type="checkbox" class="row-check" data-check-point="' + p.row + '"' + (selectedPoints[p.row] ? " checked" : "") + "></td>"
          : "";
        return "<tr>" + check + '<td data-label="Nombre">' + esc(p.name) + '</td><td data-label="Dirección" class="muted">' + esc(p.address) + '</td><td data-label="Trabajador">' + worker + '</td><td data-label="Actividad">' + activity + '</td><td data-label="Geo">' + geo + '</td><td data-label="Lat" class="mono">' + esc(p.lat) + '</td><td data-label="Lng" class="mono">' + esc(p.lng) + '</td><td data-label="Estado">' + statusPill(p.active) + "</td>" +
          (state.isAdmin ? '<td data-label="Acciones"><div class="tbl-actions"><button class="btn ghost sm" data-edit-point="' + p.row + '">Editar</button><button class="btn danger sm" data-del-point="' + p.row + '">Borrar</button></div></td>' : "") +
          "</tr>";
      }).join(""), true);
      updateBulkbar();
    } catch (e) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }

  async function bulkAssign() {
    var rows = Object.keys(selectedPoints).filter(function (r) { return selectedPoints[r]; }).map(Number);
    if (!rows.length) { toast("Selecciona al menos un punto.", true); return; }
    var workerId = $("#points-bulk-worker").value;
    try {
      var res = await api("/api/points/assign", { method: "POST", body: JSON.stringify({ rows: rows, workerId: workerId }) });
      toast(window.LF.tf(workerId ? "{n} puntos asignados" : "{n} puntos sin asignar", { n: res.updated || 0 }));
      selectedPoints = {};
      loadPoints();
    } catch (e) { toast(e.message, true); }
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
    if (!confirm(window.LF.t("¿Borrar este punto?"))) return;
    try { await api("/api/points/" + row, { method: "DELETE" }); toast("Borrado"); loadPoints(); } catch (e) { toast(e.message, true); }
  }

  // ── Workers ──────────────────────────────────────────────────────────────────
  function workerForm(w) {
    w = w || {};
    var widField = w.workerId
      ? '<div class="field"><label>ID interno (automático)</label><input value="' + esc(w.workerId) + '" readonly disabled></div>'
      : "";
    return '' +
      widField +
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
  function workerMatches(w) {
    var q = filters.workersQ.trim().toLowerCase();
    if (!q) return true;
    var hay = (String(w.name || "") + " " + String(w.phone || "") + " " + String(w.telegramId || "") + " " + String(w.workerId || "")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  // Bot-registration attempts from phones that aren't in the roster (see task 4). Shown as
  // a card above the workers table so the manager can add or dismiss them.
  async function loadPendingContacts() {
    var box = $("#workers-pending");
    if (!box) return;
    try {
      var items = (await api("/api/workers/pending")).pending || [];
      if (!items.length) { box.innerHTML = ""; return; }
      box.innerHTML = '<div class="card card-pad pending-card">' +
        '<h3><svg class="ic"><use href="#i-users"/></svg> ' + items.length +
        (items.length === 1 ? " intento de registro sin dar de alta" : " intentos de registro sin dar de alta") + '</h3>' +
        '<p class="desc">Abrieron el bot con un teléfono que no está en el sistema. Añádelos para que puedan hacer check-in.</p>' +
        items.map(function (c) {
          return '<div class="pending-row"><div class="pending-who"><b>' + esc(c.name || "—") +
            '</b> <span class="mono">' + esc(c.phone) + '</span></div>' +
            (state.isAdmin ? '<div class="tbl-actions">' +
              '<button class="btn sm" data-add-pending="' + esc(c.phone) + '" data-add-pending-name="' + esc(c.name || "") + '">Añadir</button>' +
              '<button class="btn ghost sm" data-dismiss-pending="' + esc(c.phone) + '">Descartar</button></div>' : "") +
            '</div>';
        }).join("") + '</div>';
    } catch (e) { box.innerHTML = ""; }
  }
  function addFromPending(phone, name) {
    openModal("Añadir trabajador", workerForm({ name: name, phone: phone }), async function () {
      try { await api("/api/workers", { method: "POST", body: JSON.stringify(workerPayload()) }); closeModal(); toast("Trabajador añadido"); loadWorkers(); }
      catch (e) { toast(e.message, true); }
    });
  }
  async function dismissPending(phone) {
    try { await api("/api/workers/pending/dismiss", { method: "POST", body: JSON.stringify({ phone: phone }) }); loadPendingContacts(); }
    catch (e) { toast(e.message, true); }
  }

  async function loadWorkers() {
    var wrap = $("#workers-wrap");
    wrap.innerHTML = skeleton();
    loadPendingContacts();
    try {
      // Pull points + stats alongside workers so each row can show real activity, not just IDs.
      var res = await Promise.all([
        api("/api/workers"),
        api("/api/points").catch(function () { return { points: [] }; }),
        api("/api/stats").catch(function () { return {}; }),
      ]);
      var data = res[0], points = res[1].points || [], stats = res[2] || {};
      state.workers = data.workers;
      if (!data.workers.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay trabajadores. Añade uno o importa desde Excel.</div></div>'; return; }
      var rows = data.workers.filter(workerMatches);
      if (!rows.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Ningún trabajador coincide con la búsqueda.</div></div>'; return; }

      // Per-worker aggregates.
      var assignedByWid = {};
      points.forEach(function (p) { if (p.active !== false && p.workerId) assignedByWid[p.workerId] = (assignedByWid[p.workerId] || 0) + 1; });
      var covByWid = {}; (stats.coverage || []).forEach(function (c) { covByWid[c.workerId] = c; });
      var byWorker = stats.byWorker || {};
      var lastByKey = {};
      (stats.recent || []).forEach(function (v) {
        [v.workerId, v.workerName, v.workerTelegramId].forEach(function (k) {
          if (k && (!lastByKey[k] || String(v.timestamp) > String(lastByKey[k]))) lastByKey[k] = v.timestamp;
        });
      });

      var heads = ["Nombre", "Teléfono", "Paradas (hoy)", "Check-ins", "Último check-in", "Estado"];
      if (state.isAdmin) heads.push("Acciones");
      wrap.innerHTML = tableWrap(heads, rows.map(function (w) {
        var cov = covByWid[w.workerId];
        var assigned = cov ? cov.assigned : (assignedByWid[w.workerId] || 0);
        var doneToday = cov ? cov.visitedToday : 0;
        var total = byWorker[w.name] || 0;
        var last = lastByKey[w.workerId] || lastByKey[w.name] || lastByKey[w.telegramId] || "";
        var assignedCell = assigned
          ? '<b>' + doneToday + '</b><span class="muted">/' + assigned + '</span>'
          : '<span class="muted">— sin asignar —</span>';
        var lastCell = last ? fmtTime(last) : '<span class="muted">nunca</span>';
        return '<tr><td data-label="Nombre">' + esc(w.name) + (w.telegramId ? '' : ' <span class="pill off" title="Aún no ha abierto el bot">sin Telegram</span>') + '</td>' +
          '<td data-label="Teléfono">' + esc(w.phone) + '</td>' +
          '<td data-label="Paradas (hoy)" title="Paradas hechas hoy / asignadas">' + assignedCell + '</td>' +
          '<td data-label="Check-ins">' + total + '</td>' +
          '<td data-label="Último check-in" class="muted">' + lastCell + '</td>' +
          '<td data-label="Estado">' + statusPill(w.active) + "</td>" +
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
    if (!confirm(window.LF.t("¿Borrar este trabajador?"))) return;
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
  // Client-side visit filter: free-text (worker/point/note) + inclusive date range (by day).
  function visitMatches(v) {
    var q = filters.visitsQ.trim().toLowerCase();
    if (q) {
      var hay = (String(v.workerName || v.workerTelegramId || "") + " " + String(v.pointName || v.pointId || "") + " " + String(v.note || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    var day = String(v.timestamp || "").slice(0, 10);
    if (filters.visitsFrom && day < filters.visitsFrom) return false;
    if (filters.visitsTo && day > filters.visitsTo) return false;
    return true;
  }
  function filteredVisits() { return (state.visits || []).filter(visitMatches); }

  async function loadVisits() {
    var wrap = $("#visits-wrap");
    wrap.innerHTML = skeleton();
    try {
      var data = await api("/api/visits?limit=5000");
      state.visits = data.visits || [];
      if (!state.visits.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Aún no hay check-ins.</div></div>'; return; }
      renderVisits();
    } catch (e) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">' + esc(e.message) + "</div></div>"; }
  }
  function renderVisits() {
    var wrap = $("#visits-wrap");
    var rows = filteredVisits();
    if (!rows.length) { wrap.innerHTML = '<div class="card card-pad"><div class="empty">Ningún check-in coincide con el filtro.</div></div>'; return; }
    wrap.innerHTML = tableWrap(["Hora", "Trabajador", "Punto", "Ubicación", "Fotos", "Nota", ""], rows.map(function (v) {
      return '<tr><td data-label="Hora">' + fmtTime(v.timestamp) + '</td><td data-label="Trabajador">' + esc(v.workerName || v.workerTelegramId) + '</td><td data-label="Punto">' + esc(v.pointName || v.pointId) + '</td><td data-label="Ubicación">' +
        (v.mapsLink ? '<a href="' + esc(v.mapsLink) + '" target="_blank" rel="noopener">mapa</a>' : '<span class="muted">—</span>') +
        '</td><td data-label="Fotos">' + photoCell(v) + '</td><td data-label="Nota" class="muted">' + esc(v.note || "") +
        '</td><td data-label=""><button class="btn ghost sm" data-visit-detail="' + esc(v.visitId) + '">Ver</button></td></tr>';
    }).join(""), true);
  }

  // A.4 — Visit detail: full record (time, worker, point, source, location, note, photos).
  function openVisitDetail(visitId) {
    var v = (state.visits || []).filter(function (x) { return String(x.visitId) === String(visitId); })[0];
    if (!v) return;
    var n = v.photoCount || 0, photos = "";
    for (var i = 0; i < n; i++) {
      var src = "/api/visits/" + encodeURIComponent(v.visitId) + "/photo/" + i;
      photos += '<img class="thumb" src="' + src + '" alt="foto" data-full="' + src + '" loading="lazy">';
    }
    var dur = v.checkoutAt ? durationText(v.timestamp, v.checkoutAt) : "";
    function row(label, val) { return '<div class="vd-row"><span class="vd-k">' + label + '</span><span class="vd-v">' + val + '</span></div>'; }
    var html =
      row("Hora", fmtTime(v.timestamp)) +
      (v.checkoutAt ? row("Salida", fmtTime(v.checkoutAt)) + row("Duración", dur) : "") +
      row("Trabajador", esc(v.workerName || v.workerTelegramId || "—")) +
      row("Punto", esc(v.pointName || v.pointId || "—")) +
      row("Fuente", v.source === "pwa" ? "App (PWA)" : "Bot de Telegram") +
      row("Ubicación", v.mapsLink ? '<a href="' + esc(v.mapsLink) + '" target="_blank" rel="noopener">' + esc(v.lat) + ", " + esc(v.lng) + ' — mapa</a>' : '<span class="muted">—</span>') +
      row("Nota", v.note ? esc(v.note) : '<span class="muted">—</span>') +
      '<div class="vd-photos">' + (photos || '<span class="muted">Sin fotos</span>') + '</div>';
    openModal("Detalle del check-in", html, null);
  }

  // Export visits to CSV, generated entirely client-side (no extra endpoint).
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function downloadVisitsCsv() {
    try {
      // Export exactly what's shown: reuse the loaded list + active filter.
      if (!state.visits.length) {
        var data = await api("/api/visits?limit=5000");
        state.visits = data.visits || [];
      }
      var visits = filteredVisits();
      if (!visits.length) { toast("No hay visitas para exportar (revisa el filtro).", true); return; }
      var cols = ["timestamp", "workerName", "workerTelegramId", "pointName", "pointId", "lat", "lng", "mapsLink", "photoCount", "source", "note"];
      var csv = "﻿" + cols.join(",") + "\n" +
        visits.map(function (v) { return cols.map(function (c) { return csvCell(v[c]); }).join(","); }).join("\n");
      var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      var a = document.createElement("a");
      a.href = url; a.download = "starx-visitas-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast(window.LF.tf("Descargando {n} visitas", { n: visits.length }));
    } catch (e) { toast(e.message, true); }
  }

  // Lightbox: click a thumbnail to view the full photo.
  function openLightbox(src) { $("#lightbox-img").src = src; $("#lightbox").classList.remove("hidden"); }
  function closeLightbox() { $("#lightbox").classList.add("hidden"); $("#lightbox-img").src = ""; }

  // ── Statistics (company + personal views) ────────────────────────────────────
  // Everything is computed client-side from /api/visits + /api/points + /api/workers,
  // same seam the dashboard uses — no new backend endpoints needed.
  var statsState = { mode: "company", period: 30, worker: "" };

  // Resolve a visit to its owner's stable workerId (telegramId fallback for old visits).
  function ownerWidOf(v) {
    var wid = String(v.workerId || "").trim();
    if (wid) return wid;
    var tid = String(v.workerTelegramId || "").trim();
    if (!tid) return "";
    var w = (state.workers || []).filter(function (x) { return String(x.telegramId) === tid; })[0];
    return w ? String(w.workerId) : "";
  }

  // Visits inside the selected period (and worker, in personal mode), newest first.
  function statsVisits() {
    var cutoff = statsState.period ? (Date.now() - statsState.period * 864e5) : 0;
    return (state.visits || []).filter(function (v) {
      var t = Date.parse(v.timestamp);
      if (!isFinite(t) || (cutoff && t < cutoff)) return false;
      if (statsState.mode === "personal") {
        if (!statsState.worker) return false;
        if (ownerWidOf(v) !== String(statsState.worker)) return false;
      }
      return true;
    });
  }

  // Generic day-bucketed line chart (like the dashboard one, but any target + range).
  function renderLineInto(sel, list, days) {
    var box = $(sel);
    if (!box) return;
    if (!days) { // "todo el histórico" → span from oldest visit, capped at 365 buckets
      var oldest = Date.now();
      list.forEach(function (v) { var t = Date.parse(v.timestamp); if (isFinite(t) && t < oldest) oldest = t; });
      days = Math.min(365, Math.max(7, Math.ceil((Date.now() - oldest) / 864e5) + 1));
    }
    var buckets = {}, labels = [], now = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now); d.setDate(now.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
      labels.push({ key: key, short: (d.getMonth() + 1) + "/" + d.getDate() });
    }
    var any = false;
    list.forEach(function (v) {
      var key = String(v.timestamp || "").slice(0, 10);
      if (key in buckets) { buckets[key]++; any = true; }
    });
    if (!any) { box.innerHTML = '<div class="empty">Sin check-ins en este periodo</div>'; return; }

    var W = 720, H = 200, padL = 28, padR = 8, padT = 12, padB = 22;
    var vals = labels.map(function (l) { return buckets[l.key]; });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var iw = W - padL - padR, ih = H - padT - padB;
    var x = function (i) { return padL + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * iw); };
    var y = function (val) { return padT + ih - (val / maxV) * ih; };
    var grid = "", ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var gy = padT + (g / ticks) * ih;
      grid += '<line class="grid-line" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
    }
    var linePts = vals.map(function (val, i) { return x(i) + "," + y(val); }).join(" ");
    var areaPts = padL + "," + (padT + ih) + " " + linePts + " " + (W - padR) + "," + (padT + ih);
    var step = Math.max(1, Math.round(labels.length / 8));
    var dots = labels.length <= 60
      ? vals.map(function (val, i) { return '<circle cx="' + x(i) + '" cy="' + y(val) + '" r="3" fill="#e04a2d"/>'; }).join("")
      : "";
    var xlabels = labels.map(function (l, i) {
      if (i % step !== 0 && i !== labels.length - 1) return "";
      return '<text class="axis-lbl" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l.short) + "</text>";
    }).join("");
    var ylabels = "";
    for (var t = 0; t <= ticks; t++) {
      ylabels += '<text class="axis-lbl" x="' + (padL - 6) + '" y="' + (padT + (t / ticks) * ih + 3) + '" text-anchor="end">' + Math.round((maxV / ticks) * (ticks - t)) + "</text>";
    }
    box.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img">' +
      '<defs><linearGradient id="sarea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#e04a2d" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#e04a2d" stop-opacity="0"/></linearGradient></defs>' +
      grid + ylabels +
      '<polygon points="' + areaPts + '" fill="url(#sarea)"/>' +
      '<polyline points="' + linePts + '" fill="none" stroke="#e04a2d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + xlabels + "</svg>";
  }

  // 24 columns: check-ins by hour of the day (same shared bar-chart component).
  function renderHoursInto(sel, list) {
    var counts = []; for (var i = 0; i < 24; i++) counts.push(0);
    list.forEach(function (v) {
      var d = new Date(v.timestamp);
      if (!isNaN(d.getTime())) counts[d.getHours()]++;
    });
    var hourLabels = []; for (var h = 0; h < 24; h++) hourLabels.push(h);
    renderBarsSVG(sel, hourLabels, counts, {
      emptyText: "Sin check-ins en este periodo",
      maxBarWidth: 16,
      showLabel: function (i) { return i % 3 === 0; },
      tooltip: function (i, c) { return i + ":00 – " + c + " check-in" + (c === 1 ? "" : "s"); },
    });
  }

  function renderWeekdayInto(sel, list) {
    renderBarsSVG(sel, WEEKDAY_SHORT, weekdayCounts(list), {
      emptyText: "Sin check-ins en este periodo",
      tooltip: function (i, c) { return WEEKDAY_FULL[i] + ": " + c + " check-in" + (c === 1 ? "" : "s"); },
    });
  }

  // Leaderboard with medals for the top three (holodBot-style "Рейтинг за активністю").
  function renderRanking(sel, obj) {
    var el = $(sel);
    if (!el) return;
    var entries = Object.keys(obj).map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    if (!entries.length) { el.innerHTML = '<div class="empty">Sin check-ins en este periodo</div>'; return; }
    var medals = ["1.", "2.", "3."];
    var max = entries[0][1] || 1;
    el.innerHTML = entries.map(function (e, i) {
      var pct = Math.max(4, Math.round((e[1] / max) * 100));
      return '<div class="bl-row"><span class="bl-name">' + (medals[i] || "&nbsp;&nbsp;") + " " + esc(e[0]) + '</span>' +
        '<span class="bl-track"><span class="bl-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bl-val">' + e[1] + "</span></div>";
    }).join("");
  }

  function setKpiLabels(l1, s1, l2, s2, l3, s3, l4, s4) {
    $("#sk1-lbl").textContent = l1; $("#sk1-sub").textContent = s1;
    $("#sk2-lbl").textContent = l2; $("#sk2-sub").textContent = s2;
    $("#sk3-lbl").textContent = l3; $("#sk3-sub").textContent = s3;
    $("#sk4-lbl").textContent = l4; $("#sk4-sub").textContent = s4;
  }

  function renderStats() {
    var list = statsVisits();
    var personal = statsState.mode === "personal";
    $("#stats-company").classList.toggle("hidden", personal);
    $("#stats-personal").classList.toggle("hidden", !personal);
    $("#stats-worker").classList.toggle("hidden", !personal);

    // Shared computations.
    var activeDays = {};
    list.forEach(function (v) { var d = String(v.timestamp || "").slice(0, 10); if (d) activeDays[d] = 1; });
    var nDays = Object.keys(activeDays).length;
    var perDay = nDays ? (list.length / nDays) : 0;
    var activePoints = (state.points || []).filter(function (p) { return p.active; });
    var visitedIds = {};
    list.forEach(function (v) { if (v.pointId) visitedIds[String(v.pointId)] = (visitedIds[String(v.pointId)] || 0) + 1; });

    $("#sk1").textContent = list.length;
    $("#sk2").textContent = nDays;
    $("#sk3").textContent = nDays ? perDay.toFixed(1) : "–";

    $("#stats-line-title").textContent = personal
      ? "Actividad de " + (workerNameById(statsState.worker) || "…")
      : "Actividad de la empresa";
    renderLineInto("#stats-line", list, statsState.period);

    if (!personal) {
      // Company KPIs: points covered = active points visited ≥1 time in the period.
      var covered = activePoints.filter(function (p) { return visitedIds[String(p.id)]; }).length;
      setKpiLabels("Check-ins", "en el periodo", "Días activos", "con al menos 1 check-in",
        "Media por día activo", "check-ins", "Puntos cubiertos",
        ((window.LF && window.LF.t) ? window.LF.t("de") : "de") + " " + activePoints.length + " " + ((window.LF && window.LF.t) ? window.LF.t("activos") : "activos"));
      $("#sk4").textContent = covered;

      var byWorker = {}, byPoint = {};
      list.forEach(function (v) {
        var w = v.workerName || v.workerTelegramId; if (w) byWorker[w] = (byWorker[w] || 0) + 1;
        var p = v.pointName || v.pointId; if (p) byPoint[p] = (byPoint[p] || 0) + 1;
      });
      renderRanking("#stats-ranking", byWorker);
      renderBarlist("#stats-toppoints", byPoint);
      renderHoursInto("#stats-hours", list);
      renderWeekdayInto("#stats-weekday", list);
      renderAttention(list, visitedIds, activePoints);
    } else {
      renderPersonal(list, visitedIds);
    }
  }

  function workerNameById(wid) {
    var w = (state.workers || []).filter(function (x) { return String(x.workerId) === String(wid); })[0];
    return w ? (w.name || w.phone || w.workerId) : "";
  }

  // "Requiere atención" (holodBot's "Потребує уваги"): what the manager should fix.
  function renderAttention(list, visitedIds, activePoints) {
    var box = $("#stats-attn");
    if (!box) return;
    var activeWids = {};
    list.forEach(function (v) { var wid = ownerWidOf(v); if (wid) activeWids[wid] = 1; });
    var silentWorkers = (state.workers || []).filter(function (w) { return w.active && !activeWids[String(w.workerId)]; });
    var unvisited = activePoints.filter(function (p) { return !visitedIds[String(p.id)]; });
    var noGeo = activePoints.filter(function (p) { return !p.geolocated; });
    var unassigned = activePoints.filter(function (p) { return !p.workerId; });
    function names(arr, key) { return arr.slice(0, 4).map(function (i) { return esc(i[key] || i.id || ""); }).join(", ") + (arr.length > 4 ? "…" : ""); }
    function card(color, num, label, hint) {
      return '<div class="card attn ' + color + '"><div class="attn-num">' + num + '</div><div class="attn-lbl">' + label + '</div>' +
        (num ? '<div class="attn-hint">' + hint + '</div>' : '<div class="attn-hint ok">Todo en orden</div>') + '</div>';
    }
    box.innerHTML =
      card("rose",   unvisited.length,    "puntos sin visitar en el periodo", names(unvisited, "name")) +
      card("amber",  silentWorkers.length, "trabajadores sin actividad",       names(silentWorkers, "name")) +
      card("indigo", noGeo.length,        "puntos sin geolocalizar",          names(noGeo, "name")) +
      card("slate",  unassigned.length,   "puntos sin asignar",               names(unassigned, "name"));
  }

  // Personal view: coverage of assigned points, their top points, recent check-ins table.
  function renderPersonal(list, visitedIds) {
    var wid = statsState.worker;
    if (!wid) {
      setKpiLabels("Check-ins", "elige un trabajador", "Días activos", "—", "Media por día activo", "—", "Puntos distintos", "—");
      $("#sk1").textContent = "–"; $("#sk2").textContent = "–"; $("#sk3").textContent = "–"; $("#sk4").textContent = "–";
      $("#stats-p-coverage").innerHTML = '<div class="empty">Elige un trabajador arriba.</div>';
      $("#stats-p-points").innerHTML = '<div class="empty">Elige un trabajador arriba.</div>';
      $("#stats-p-table").innerHTML = '<div class="empty">Elige un trabajador arriba.</div>';
      return;
    }
    var distinct = Object.keys(visitedIds).length;
    setKpiLabels("Check-ins", "en el periodo", "Días activos", "con al menos 1 check-in",
      "Media por día activo", "check-ins", "Puntos distintos", "paradas diferentes visitadas");
    $("#sk4").textContent = distinct;

    // Assigned-point coverage: every assigned point with its visit count in the period.
    var assigned = (state.points || []).filter(function (p) { return p.active && String(p.workerId) === String(wid); });
    var cov = $("#stats-p-coverage");
    if (!assigned.length) cov.innerHTML = '<div class="empty">No tiene puntos asignados.</div>';
    else {
      var max = Math.max.apply(null, assigned.map(function (p) { return visitedIds[String(p.id)] || 0; }).concat([1]));
      cov.innerHTML = assigned.map(function (p) {
        var n = visitedIds[String(p.id)] || 0;
        var pct = Math.max(4, Math.round((n / max) * 100));
        return '<div class="bl-row"><span class="bl-name">' + esc(p.name || p.address || p.id) + '</span>' +
          '<span class="bl-track"><span class="bl-fill" style="width:' + (n ? pct : 0) + '%"></span></span>' +
          '<span class="bl-val">' + n + "</span></div>";
      }).join("");
    }

    var byPoint = {};
    list.forEach(function (v) { var p = v.pointName || v.pointId; if (p) byPoint[p] = (byPoint[p] || 0) + 1; });
    renderBarlist("#stats-p-points", byPoint);

    var rows = list.slice(0, 15);
    $("#stats-p-table").innerHTML = !rows.length
      ? '<div class="card card-pad"><div class="empty">Sin check-ins en este periodo.</div></div>'
      : tableWrap(["Hora", "Punto", "Fuente", "Fotos", "Nota"], rows.map(function (v) {
          return '<tr><td data-label="Hora">' + fmtTime(v.timestamp) + '</td><td data-label="Punto">' + esc(v.pointName || v.pointId) +
            '</td><td data-label="Fuente">' + (v.source === "pwa" ? "App" : "Bot") +
            '</td><td data-label="Fotos">' + (v.photoCount || 0) + '</td><td data-label="Nota" class="muted">' + esc(v.note || "") + "</td></tr>";
        }).join(""), true);
  }

  function fillStatsWorkers() {
    var sel = $("#stats-worker");
    if (!sel) return;
    sel.innerHTML = '<option value="">Elige un trabajador…</option>' + (state.workers || [])
      .filter(function (w) { return w.active; })
      .map(function (w) { return '<option value="' + esc(w.workerId) + '"' + (String(statsState.worker) === String(w.workerId) ? " selected" : "") + '>' + esc(w.name || w.phone || w.workerId) + "</option>"; }).join("");
  }

  async function loadStats() {
    try {
      var out = await Promise.all([api("/api/visits?limit=5000"), api("/api/points"), api("/api/workers")]);
      state.visits = out[0].visits || [];
      state.points = out[1].points || [];
      state.workers = out[2].workers || [];
      fillStatsWorkers();
      renderStats();
    } catch (e) { toast(e.message, true); }
  }

  // ── Bot ──────────────────────────────────────────────────────────────────────
  function setBadge(on) {
    var b = $("#bot-badge");
    b.className = "badge" + (on ? " ok" : "");
    // Text lives in its own span so CSS can collapse the badge to just the colored dot
    // on very narrow screens (see .badge-txt in the mobile media query) without touching JS.
    b.innerHTML = '<span class="dot ' + (on ? "dot-ok" : "dot-muted") + '"></span><span class="badge-txt"> Bot ' + (on ? "en línea" : "apagado") + '</span>';
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
      var link = s.username ? ' — <a href="https://t.me/' + esc(s.username) + '" target="_blank" rel="noopener">abrir ' + uname + "</a>" : "";
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

    // Worker self-enrolment deep-link (needs the running bot's @username + this company's code).
    var codeEl = $("#bot-code"); if (codeEl) codeEl.textContent = state.code || "—";
    var invite = $("#bot-invite");
    if (invite) invite.value = (on && s.username && state.code)
      ? "https://t.me/" + s.username + "?start=" + state.code
      : "";
  }
  async function loadBot() {
    try { renderBot(await api("/api/bot/status")); }
    catch (e) { $("#bot-status").textContent = e.message; }
  }
  async function startBot() {
    var btn = $("#bot-start"); btn.disabled = true; btn.textContent = "Encendiendo…";
    try {
      var s = await api("/api/bot/start", { method: "POST" });
      toast(s.username ? window.LF.tf("Bot @{u} en línea", { u: s.username }) : "Bot encendido");
      renderBot(s);
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '<svg class="ic"><use href="#i-power"/></svg> Encender bot'; }
  }
  async function stopBot() {
    if (!confirm(window.LF.t("¿Apagar el bot? Los trabajadores no podrán hacer check-in hasta que vuelva a encenderse."))) return;
    try { renderBot(await api("/api/bot/stop", { method: "POST" })); toast("Bot apagado"); }
    catch (e) { toast(e.message, true); }
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  var POINT_FIELDS  = [{ key: "name", label: "Nombre" }, { key: "address", label: "Dirección" }, { key: "workerPhone", label: "Teléfono del trabajador (opcional)" }, { key: "lat", label: "Latitud" }, { key: "lng", label: "Longitud" }, { key: "id", label: "ID (opcional)" }];
  var WORKER_FIELDS = [{ key: "telegramId", label: "ID de Telegram" }, { key: "name", label: "Nombre" }, { key: "phone", label: "Teléfono" }];
  var POINT_ORDER   = ["id", "name", "address", "lat", "lng", "workerPhone"];
  var WORKER_ORDER  = ["telegramId", "name", "phone"];
  var SYNONYMS = {
    name: ["name", "nombre", "назв", "title", "point", "stop", "магаз", "клієнт", "клиент"],
    address: ["address", "addr", "direcc", "адрес", "вулиц", "street", "місто", "город"],
    lat: ["lat", "latitud", "широт"], lng: ["lng", "lon", "long", "longitud", "довгот", "долгот"],
    id: ["id", "code", "codigo", "код", "артик"], telegramId: ["telegram", "tid", "chat", "telega"],
    phone: ["phone", "tel", "telefono", "моб", "тел", "номер"],
    workerPhone: ["worker", "trabaj", "empleado", "phone", "tel", "telefono", "моб", "тел", "номер"],
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
  // Own assigned points: a compact list with today's ✅ and the last time they were
  // visited — the worker's whole route at a glance, not just the check-in dropdown.
  function renderCheckinPoints(points) {
    var wrap = $("#ci-points-wrap");
    if (!wrap) return;
    if (!points.length) { wrap.innerHTML = '<div class="empty">Aún no tienes paradas asignadas.</div>'; return; }
    wrap.innerHTML = points.map(function (p) {
      var status = p.visitedToday
        ? '<span class="pill on">hecho hoy</span>'
        : '<span class="pill off">pendiente</span>';
      var last = p.lastVisit ? window.LF.tf("Última visita: {t}", { t: fmtTime(p.lastVisit) }) : window.LF.t("Sin visitas todavía");
      return '<div class="bl-row" style="flex-wrap:wrap">' +
        '<span class="bl-name" style="flex:1 1 auto;white-space:normal">' + esc(p.name || p.address || p.id) + '</span>' +
        status +
        '<div class="muted" style="flex-basis:100%;margin-top:2px;font-size:12px">' + last + '</div></div>';
    }).join("");
  }
  // Own recent check-ins: a small personal log (not the company-wide Visitas table).
  function renderCheckinRecent(recent) {
    var wrap = $("#ci-recent-wrap");
    if (!wrap) return;
    if (!recent.length) { wrap.innerHTML = '<div class="empty">Aún no tienes check-ins.</div>'; return; }
    wrap.innerHTML = recent.map(function (v) {
      var photo = v.photoCount ? ("📸 " + v.photoCount) : "";
      var map = v.mapsLink ? '<a href="' + esc(v.mapsLink) + '" target="_blank" rel="noopener">mapa ↗</a>' : "";
      return '<div class="bl-row" style="flex-wrap:wrap">' +
        '<span class="bl-name" style="flex:1 1 auto;white-space:normal">' + esc(v.pointName || v.pointId) + '</span>' +
        '<span class="muted">' + fmtTime(v.timestamp) + '</span>' +
        '<div class="muted" style="flex-basis:100%;margin-top:2px;font-size:12px">' + [photo, map].filter(Boolean).join(" · ") + '</div></div>';
    }).join("");
  }
  async function loadCheckinStats() {
    try {
      var s = await api("/api/checkin/stats");
      $("#ci-k-today").textContent = s.today || 0;
      $("#ci-k-week").textContent = s.week || 0;
      $("#ci-k-total").textContent = s.total || 0;
      $("#ci-k-streak").textContent = s.streakDays || 0;
      renderCheckinPoints(s.points || []);
      renderCheckinRecent(s.recent || []);
    } catch (e) { /* non-critical panels — leave the dashes */ }
  }
  async function loadCheckin() {
    var sel = $("#ci-point");
    try {
      // Only the stops assigned to THIS worker; a suffix marks those already done today.
      var data = await api("/api/checkin/points");
      var points = data.points || [];
      if (!points.length) { sel.innerHTML = '<option value="">No hay paradas asignadas</option>'; }
      else {
        sel.innerHTML = points.map(function (p) {
          var mark = p.visitedToday ? " " + window.LF.t("— hecho hoy") : "";
          return '<option value="' + esc(p.id) + '">' + esc(p.name || p.address || p.id) + esc(mark) + "</option>";
        }).join("");
      }
    } catch (e) { sel.innerHTML = '<option value="">' + esc(e.message) + "</option>"; }
    loadCheckinStats();
  }
  function captureLocation() {
    var st = $("#ci-geo-status");
    if (!navigator.geolocation) { st.textContent = "Este dispositivo no permite geolocalización."; return; }
    st.textContent = "Obteniendo ubicación…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      checkin.lat = String(pos.coords.latitude);
      checkin.lng = String(pos.coords.longitude);
      st.textContent = window.LF.tf("Ubicación capturada ({lat}, {lng}).", { lat: checkin.lat.slice(0, 8), lng: checkin.lng.slice(0, 8) });
    }, function () {
      st.textContent = "No se pudo obtener la ubicación. Permite el acceso e inténtalo de nuevo.";
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  // ── Offline queue ────────────────────────────────────────────────────────────
  // In the field there's often no signal. If a check-in fails to reach the server, we
  // stash it in localStorage and flush it automatically when connectivity returns.
  var QKEY = "starx-checkin-queue";
  function queueGet() { try { return JSON.parse(localStorage.getItem(QKEY) || "[]") || []; } catch (e) { return []; } }
  function queueSet(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} }
  function queueAdd(body) { var q = queueGet(); q.push(body); queueSet(q); }
  async function flushQueue() {
    var q = queueGet();
    if (!q.length) return;
    var left = [];
    for (var i = 0; i < q.length; i++) {
      try { await api("/api/checkin", { method: "POST", body: JSON.stringify(q[i]) }); }
      catch (e) { left.push(q[i]); } // keep the ones that still fail (network or geofence)
    }
    queueSet(left);
    var sent = q.length - left.length;
    if (sent > 0) { toast(window.LF.tf("{n} check-in(s) pendientes enviados", { n: sent })); if ($("#view-checkin.active")) loadCheckin(); }
  }

  async function submitCheckin() {
    var pointId = $("#ci-point").value;
    if (!pointId) { toast("Elige una parada.", true); return; }
    if (!checkin.lat || !checkin.lng) { toast("Captura tu ubicación primero.", true); return; }
    var btn = $("#ci-submit"); btn.disabled = true; btn.textContent = "Enviando…";
    var body = { pointId: pointId, lat: checkin.lat, lng: checkin.lng, note: $("#ci-note").value || "" };
    try {
      var file = $("#ci-photo").files[0];
      if (file) { body.photo = await fileToB64(file); body.photoContentType = file.type || "image/jpeg"; }
      // Offline → queue it now, don't lose the visit.
      if (navigator.onLine === false) {
        queueAdd(body);
        toast("Sin conexión: guardado. Se enviará al recuperar señal.");
      } else {
        try {
          await api("/api/checkin", { method: "POST", body: JSON.stringify(body) });
          toast("Check-in enviado");
        } catch (e) {
          // A network failure (TypeError from fetch) → queue; a real server error → surface it.
          if (e instanceof TypeError) { queueAdd(body); toast("Sin conexión: guardado. Se enviará al recuperar señal."); }
          else { throw e; }
        }
      }
      checkin = { lat: "", lng: "" };
      $("#ci-photo").value = ""; $("#ci-note").value = "";
      $("#ci-geo-status").textContent = "Aún no capturada.";
      loadCheckin();
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

    // A.2 — photo-required toggle
    var photoOn = !!(s && s.photoRequired);
    var phs = $("#photo-status");
    if (phs) phs.innerHTML = photoOn
      ? '<span class="dot dot-ok"></span> Obligatoria — no se acepta un check-in sin foto.'
      : '<span class="dot dot-muted"></span> Opcional — el trabajador puede fichar sin foto.';
    var pht = $("#photo-toggle");
    if (pht) pht.innerHTML = '<svg class="ic"><use href="#i-power"/></svg> ' + (photoOn ? "Hacer opcional" : "Hacer obligatoria");

    var connOn = !!(s && s.connectorEnabled);
    var key = (s && s.connectorKey) || "";
    var cs = $("#conn-status");
    if (cs) cs.textContent = connOn ? "activo" : "desactivado";
    var ch = $("#conn-hint");
    if (ch) ch.textContent = key
      ? "El conector acepta peticiones con la clave de abajo (cabecera X-API-Key)."
      : "";

    var ki = $("#conn-key");
    if (ki) ki.value = key;

    // Reflect the real key + this deployment's URL in the curl example.
    var curl = $("#conn-curl");
    if (curl) {
      var origin = location.origin || "https://starx.up.railway.app";
      curl.textContent = 'curl -H "X-API-Key: ' + (key || "TU_CLAVE") + '" \\\n  ' + origin + "/api/v1/visits?limit=500";
    }
  }
  async function generateConnectorKey() {
    if (!confirm(window.LF.t("¿Regenerar la clave? La anterior dejará de funcionar de inmediato."))) return;
    var btn = $("#conn-key-gen"); btn.disabled = true;
    try { renderSettings(await api("/api/connector/key", { method: "POST" })); toast("Clave regenerada"); }
    catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }
  function copyConnectorKey() {
    var ki = $("#conn-key");
    if (!ki || !ki.value) { toast("No hay clave para copiar.", true); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(ki.value).then(function () { toast("Clave copiada"); }, function () { ki.select(); });
    else { ki.select(); document.execCommand("copy"); toast("Clave copiada"); }
  }
  async function loadSettings() {
    try { renderSettings(await api("/api/settings")); }
    catch (e) { /* ignore for non-critical panel */ }
    loadBilling();
  }

  // ── Billing / subscription panel ─────────────────────────────────────────────
  var PLAN_PRICES = { basic: "Básico", pro: "Pro", business: "Business" };
  function renderBilling(b) {
    var card = $("#billing-card");
    if (!card) return;
    card.style.display = "";
    $("#bill-plan").textContent = b.planLabel || b.plan || "—";
    var status = b.status || "active";
    var stEl = $("#bill-status");
    var live = status === "active" || status === "trialing";
    stEl.className = "pill " + (live ? "on" : "off");
    stEl.textContent = { active: "activa", trialing: "prueba", past_due: "pago pendiente", canceled: "cancelada" }[status] || status;

    var detail = "";
    if (status === "trialing" && b.trialEndsAt) {
      var days = Math.max(0, Math.ceil((Date.parse(b.trialEndsAt) - Date.now()) / 864e5));
      detail = window.LF.tf("Prueba gratuita — {n} día(s) restantes.", { n: days });
    } else if (status === "past_due" && b.canWrite && b.graceEndsAt) {
      var gdays = Math.max(0, Math.ceil((Date.parse(b.graceEndsAt) - Date.now()) / 864e5));
      detail = window.LF.tf("Pago pendiente — actualiza tu tarjeta en {n} día(s) o la cuenta pasará a solo-lectura.", { n: gdays });
    } else if (!b.canWrite) {
      detail = "Suscripción inactiva: la cuenta está en solo-lectura. Reactívala para volver a registrar datos.";
    } else {
      var lim = b.limits || {};
      detail = "Límites: " + (lim.maxWorkers == null ? "∞" : lim.maxWorkers) + " trabajadores · " +
        (lim.maxPoints == null ? "∞" : lim.maxPoints) + " puntos.";
    }
    $("#bill-detail").textContent = detail;

    var actions = $("#bill-actions"), hint = $("#bill-hint");
    if (!b.enabled) {
      actions.innerHTML = "";
      hint.textContent = "El cobro no está configurado en este servidor (modo autoalojado).";
      return;
    }
    hint.textContent = "";
    if (b.hasCustomer) {
      actions.innerHTML = '<button class="btn" data-bill-portal>Gestionar suscripción</button>';
    } else {
      actions.innerHTML = ['basic', 'pro', 'business'].map(function (p) {
        return '<button class="btn ghost" data-bill-plan="' + p + '">Suscribirme — ' + PLAN_PRICES[p] + '</button>';
      }).join("");
    }
  }
  async function loadBilling() {
    try { renderBilling(await api("/api/billing")); }
    catch (e) { var c = $("#billing-card"); if (c) c.style.display = "none"; }
  }
  async function billingCheckout(plan) {
    try { var r = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: plan }) }); if (r.url) location.href = r.url; }
    catch (e) { toast(e.message, true); }
  }
  async function billingPortal() {
    try { var r = await api("/api/billing/portal", { method: "POST" }); if (r.url) location.href = r.url; }
    catch (e) { toast(e.message, true); }
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
  async function togglePhoto() {
    var btn = $("#photo-toggle"); btn.disabled = true;
    try {
      var cur = await api("/api/settings");
      var next = await api("/api/settings", { method: "POST", body: JSON.stringify({ photoRequired: !cur.photoRequired }) });
      renderSettings(next);
      toast(next.photoRequired ? "Foto obligatoria activada" : "Foto ahora opcional");
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  // ── Account (password change) ────────────────────────────────────────────────
  async function changePassword() {
    var cur = $("#acct-cur").value, n1 = $("#acct-new").value, n2 = $("#acct-new2").value;
    if (!cur || !n1) { toast("Rellena la contraseña actual y la nueva.", true); return; }
    if (n1 !== n2) { toast("Las contraseñas nuevas no coinciden.", true); return; }
    if (n1.length < 6) { toast("La nueva contraseña debe tener al menos 6 caracteres.", true); return; }
    var btn = $("#acct-pw-save"); btn.disabled = true;
    try {
      await api("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword: cur, newPassword: n1 }) });
      toast("Contraseña actualizada");
      $("#acct-cur").value = ""; $("#acct-new").value = ""; $("#acct-new2").value = "";
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  // Full data export: a plain navigation so the browser's normal download flow (and the
  // session cookie) just works — no need for fetch+blob plumbing.
  function exportAllData() { window.location.href = "/api/export"; }

  // ── Onboarding wizard (first-run guide; also reopenable from Ajustes) ────────
  var OB_STEPS = [
    { icon: "i-check", title: "Bienvenido a StarX", desc: "Te llevamos por los primeros pasos para dejar tu empresa lista para operar. Son solo un par de minutos." },
    { icon: "i-import", title: "Importa tus puntos", desc: "Sube un Excel/CSV con tus paradas, o añádelas una a una. Sin coordenadas — se rellenan solas en el primer check-in.", action: { label: "Ir a Conexiones", view: "import" } },
    { icon: "i-users", title: "Añade a tus trabajadores", desc: "Cárgalos con su teléfono. Se enlazan solos al compartir su número en el bot — sin contraseñas que gestionar.", action: { label: "Ir a Trabajadores", view: "workers" } },
    { icon: "i-send", title: "Activa el check-in", desc: "Enciende el bot de Telegram, la app web (PWA), o ambos, desde Ajustes. Tus trabajadores fichan con GPS y foto en segundos.", action: { label: "Ir a Ajustes", view: "settings" } },
    { icon: "i-globe", title: "Conecta tu sistema (opcional)", desc: "En Conexiones tienes tu clave de API única para leer las visitas o cargar tu catálogo desde tu propio software.", action: { label: "Ir a Conexiones", view: "import" } },
  ];
  var obIdx = 0;
  function renderOnboard() {
    var s = OB_STEPS[obIdx];
    $("#ob-icon").innerHTML = '<svg class="ic"><use href="#' + s.icon + '"/></svg>';
    $("#ob-title").textContent = s.title;
    $("#ob-desc").textContent = s.desc;
    $("#ob-dots").innerHTML = OB_STEPS.map(function (_, i) { return '<span class="ob-dot' + (i === obIdx ? " on" : "") + '"></span>'; }).join("");
    $("#ob-back").classList.toggle("hidden", obIdx === 0);
    var gotoBtn = $("#ob-goto");
    if (s.action) { gotoBtn.classList.remove("hidden"); gotoBtn.textContent = s.action.label; }
    else gotoBtn.classList.add("hidden");
    $("#ob-next").textContent = (obIdx === OB_STEPS.length - 1) ? "Empezar" : "Siguiente";
  }
  function openOnboarding() { obIdx = 0; renderOnboard(); $("#onboard").classList.remove("hidden"); }
  async function closeOnboarding(markSeen) {
    $("#onboard").classList.add("hidden");
    if (markSeen) { try { await api("/api/settings", { method: "POST", body: JSON.stringify({ onboardingSeen: true }) }); } catch (e) {} }
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

  function setThemeIcon(dark) {
    var el = $("#theme-icon");
    if (el) el.innerHTML = '<use href="#' + (dark ? "i-sun" : "i-moon") + '"/>';
  }
  function toggleTheme() {
    var dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("starx-theme", dark ? "dark" : "light"); } catch (e) {}
    setThemeIcon(dark);
    if (map) { applyMapTheme(); setTimeout(function () { map.invalidateSize(); }, 60); }
  }

  async function init() {
    // Theme icon initial state
    setThemeIcon(document.documentElement.classList.contains("dark"));
    $("#theme-toggle").onclick = toggleTheme;

    // Sidebar nav
    $$(".nav").forEach(function (t) { t.onclick = function () { showView(t.dataset.view); }; });

    // Brand mark in the topbar doubles as "home" — back to the dashboard from anywhere
    // (worker sessions have no sidebar nav to begin with, so this is a no-op for them).
    var brandHome = $("#brand-home");
    if (brandHome) {
      brandHome.onclick = function () { if (state.role !== "worker") showView("dashboard"); };
      brandHome.onkeydown = function (e) { if ((e.key === "Enter" || e.key === " ") && state.role !== "worker") { e.preventDefault(); showView("dashboard"); } };
    }

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
      var cp = t.closest("[data-check-point]"); if (cp) { selectedPoints[cp.dataset.checkPoint] = cp.checked; updateBulkbar(); return; }
      var th = t.closest(".thumb");             if (th) return openLightbox(th.dataset.full);
      var vd = t.closest("[data-visit-detail]"); if (vd) return openVisitDetail(vd.dataset.visitDetail);
      var ep = t.closest("[data-edit-point]");  if (ep) return editPoint(+ep.dataset.editPoint);
      var dp = t.closest("[data-del-point]");   if (dp) return delPoint(+dp.dataset.delPoint);
      var ew = t.closest("[data-edit-worker]"); if (ew) return editWorker(+ew.dataset.editWorker);
      var dw = t.closest("[data-del-worker]");  if (dw) return delWorker(+dw.dataset.delWorker);
      var apd = t.closest("[data-add-pending]"); if (apd) return addFromPending(apd.dataset.addPending, apd.dataset.addPendingName);
      var xpd = t.closest("[data-dismiss-pending]"); if (xpd) return dismissPending(xpd.dataset.dismissPending);
      var bpl = t.closest("[data-bill-plan]"); if (bpl) return billingCheckout(bpl.dataset.billPlan);
      var bpo = t.closest("[data-bill-portal]"); if (bpo) return billingPortal();
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
    var dlBtn = $("#download-visits"); if (dlBtn) dlBtn.onclick = downloadVisitsCsv;

    // Dashboard: worker / source / date filters (re-render charts + map from cached recent).
    var dW = $("#dash-worker"); if (dW) dW.onchange = function () { dashFilters.worker = this.value; renderDashWidgets(); };
    var dS = $("#dash-source"); if (dS) dS.onchange = function () { dashFilters.source = this.value; renderDashWidgets(); };
    var dF = $("#dash-from");   if (dF) dF.onchange = function () { dashFilters.from = this.value; renderDashWidgets(); };
    var dT = $("#dash-to");     if (dT) dT.onchange = function () { dashFilters.to = this.value; renderDashWidgets(); };
    var dC = $("#dash-clear");
    if (dC) dC.onclick = function () {
      dashFilters = { worker: "", source: "", from: "", to: "" };
      if (dW) dW.value = ""; if (dS) dS.value = ""; if (dF) dF.value = ""; if (dT) dT.value = "";
      renderDashWidgets();
    };

    // Points: search + worker filter + bulk assign (re-render from cached state.points).
    var pSearch = $("#points-search");
    if (pSearch) pSearch.oninput = function () { filters.pointsQ = this.value; loadPointsFromState(); };
    var pWorker = $("#points-worker-filter");
    if (pWorker) pWorker.onchange = function () { filters.pointsWorker = this.value; loadPointsFromState(); };
    var bAssign = $("#points-bulk-assign"); if (bAssign) bAssign.onclick = bulkAssign;
    var bClear = $("#points-bulk-clear");
    if (bClear) bClear.onclick = function () { selectedPoints = {}; loadPointsFromState(); };

    // Workers: search.
    var wSearch = $("#workers-search");
    if (wSearch) wSearch.oninput = function () { filters.workersQ = this.value; loadWorkers(); };

    // Visits: search + date range (re-render from cached state.visits, no refetch).
    var vSearch = $("#visits-search");
    if (vSearch) vSearch.oninput = function () { filters.visitsQ = this.value; renderVisits(); };
    var vFrom = $("#visits-from");
    if (vFrom) vFrom.onchange = function () { filters.visitsFrom = this.value; renderVisits(); };
    var vTo = $("#visits-to");
    if (vTo) vTo.onchange = function () { filters.visitsTo = this.value; renderVisits(); };
    var vClear = $("#visits-clear-dates");
    if (vClear) vClear.onclick = function () {
      filters.visitsFrom = ""; filters.visitsTo = "";
      if (vFrom) vFrom.value = ""; if (vTo) vTo.value = "";
      renderVisits();
    };

    // Statistics
    var sReload = $("#stats-reload"); if (sReload) sReload.onclick = loadStats;
    var sPeriod = $("#stats-period");
    if (sPeriod) sPeriod.onchange = function () { statsState.period = parseInt(this.value, 10) || 0; renderStats(); };
    var sWorker = $("#stats-worker");
    if (sWorker) sWorker.onchange = function () { statsState.worker = this.value; renderStats(); };
    $$("#stats-mode .seg-btn").forEach(function (b) {
      b.onclick = function () {
        statsState.mode = b.dataset.mode;
        $$("#stats-mode .seg-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
        renderStats();
      };
    });

    // Re-render the active view when the language changes so JS-built strings update too.
    window.addEventListener("lf-lang", function () {
      var a = document.querySelector(".nav.active");
      if (a && a.dataset.view) showView(a.dataset.view);
      else if (state.role === "worker") loadCheckin();
    });

    // Bot
    $("#bot-start").onclick = startBot;
    $("#bot-stop").onclick = stopBot;
    var inviteCopy = $("#bot-invite-copy");
    if (inviteCopy) inviteCopy.onclick = function () {
      var v = $("#bot-invite"); if (!v || !v.value) { toast("Enciende el bot para generar el enlace.", true); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(v.value).then(function () { toast("Enlace copiado"); }, function () { v.select(); });
      else { v.select(); document.execCommand("copy"); toast("Enlace copiado"); }
    };

    // Check-in (worker PWA)
    $("#ci-geo").onclick = captureLocation;
    $("#ci-submit").onclick = submitCheckin;

    // Settings (PWA toggle + connector key)
    var pwaBtn = $("#pwa-toggle"); if (pwaBtn) pwaBtn.onclick = togglePwa;
    var photoBtn = $("#photo-toggle"); if (photoBtn) photoBtn.onclick = togglePhoto;
    var genBtn = $("#conn-key-gen"); if (genBtn) genBtn.onclick = generateConnectorKey;
    var cpyBtn = $("#conn-key-copy"); if (cpyBtn) cpyBtn.onclick = copyConnectorKey;
    var pwSaveBtn = $("#acct-pw-save"); if (pwSaveBtn) pwSaveBtn.onclick = changePassword;
    var exportBtn = $("#acct-export"); if (exportBtn) exportBtn.onclick = exportAllData;
    var obBtn = $("#settings-onboard-btn"); if (obBtn) obBtn.onclick = function () { openOnboarding(); };

    // Onboarding wizard controls
    $("#ob-skip").onclick = function () { closeOnboarding(true); };
    $("#ob-back").onclick = function () { if (obIdx > 0) { obIdx--; renderOnboard(); } };
    $("#ob-next").onclick = function () { if (obIdx < OB_STEPS.length - 1) { obIdx++; renderOnboard(); } else closeOnboarding(true); };
    $("#ob-goto").onclick = function () {
      var s = OB_STEPS[obIdx];
      closeOnboarding(true);
      if (s.action) showView(s.action.view);
    };

    // Import
    $("#imp-target").onchange = renderMapping;
    $("#imp-file").onchange = async function (e) {
      var file = e.target.files[0];
      if (!file) return;
      try { var b64 = await fileToB64(file); parsed = await api("/api/import/parse", { method: "POST", body: JSON.stringify({ data: b64 }) }); renderMapping(); toast(window.LF.tf("Analizadas {n} filas", { n: parsed.count })); }
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
      try { var res = await api("/api/import/" + target, { method: "POST", body: JSON.stringify({ rows: rows }) }); toast(window.LF.tf("Importadas {n} filas", { n: res.written })); parsed = null; $("#imp-file").value = ""; renderMapping(); }
      catch (err) { toast(err.message, true); }
    };
    $("#setup-btn").onclick = async function () {
      if (!confirm(window.LF.t("¿Crear las pestañas workers / points / visits en tu hoja conectada?"))) return;
      try { var res = await api("/api/setup", { method: "POST" }); toast(res.created && res.created.length ? window.LF.tf("Creadas: {list}", { list: res.created.join(", ") }) : "La hoja ya está lista"); }
      catch (e) { toast(e.message, true); }
    };

    // Who am I
    try {
      var me = await api("/api/me");
      $("#company").textContent = me.company ? "· " + me.company : "";
      $("#user").textContent = me.name || "";
      state.role = me.role; state.isAdmin = me.role === "admin"; state.code = me.code || "";
      state.isDefaultTenant = !!me.isDefaultTenant;
      var acctCo = $("#acct-company"); if (acctCo) acctCo.textContent = me.company || "—";
      // The env-configured "default" tenant's password lives in PLATFORM_PASSWORD, not the
      // DB, so changing it here would be silently lost on the next restart — lock the form.
      var pwWrap = $("#acct-pw-wrap"), pwLocked = $("#acct-pw-locked");
      if (pwWrap && pwLocked) { pwWrap.classList.toggle("hidden", state.isDefaultTenant); pwLocked.classList.toggle("hidden", !state.isDefaultTenant); }
    } catch (e) { /* api() already redirects on 401 */ }
    applyAdmin();

    // Workers land straight on the check-in screen with a stripped-down UI.
    if (state.role === "worker") {
      applyWorkerMode();
      var hello = $("#ci-hello");
      if (hello && state.role) {
        var uname = $("#user").textContent;
        hello.textContent = uname
          ? window.LF.tf("Hola, {name}. Elige tu parada, comparte tu ubicación y añade una foto.", { name: uname })
          : window.LF.t("Hola. Elige tu parada, comparte tu ubicación y añade una foto.");
      }
      showView("checkin");
      return;
    }

    // First-run guide: show automatically once per company, for an admin, until they
    // skip or finish it (also reopenable anytime from Ajustes).
    if (state.isAdmin) {
      try { var ob = await api("/api/settings"); if (!ob.onboardingSeen) openOnboarding(); } catch (e) {}
    }

    loadDashboard();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/platform/assets/sw.js").catch(function () {});
  // Flush any queued offline check-ins when the connection returns (and once on load).
  window.addEventListener("online", flushQueue);
  document.addEventListener("DOMContentLoaded", function () { init(); setTimeout(flushQueue, 1500); });
})();
