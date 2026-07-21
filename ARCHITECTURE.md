# StarX — Architecture

This explains *how the system works*: the core loop, multi-tenancy, auth, storage,
billing, and the moving parts around them. For a map of *where the code lives*, see
[STRUCTURE.md](STRUCTURE.md).

## 1. What StarX does, in one loop

```
Worker opens the Telegram bot or the PWA
    → sees their assigned stops (only theirs)
    → arrives, checks in: GPS auto-captured + a photo
    → a Visit is written to the tenant's datastore
    → the manager sees it live on the web dashboard (list + map + stats)
```

Everything else — billing, i18n, analytics, admin tooling — exists to make that loop
sellable and operable, not to replace it.

## 2. One process, three surfaces

`bot.js` starts everything (`npm start` and `npm run bot` are equivalent now):

- **The web platform** — an Express app (`src/server/index.js`) serving the marketing
  site, the login/signup pages, the logged-in single-page app (`public/platform`), and
  the JSON API it talks to.
- **The Telegram bot** — `src/server/bot/manager.js` / `handlers.js`, started either
  automatically (`TELEGRAM_TOKEN` env var) or on-demand from the web app's Bot tab
  (`POST /api/bot/start` with a pasted BotFather token). No separate process, no
  separate deploy — one token in, `bot.startPolling()`, done.
- **The connector API** (`/api/v1/*`) — a REST surface for a client's own systems to
  push their worker/point catalog and pull the visit log, authenticated by a
  per-tenant `X-API-Key` (self-service — generated and shown in the UI, no backend
  access needed).

All three talk to the same tenant + datasource underneath, so a check-in from the bot
appears instantly in the platform's stats, and a point the connector API creates shows
up in both the bot's `/route` list and the admin's Points table.

## 3. Multi-tenancy

One tenant = one company = one login + one datastore. `src/server/tenants.js` is the
registry:

- The **env-configured default tenant** always exists (`PLATFORM_PASSWORD`,
  `TENANT_CODE`) — this is what makes the app boot with zero configuration for a
  single self-hosted company.
- Additional tenants are created via **self-service signup** (`POST /auth/signup`),
  persisted to the `starx_tenants` Postgres table when `DATASOURCE=supabase`, or kept
  in memory otherwise. Each gets a 14-day trial by default.
- The registry is a **synchronous in-memory cache** (`_cache`), reloaded from the DB
  at boot and after every write. Routes and the bot call `config.tenants.byId/byCode`
  and never await a DB round-trip just to resolve "which company is this" — that
  lookup happens on every request, so it has to be cheap.
- **Plans and quotas** (`PLANS`: trial/basic/pro/business) are derived from the plan
  *name* in code, not stored per-row — changing a price or limit is a code change, not
  a migration. `auth.quotaError()` enforces `maxWorkers`/`maxPoints` before an insert.
- **Dunning**: on a failed Stripe payment a tenant goes `past_due` but keeps writing
  for `DUNNING_GRACE_DAYS` (default 7) from `past_due_since`. After grace — or on
  outright cancellation — `tenants.canWrite()` returns false and writes are blocked
  with `402 Payment Required`; reads still work, so data is frozen, never destroyed.

## 4. Storage: the datasource seam

Every route and the bot call `datasource.forTenant(tenant)` and get back an object
with the same methods (`listPoints`, `listWorkers`, `listVisits`, `findWorkerByPhone`,
`getSetting`, …) regardless of where the tenant's data actually lives:

| `tenant.source` | Backend                              | When used                         |
|-----------------|----------------------------------------|------------------------------------|
| `memory`        | Plain in-memory arrays (`datasource/memory.js`) | Zero-config trial / demo; resets on restart |
| `sheets`        | Google Sheets, one tab per entity (`datasource/sheets.js`) | Early/legacy integration path |
| `supabase`      | Postgres via Supabase (`datasource/supabase.js`) | Production default once persistence matters |

Implementations are loaded **lazily** (`require`d only when that source is actually
selected), so the MVP never needs `googleapis` or `@supabase/supabase-js` installed
just to boot. A small `Map` cache in `datasource/index.js` avoids rebuilding the same
bound source object on every request.

This indirection is the whole scaling story: adding a fourth backend (a client's own
REST API, a direct Postgres connection) means writing one new file here — nothing in
`routes/` or `bot/handlers.js` changes.

### Data model

