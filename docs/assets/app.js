/* StarX Connect — MVP mockup logic.
   Front-end only: hash routing, theme toggle, dummy data rendering and fake
   "success" flows for the API / import / deploy actions. No network calls. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ── Toast ─────────────────────────────────────────────────────────── */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ── Theme toggle (shared pattern with the ODX platform) ──────────── */
  (function () {
    var KEY = 'starx-theme';
    function paint() {
      var d = document.documentElement.classList.contains('dark');
      $('theme-icon').textContent = d ? '☀️' : '🌙';
    }
    paint();
    $('theme-toggle').addEventListener('click', function () {
      var d = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem(KEY, d ? 'dark' : 'light'); } catch (e) {}
      paint();
    });
  })();

  /* ── Nav drawer (mobile) ───────────────────────────────────────────── */
  (function () {
    function setOpen(open) { document.body.classList.toggle('nav-open', open); }
    $('nav-toggle').addEventListener('click', function () { setOpen(!document.body.classList.contains('nav-open')); });
    $('nav-close').addEventListener('click', function () { setOpen(false); });
    $('nav-backdrop').addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('hashchange', function () { setOpen(false); });
  })();

  /* ── Hash router ───────────────────────────────────────────────────── */
  var VIEWS = ['dashboard', 'integration', 'tools'];
  function route() {
    var v = (location.hash || '#/dashboard').replace('#/', '');
    if (VIEWS.indexOf(v) === -1) v = 'dashboard';
    VIEWS.forEach(function (name) {
      $('view-' + name).classList.toggle('active', name === v);
    });
    document.querySelectorAll('.nav[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === v);
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();

  /* ══════════════════ DASHBOARD (dummy data) ══════════════════ */

  // 30 days of fake visit counts (weekends dip)
  var DAILY = [52,61,58,47,66,21,12, 55,63,59,71,68,24,15, 62,57,74,69,73,26,14, 66,72,64,78,70,28,17, 75,47];
  var DAY_LABELS = (function () {
    var out = [], names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (var i = 0; i < 30; i++) out.push(names[(i + 3) % 7]); // arbitrary anchor
    return out;
  })();

  var WORKERS = [
    { name: 'Carlos M.', v: 142 }, { name: 'Olena K.', v: 128 }, { name: 'Javier R.', v: 117 },
    { name: 'Ana T.', v: 96 }, { name: 'Dmytro S.', v: 84 }, { name: 'Lucía P.', v: 61 }
  ];
  var POINTS = [
    { name: 'Mercado Central', v: 48 }, { name: 'Bar La Plaza', v: 41 }, { name: 'Kiosko Ronda', v: 37 },
    { name: 'Super Delta', v: 30 }, { name: 'Café Norte', v: 24 }, { name: 'Estanco Sur', v: 19 }
  ];
  var RECENT = [
    ['17:42', 'Carlos M.', 'Mercado Central', '37.3891, -5.9845', 3],
    ['17:15', 'Olena K.', 'Bar La Plaza', '40.4155, -3.7074', 2],
    ['16:58', 'Javier R.', 'Super Delta', '41.3809, 2.1896', 4],
    ['16:31', 'Ana T.', 'Café Norte', '39.4699, -0.3763', 1],
    ['16:02', 'Dmytro S.', 'Kiosko Ronda', '41.3851, 2.1734', 2],
    ['15:47', 'Lucía P.', 'Estanco Sur', '37.9922, -1.1307', 3],
    ['15:20', 'Carlos M.', 'Bar La Plaza', '40.4168, -3.7038', 2]
  ];

  function renderBarChart(days) {
    var data = DAILY.slice(-days);
    var labels = DAY_LABELS.slice(-days);
    var W = 900, H = 220, padL = 34, padB = 22, padT = 10;
    var max = Math.max.apply(null, data) * 1.15;
    var iw = (W - padL) / data.length;
    var bw = Math.min(iw * 0.62, 46);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    s += '<defs><linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1">' +
         '<stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs>';
    // horizontal grid lines + axis labels
    for (var g = 0; g <= 4; g++) {
      var yv = Math.round(max / 4 * g);
      var y = H - padB - (H - padB - padT) * (g / 4);
      s += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '"/>';
      s += '<text class="axis-lbl" x="' + (padL - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + yv + '</text>';
    }
    // bars
    for (var i = 0; i < data.length; i++) {
      var h = (H - padB - padT) * (data[i] / max);
      var x = padL + iw * i + (iw - bw) / 2;
      var yb = H - padB - h;
      s += '<rect x="' + x + '" y="' + yb + '" width="' + bw + '" height="' + h + '" rx="4" fill="url(#vGrad)" opacity="0.92"><title>' + data[i] + ' visits</title></rect>';
      // x labels: thin out when many bars
      var every = days > 14 ? 5 : (days > 7 ? 2 : 1);
      if (i % every === 0) {
        s += '<text class="axis-lbl" x="' + (padL + iw * i + iw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + labels[i] + '</text>';
      }
    }
    s += '</svg>';
    $('chart-visits').innerHTML = s;

    // KPI numbers follow the selected range
    var total = data.reduce(function (a, b) { return a + b; }, 0);
    $('k-total').textContent = total.toLocaleString('en-US');
  }

  function renderBarlist(el, items) {
    var max = items[0].v;
    el.innerHTML = items.map(function (it) {
      return '<div class="bl-row"><span class="bl-name">' + it.name + '</span>' +
        '<span class="bl-track"><span class="bl-fill" style="width:' + Math.round(it.v / max * 100) + '%"></span></span>' +
        '<span class="bl-val">' + it.v + '</span></div>';
    }).join('');
  }

  function renderVisits() {
    $('visits-body').innerHTML = RECENT.map(function (r) {
      return '<tr>' +
        '<td class="mono" data-label="Time">' + r[0] + '</td>' +
        '<td data-label="Worker">' + r[1] + '</td>' +
        '<td data-label="Point">' + r[2] + '</td>' +
        '<td class="mono" data-label="GPS">' + r[3] + '</td>' +
        '<td data-label="Photos">' + r[4] + ' 📷</td>' +
        '<td data-label="Status"><span class="badge ok"><span class="dot dot-ok"></span> Verified</span></td>' +
        '</tr>';
    }).join('');
  }

  renderBarChart(14);
  renderBarlist($('bl-workers'), WORKERS);
  renderBarlist($('bl-points'), POINTS);
  renderVisits();

  document.querySelectorAll('#range-tabs .tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#range-tabs .tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderBarChart(parseInt(b.dataset.range, 10));
    });
  });

  /* ══════════════════ DATA INTEGRATION (fake flows) ══════════════════ */

  // API key generator — cosmetic only
  function fakeKey() {
    var abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var s = 'sx_live_';
    for (var i = 0; i < 32; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }
  $('gen-key').addEventListener('click', function () {
    var k = fakeKey();
    var el = $('api-key');
    el.textContent = k;
    el.classList.remove('empty');
    $('copy-key').classList.remove('hidden');
    toast('New API key generated', 'ok');
  });
  $('copy-key').addEventListener('click', function () {
    var k = $('api-key').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(k).catch(function () {});
    toast('API key copied to clipboard', 'ok');
  });

  // Fake "test connection": short spinner, then success panel
  function busy(btn, label, done) {
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> ' + label;
    setTimeout(function () {
      btn.disabled = false;
      btn.innerHTML = orig;
      done();
    }, 1200);
  }
  $('test-conn').addEventListener('click', function () {
    var base = $('api-base').value.trim() || 'https://api.yourcompany.com/v1';
    busy($('test-conn'), 'Testing…', function () {
      $('api-success-url').textContent = base;
      $('api-success').classList.remove('hidden');
      toast('Connection verified — 86 points, 12 workers', 'ok');
    });
  });

  // Dropzone — purely visual, never reads the file
  var dz = $('dropzone');
  function fileChosen(name) {
    dz.classList.add('has-file');
    $('dz-title').textContent = name;
    $('dz-desc').textContent = '24 KB · ready to process';
    $('imp-preview').classList.remove('hidden');
    $('imp-success').classList.add('hidden');
    $('imp-success-file').textContent = name;
  }
  dz.addEventListener('click', function () { fileChosen('points.xlsx'); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileChosen('points.xlsx'); } });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault();
    dz.classList.remove('drag');
    var name = (e.dataTransfer.files && e.dataTransfer.files[0] && e.dataTransfer.files[0].name) || 'points.xlsx';
    fileChosen(name);
  });

  $('imp-clear').addEventListener('click', function () {
    dz.classList.remove('has-file');
    $('dz-title').innerHTML = 'Drag &amp; drop your file here';
    $('dz-desc').textContent = 'or click to browse · .xlsx, .xls, .csv up to 10 MB';
    $('imp-preview').classList.add('hidden');
    $('imp-success').classList.add('hidden');
    $('imp-fill').style.width = '0';
  });

  // Fake processing: animated progress bar → success panel
  $('imp-run').addEventListener('click', function () {
    var bar = $('imp-progress'), fill = $('imp-fill'), btn = $('imp-run');
    bar.classList.remove('hidden');
    btn.disabled = true;
    var p = 0;
    var iv = setInterval(function () {
      p = Math.min(p + 12 + Math.random() * 18, 100);
      fill.style.width = p + '%';
      if (p >= 100) {
        clearInterval(iv);
        setTimeout(function () {
          bar.classList.add('hidden');
          fill.style.width = '0';
          btn.disabled = false;
          $('imp-preview').classList.add('hidden');
          $('imp-success').classList.remove('hidden');
          toast('86 rows imported successfully', 'ok');
        }, 350);
      }
    }, 180);
  });

  /* ══════════════════ TOOLS & DEPLOYMENT (fake flows) ══════════════════ */

  function setBadge(el, cls, dot, label) {
    el.className = 'badge' + (cls ? ' ' + cls : '');
    el.innerHTML = '<span class="dot ' + dot + '"></span> ' + label;
  }

  $('deploy-bot').addEventListener('click', function () {
    busy($('deploy-bot'), 'Deploying…', function () {
      setBadge($('bot-status'), 'ok', 'dot-ok', 'Live');
      $('bot-success').classList.remove('hidden');
      $('bot-success').querySelector('.mono').textContent = $('bot-user').value.trim() || '@AcmeRoutesBot';
      toast('Telegram bot deployed', 'ok');
    });
  });

  $('deploy-app').addEventListener('click', function () {
    busy($('deploy-app'), 'Generating…', function () {
      var sub = ($('app-sub').value.trim() || 'acme').toLowerCase();
      setBadge($('app-status'), 'ok', 'dot-ok', 'Live');
      $('app-url').textContent = 'https://' + sub + '.starx.app';
      $('app-success').classList.remove('hidden');
      toast('Web app generated at ' + sub + '.starx.app', 'ok');
    });
  });

  // Accent color swatches (visual selection only)
  document.querySelectorAll('#swatches .swatch').forEach(function (s) {
    s.addEventListener('click', function () {
      document.querySelectorAll('#swatches .swatch').forEach(function (x) { x.classList.remove('active'); });
      s.classList.add('active');
      toast('Accent color: ' + s.dataset.c);
    });
  });

  // Logo dropzone — visual only
  var ld = $('logo-drop');
  function logoChosen(name) { ld.classList.add('has-file'); $('logo-title').textContent = name + ' ✓'; }
  ld.addEventListener('click', function () { logoChosen('logo.svg'); });
  ld.addEventListener('dragover', function (e) { e.preventDefault(); ld.classList.add('drag'); });
  ld.addEventListener('dragleave', function () { ld.classList.remove('drag'); });
  ld.addEventListener('drop', function (e) {
    e.preventDefault();
    ld.classList.remove('drag');
    var name = (e.dataTransfer.files && e.dataTransfer.files[0] && e.dataTransfer.files[0].name) || 'logo.svg';
    logoChosen(name);
  });
})();
