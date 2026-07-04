// StarX smoke test — boots the Express app on the in-memory datasource and exercises
// the core flows end to end over real HTTP, with NO network and NO credentials.
//
//   node test/server_smoke.js        (or: npm test)
//
// Covers: manager login → CRUD reads, worker registration by phone (datasource),
// PWA toggle + worker login + web check-in (with point geolocation), and the
// client connector (push workers/points, pull visits) gated by X-API-Key.
process.env.DATASOURCE = "memory";
process.env.SESSION_SECRET = "test-secret";
process.env.PLATFORM_PASSWORD = "admin";
process.env.INTEGRATION_API_KEY = "test-key";
delete process.env.TELEGRAM_TOKEN;

const assert = require("assert");
const { createApp } = require("../src/server/index");

let passed = 0;
function ok(name) { console.log("  ✓ " + name); passed++; }

// Minimal cookie jar so we can carry the session between requests.
function makeClient(base) {
  let cookie = "";
  return async function (method, path, body, headers) {
    const opts = { method, headers: Object.assign({}, headers) };
    if (cookie) opts.headers.Cookie = cookie;
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch(base + path, opts);
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, cookie };
  };
}

// A login client that does NOT follow redirects (so we can read the session cookie
// off the 302 from POST /auth/login).
function makeRawClient(base) {
  return async function (method, path, body, headers) {
    const opts = { method, headers: Object.assign({}, headers), redirect: "manual" };
    if (body !== undefined && typeof body === "string") { opts.headers["Content-Type"] = "application/x-www-form-urlencoded"; opts.body = body; }
    const res = await fetch(base + path, opts);
    return { status: res.status, cookie: res.headers.get("set-cookie") };
  };
}

async function main() {
  const app = createApp();
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ── Manager login (form post → 302 + cookie) ──────────────────────────────
    const raw = makeRawClient(base);
    const login = await raw("POST", "/auth/login", "password=admin");
    assert.strictEqual(login.status, 302, "login should redirect");
    assert.ok(login.cookie && /starx_session=/.test(login.cookie), "login sets session cookie");
    ok("manager logs in with password");

    const mgr = makeClient(base);
    mgr._cookie = login.cookie;
    // Reuse the manager cookie explicitly for the JSON client.
    const mgrReq = async (m, p, b, h) => {
      h = Object.assign({ Cookie: login.cookie.split(";")[0] }, h);
      return mgr(m, p, b, h);
    };

    const me = await mgrReq("GET", "/api/me");
    assert.strictEqual(me.body.role, "admin", "me is admin");
    ok("GET /api/me returns admin");

    const pts = await mgrReq("GET", "/api/points");
    assert.ok(Array.isArray(pts.body.points) && pts.body.points.length >= 1, "seed points present");
    ok("GET /api/points lists seed data");

    // P3 (Novus Lukyanivka) is seeded WITHOUT coordinates.
    const p3 = pts.body.points.find(p => p.id === "P3");
    assert.ok(p3 && !p3.geolocated, "P3 starts not geolocated");
    ok("seed point P3 has no coordinates yet");

    // ── Connector: gated by X-API-Key ─────────────────────────────────────────
    const anon = makeClient(base);
    const noKey = await anon("POST", "/api/v1/points", { points: [{ name: "X", address: "Y" }] });
    assert.strictEqual(noKey.status, 401, "connector rejects missing key");
    ok("connector rejects requests without X-API-Key");

    const key = { "X-API-Key": "test-key" };
    const pushW = await anon("POST", "/api/v1/workers", { workers: [{ name: "Api Worker", phone: "+34600111222" }] }, key);
    assert.strictEqual(pushW.body.written, 1, "one worker pushed");
    ok("connector pushes a worker (X-API-Key)");

    const pushP = await anon("POST", "/api/v1/points", { points: [{ id: "PX", name: "Api Point", address: "Somewhere" }] }, key);
    assert.strictEqual(pushP.body.written, 1, "one point pushed");
    ok("connector pushes a point without coordinates");

    // ── Worker registration by phone (datasource seam) ────────────────────────
    const { forTenant } = require("../src/server/datasource");
    const { defaultTenant } = require("../src/server/config");
    const ds = forTenant(defaultTenant());
    const found = await ds.findWorkerByPhone("+34 600 111 222"); // tolerant match
    assert.ok(found && found.name === "Api Worker", "worker found by phone");
    await ds.linkWorkerTelegram(found.row, "555000111");
    const linked = (await ds.listWorkers()).find(w => w.row === found.row);
    assert.strictEqual(linked.telegramId, "555000111", "telegram id linked");
    ok("worker registers by phone → telegram id linked");

    // ── PWA: disabled by default → worker login blocked ───────────────────────
    const w1 = await anon("POST", "/auth/worker", { phone: "+34600111222" });
    assert.strictEqual(w1.status, 403, "worker login blocked when PWA off");
    ok("worker login blocked while PWA disabled");

    // Manager enables the PWA.
    const setPwa = await mgrReq("POST", "/api/settings", { pwaEnabled: true });
    assert.strictEqual(setPwa.body.pwaEnabled, true, "pwa enabled");
    assert.strictEqual(setPwa.body.connectorEnabled, true, "connector reported enabled");
    ok("manager enables the PWA");

    // ── Worker logs in by phone and checks in via the web ─────────────────────
    const wrk = makeClient(base);
    const w2 = await wrk("POST", "/auth/worker", { phone: "+34600111222" });
    assert.strictEqual(w2.status, 200, "worker login ok");
    ok("worker logs in by phone");

    // Check in at PX (no coords yet) → should geolocate the point.
    const ci = await wrk("POST", "/api/checkin", { pointId: "PX", lat: "40.4168", lng: "-3.7038", note: "web" });
    assert.strictEqual(ci.body.ok, true, "checkin ok");
    ok("worker web check-in saved");

    const pxAfter = (await ds.listPoints()).find(p => p.id === "PX");
    assert.ok(pxAfter.geolocated && pxAfter.lat === "40.4168", "PX geolocated on first check-in");
    ok("first check-in fixes the point coordinates");

    // ── Connector export shows the PWA visit ──────────────────────────────────
    const exp = await anon("GET", "/api/v1/visits?limit=10", undefined, key);
    const webVisit = (exp.body.visits || []).find(v => v.point.id === "PX");
    assert.ok(webVisit && webVisit.source === "pwa", "exported visit has source=pwa");
    ok("connector export includes the web check-in");

    console.log(`\nAll ${passed} smoke checks passed ✅`);
  } finally {
    server.close();
  }
}

main().catch(e => { console.error("\nSMOKE TEST FAILED ❌\n", e); process.exit(1); });