| Entity     | Key fields                                                              |
|------------|--------------------------------------------------------------------------|
| **Tenant** | id, name, code, plan, subscriptionStatus, stripeCustomerId               |
| **Worker** | workerId (internal, auto), name, phone, telegramId, active               |
| **Point**  | id, name, address, lat/lng (filled by first check-in), workerId (1:1 assignment) |
| **Visit**  | id, worker, point, timestamp, lat/lng, photo(s), note                    |

A point is assigned to exactly one worker (holodBot-style — see README/PLAN for the
project's origin). Coordinates aren't required at creation; the **first check-in**
at a point fixes its location, which is why the Points table shows a *Geo: sí/pendiente*
column instead of requiring lat/lng up front.

## 5. Auth & sessions

There's no server-side session store (Railway's filesystem is ephemeral — a store
would drop every logged-in user on each redeploy). Instead:

- `auth.js` issues an **HMAC-signed, stateless cookie** (`starx_session`) containing
  the user's role/tenant/company, signed with `config.SESSION_SECRET`. No DB lookup
  needed to validate a session — just an HMAC check.
- `attachUser` middleware runs on every request and does a **sliding-expiration**
  refresh: if a valid cookie is past the halfway point of its TTL, it's silently
  reissued, so an active user is never logged out mid-session.
- **Two roles**: `admin` (a company's manager, full CRUD) and `worker` (PWA-only,
  scoped to their own check-ins — no password, identified by the phone their manager
  preloaded, the same key the bot links by).
- **Login is scoped by company code.** `matchTenant(code, pw)` checks *only* that one
  tenant's password when a code is given, or *only* the env default when it isn't —
  it deliberately never scans every tenant's password, because two companies sharing
  a password by coincidence must never cross-log a user into the wrong account.
- The **connector API** is a separate credential entirely (`X-API-Key`, checked by
  `requireApiKey`), resolved to a tenant by `resolveApiKeyTenant` — it never touches
  the session cookie system.
- An optional **`TRUSTED_IPS`** bypass treats requests from listed IPs as an
  authenticated admin with no login at all — useful for a single self-hosted
  deployment behind a known network, off by default.

## 6. Security posture

- **CSRF**: state-changing `/api` requests (not GET/HEAD/OPTIONS, not `/api/v1`, not
  the Stripe webhook) must have a same-origin `Origin`/`Referer` or are rejected —
  defends the cookie-authenticated API against cross-site forgery.
- **Per-tenant audit log** (`audit.js`): every successful state-changing `/api` call
  is recorded with actor, role, action, IP, keyed by `tenantId`.
- **Photo privacy**: check-in photos are proxied server-side
  (`GET /api/visits/:id/photo/:idx`), never exposed as a public bucket URL or a raw
  Telegram file link (which embeds the bot token).
- **Rate limiting**: global limiters on login/signup/worker-login/`/api/*`
  (`express-rate-limit`), plus a **per-tenant** limiter on the connector
  (`routes/connect.js`) so one noisy client can't starve others sharing the API.
- **Password hashing**: scrypt with a random salt (`tenants.hashPassword`), constant-time
  comparison (`crypto.timingSafeEqual`) everywhere a secret is checked (passwords, API
  keys, session HMAC, reset tokens).
- **Stripe webhook**: raw-body signature verification + timestamp tolerance + event-id
  idempotency, so a replayed or forged webhook can't flip a tenant's plan.
- Helmet is on with CSP disabled (the platform loads Leaflet from a CDN + inline
  script) but HSTS/nosniff/frame-guard/referrer-policy defaults are kept.

## 7. Billing (Stripe) & dunning

`billing.js` is a **zero-dependency** Stripe integration — plain `fetch` against the
Stripe REST API, no SDK. It's entirely optional: with no `STRIPE_SECRET_KEY` set, the
module reports itself disabled and the rest of the platform behaves exactly as if
billing didn't exist (this is what keeps the self-hosted/single-company path
config-free).

- `createCheckout` starts a hosted Stripe Checkout session for a plan.
- The webhook (`routes/billing.js` → `POST /api/billing/webhook`) updates the
  tenant's `plan` / `subscriptionStatus` / `stripeCustomerId` on
  `checkout.session.completed`, `customer.subscription.updated`, and payment-failure
  events — setting `past_due_since` the *first* time a payment fails so the dunning
  grace window (§3) has a start date, and clearing it on recovery.
- `email.js` sends a dunning reminder alongside the status change.

## 8. The Telegram bot

