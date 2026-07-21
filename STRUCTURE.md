# StarX — Project Structure

A map of every directory and file in this repo and what it's for. Read this alongside
[ARCHITECTURE.md](ARCHITECTURE.md), which explains *how the pieces work together*
rather than *where they live*.

```
test-main/
├── bot.js                      Process entry point (npm start / npm run bot)
├── package.json                 Deps + scripts (start, bot, test)
├── README.md                    MVP quick-start + feature summary
├── LAUNCH.md                    Launch checklist: done / next up / roadmap ideas
├── PLAN.md                      Original product/technical plan
├── BUSINESS_PLAN.md             Pricing, positioning, go-to-market
├── STRUCTURE.md                 This file
├── ARCHITECTURE.md              How the system actually works
│
├── src/server/                  Express app + all backend logic
│   ├── index.js                 App factory (createApp) + process bootstrap (startServer)
│   ├── config.js                Env vars, paths, session/cookie settings, tenant helpers
│   ├── tenants.js                Multi-tenant registry: plans, quotas, dunning, password hashing
│   ├── auth.js                   Login/signup/reset routes, session cookie, auth middleware,
│   │                              connector API-key gate, quota + subscription guards
│   ├── audit.js                  Per-tenant admin-action audit log
│   ├── logger.js                 Structured JSON logging, in-memory ring buffer, Supabase
│   │                              persistence, optional error webhook (Slack/Discord)
│   ├── billing.js                Stripe integration (checkout, portal, webhook, dunning)
│   ├── email.js                  Zero-dependency transactional email (Resend): welcome,
│   │                              password reset, dunning reminders
│   ├── pending.js                Tracks bot contact attempts from unregistered phones
│   ├── sheets.js / supabaseClient.js   Low-level Google Sheets / Supabase client helpers
│   ├── util.js                   Shared helpers: local-date math, geofence check, visit
│   │                              ownership matching
│   │
│   ├── datasource/               The storage seam — same interface, three backends
│   │   ├── index.js              forTenant(tenant) → picks the right backend, caches it
│   │   ├── memory.js              In-memory store (zero-config default; resets on restart)
│   │   ├── sheets.js              Google Sheets-backed store (1 tab per entity)
│   │   └── supabase.js            Postgres-backed store via Supabase (production default)
│   │
│   ├── bot/                      Telegram bot, decoupled from the web server
│   │   ├── manager.js             Start/stop/inspect the bot at runtime (from the web UI)
│   │   └── handlers.js            The check-in conversation: /route → location → photos → done
│   │
│   └── routes/                   One file per resource, mounted onto the Express app
│       ├── public.js              /health, / (landing), /terms, /privacy
│       ├── platform.js            /platform, /platform/login, /platform/signup, /platform/reset
│       ├── points.js              /api/points        CRUD (admin)
│       ├── workers.js             /api/workers       CRUD (admin) + pending-contact review
│       ├── visits.js              /api/visits, /api/stats, /api/visits/:id/photo/:idx
│       ├── import.js              /api/import/*      Excel/CSV parse + column-mapped upload
│       ├── checkin.js             /api/checkin       Worker PWA check-in (GPS + photo)
│       ├── connect.js             /api/v1/*          Client-facing connector API (X-API-Key)
│       ├── bot.js                 /api/bot/*         Start/stop/status for the Telegram bot
│       ├── billing.js             /api/billing/*     Stripe checkout/portal + webhook
│       └── admin.js               /admin/analytics*  Unlisted operator dashboard
│
├── public/                       Everything served as static files / HTML shells
│   ├── landing.html               Marketing site (own self-contained i18n system)
│   ├── terms.html / privacy.html  Legal pages
│   ├── admin/analytics.html       Operator-only analytics UI (gated by PLATFORM_PASSWORD)
│   └── platform/                  The logged-in web app ("the platform")
│       ├── index.html             Single-page app shell: dashboard, points, workers, visits,
│       │                          stats, settings — all views, swapped by JS
│       ├── login.html             Sign-in (role dropdown: Gestor / Trabajador)
│       ├── signup.html            Self-service company signup (14-day trial)
│       ├── reset.html             Password-reset landing page (token from email)
│       └── assets/
│           ├── app.js             All platform UI logic: API calls, rendering, forms, charts
│           ├── app.css            The whole visual design system (warm-paper theme, dark mode)
│           ├── i18n.js            Shared EN/ES/UK dictionary + MutationObserver-based translator
│           ├── sw.js              Service worker (cache-first for /platform/assets, PWA installable)
│           └── icon.svg, manifest.webmanifest   PWA icon + manifest
│
├── supabase/schema.sql            Postgres schema for the `supabase` datasource + platform
│                                  tables (starx_tenants, starx_logs) — source of truth for DB shape
│
├── docs/                         Legacy static demo (older "StarX Connect" client portal
│                                  mockup, predates the current platform) — not part of the
│                                  live app; kept for reference only
│
├── test/server_smoke.js          In-memory boot + core-flow smoke test (npm test)
└── .claude/launch.json           Dev-server launch config (npm start on :3000)
```

## How a request is routed (mount order matters)

`src/server/index.js` builds the Express app and mounts routers in a specific order —
see the comments in that file before reordering anything:

1. **Connector routes** (`/api/v1/*`) mount *first* because they carry their own
   `X-API-Key` credential, not a session cookie. If a session-gated router mounted
   first, its middleware would 401 connector requests before they ever reached the
   key check.
2. **Auth routes** (`/auth/*`) — login, signup, logout, password reset.
3. **Platform + resource routes** — `/platform`, `/api/points`, `/api/workers`,
   `/api/visits`, `/api/import`, `/api/checkin`, `/api/billing`, `/api/bot`.
4. **Admin** (`/admin/analytics`) — unlisted, its own password gate, `noindex`.
5. **Public routes** (`/`, `/health`, `/terms`, `/privacy`) last, as the catch-all
   before the 404 handler.

## Where to look for a given kind of change

| You want to change...                          | Start here                                  |
|-------------------------------------------------|----------------------------------------------|
| What a company can do on a plan (limits, price) | `src/server/tenants.js` (`PLANS`)             |
| Login/session/API-key behavior                  | `src/server/auth.js`                          |
| How data is stored (add a field, a table)       | `src/server/datasource/*.js` + `supabase/schema.sql` |
| The Telegram conversation flow                  | `src/server/bot/handlers.js`                  |
| Any admin-facing screen (dashboard, workers…)   | `public/platform/index.html` + `assets/app.js`|
| Wording / translations                          | `public/platform/assets/i18n.js` (app) or the `I18N` object inside `landing.html` (marketing site — separate system) |
| Stripe plans/checkout/webhook                  | `src/server/billing.js` + `src/server/routes/billing.js` |
| Rate limits                                     | `src/server/index.js` (global) / `src/server/routes/connect.js` (per-tenant connector) |