`bot/manager.js` owns the **runtime lifecycle**: an admin pastes a BotFather token in
the web UI's Bot tab, the server validates it (`getMe()`) and starts long-polling *in
the same process* — no separate deploy, no restart, no env var required (though
`TELEGRAM_TOKEN` will auto-start it on boot if set). Stopping cleanly cancels polling
so a new token can replace it immediately.

`bot/handlers.js` is the actual conversation, attached once to a live `bot` instance
and otherwise stateless about how that instance came to exist:

```
/route → tap a stop → send location → send photo(s) → "✅ Terminar" → Visit written
```

Because **one bot instance serves every tenant**, per-user state
(`Map<telegramUserId, {step, tenantId, ...}>`) resolves *which company* a Telegram
user belongs to on first contact — by matching their shared phone contact against
every tenant's roster (`resolveByPhone`) — and caches that tenant on their state so
later steps in the same conversation skip the scan. A phone that matches no roster
becomes a **pending contact**, surfaced to the admin's Workers view so they can add
it with one click instead of the worker being silently rejected.

## 9. The web platform (frontend)

`public/platform/index.html` is a single HTML shell with every view
(dashboard/points/workers/visits/stats/settings) already in the DOM; `assets/app.js`
shows/hides views and re-renders their content from `/api/*` responses — there's no
build step, bundler, or framework. `assets/app.css` is the entire design system (warm
paper light theme + dark mode, using CSS custom properties).

It's installable as a **PWA** (`manifest.webmanifest` + `assets/sw.js`), which is also
how workers without the Telegram bot check in: `login.html` offers a **role dropdown**
(Gestor/Trabajador) instead of separate flows bolted together, and a worker session
(`role: "worker"`) hits `POST /api/checkin` with GPS + photo the same way the bot does,
writing to the same `Visit` shape.

## 10. i18n — two independent systems (don't confuse them)

- **`public/platform/assets/i18n.js`** — used by `login.html`, `signup.html`,
  `index.html`. A `MutationObserver` walks every DOM text node; if the *exact,
  trimmed* text matches a key in the `T` dictionary (`{es: [en, uk]}`), it's replaced
  in place. `window.LF.t(str)` translates a standalone string from JS;
  `window.LF.tf(template, params)` translates a template first, then fills `{token}`
  placeholders — this is required for any string built with interpolation, since a
  concatenated string can never exact-match a dictionary key.
  - **Gotcha**: a sentence with inline `<b>`/`<code>` tags gets split into multiple
    DOM text nodes by the browser. Each fragment needs its *own* dictionary key with
    the exact original spacing/punctuation, or only part of the sentence translates
    and the rest stays in Spanish — this was the root cause of a real
    "mixed-language" bug (see `LAUNCH.md` history), fixed by adding fragment-level
    keys rather than restructuring the markup.
- **`landing.html`** — a **completely separate**, self-contained system: an `I18N`
  object (`{es, en, uk}`) keyed by `data-i18n` attribute names, applied via
  `applyLang(lang)` which sets `el.textContent` (or the `content` attribute for
  `<meta>` tags). Adding a translated string to one system does **not** add it to the
  other — the marketing page and the logged-in app must each be updated separately.

## 11. Observability & the operator view

- `logger.js` writes one structured JSON line per event (info/warn/error) — parseable
  by any log viewer with no vendor SDK. An in-memory ring buffer (last 500 entries)
  backs a live view; `warn`/`error` entries are also best-effort persisted to the
  `starx_logs` Postgres table (when `DATASOURCE=supabase`) so history survives a
  restart, not just the current process's buffer. An optional `ERROR_WEBHOOK_URL`
  posts a summary of every `error()` call to Slack/Discord/etc.
- **`/admin/analytics`** is a platform-operator page (you, running the SaaS — not a
  tenant): active companies, plan mix, check-in volume, and the persisted log
  history. It's gated by `PLATFORM_PASSWORD` alone, through its **own** signed cookie
  (`starx_superadmin`, entirely separate from a tenant's `starx_session`), unlisted
  (no nav link, `X-Robots-Tag: noindex`) — reachable only if you know the URL.

## 12. Deployment shape

Single Node process (`bot.js` → `src/server/index.js`), designed for **Railway**
specifically: `app.set("trust proxy", 1)` because Railway terminates TLS in front of
it, ephemeral filesystem assumptions baked into the stateless-cookie session design,
and every credential (Stripe, Supabase, Telegram, Resend) optional via env vars so the
same codebase runs as a zero-config in-memory demo or a fully persistent multi-tenant
SaaS depending only on which env vars are set.
