# StarX — Launch Plan

Field check-in platform: companies bring their points + workers; workers check in with
GPS + photo from a Telegram bot or the PWA; managers watch it live and pull the data out.
Multi-tenant, self-serve signup, Stripe billing.

Last updated: 2026-07-20.

---

## ✅ Done

**Security**
- Multi-tenant isolation: every write/delete/link scoped by `tenant_id` (no cross-tenant
  IDOR); Postgres RLS enabled as defense-in-depth; login scoped by company code + password.
- CSRF defense (Origin/host check on state-changing `/api` requests) + a per-tenant audit
  log of admin actions.
- Private photo storage (signed proxy, not a public bucket); Stripe webhook has replay
  protection (timestamp tolerance + event idempotency).
- Signup/login/worker-login rate-limited.
- Email + password reset: signup requires a real email (stored, used for account recovery);
  `/auth/forgot` → `/auth/reset` flow, enumeration-safe; zero-dep email module (Resend).
- Terms of Service + Privacy Policy pages, required checkbox at signup.
- Structured logging (`logger.js`) + global crash handlers + catch-all Express error
  middleware + optional webhook alerting (`ERROR_WEBHOOK_URL`).
- Platform-wide analytics at `/admin/analytics` — gated by `PLATFORM_PASSWORD` only, its
  own signed cookie (separate from tenant sessions), unlisted (no nav/landing link).

**Design**
- Full redesign: warm-paper light theme, coral accent, new cube+arrow logo everywhere
  (favicon included). Dark mode kept.
- Onboarding wizard: 5-step animated first-run guide, auto-shown once per company,
  reopenable from Ajustes.
- Settings reorganised: **Ajustes** (account/password, full Bot control, PWA, check-in
  rules, billing) vs **Conexiones** (Excel import, API connector, Google Sheets) — matches
  how the two are actually used, not how they happened to get built.
- Dashboard: real interactive charts (SVG, gradient fill, hover tooltips) replacing the old
  div/pill bars; filters (worker/source/date); colored map markers.
- Data export: full company data (points/workers/visits) as one JSON download.
- Mobile bugs root-caused and fixed: bot-badge text wrap, code-block horizontal overflow
  (both were real CSS bugs, not cosmetic guesses).
- Logo/back navigation everywhere (landing, login, platform topbar all navigate home).

**Functionality**
- Worker PWA enriched: personal stats (today/week/total/streak), assigned-points list with
  status, personal recent-check-ins log — was a bare form before.
- Geofence enforcement (per-deployment `GEOFENCE_METERS`), photo-required toggle.
- Bot point search (`🔍 Buscar parada`) instead of scrolling dozens of buttons.
- i18n: EN/ES/UK dictionary covers nav, static labels, and everything built this session
  (~50 entries added) — **partially done, see Next Up**.

---

## 🔜 Next up (in order)

1. **Finish i18n.** The translation system auto-translates any *exact-match static string*
   via a dictionary — that part works well. What's still mixed: toasts and messages built
   by string concatenation (`"Analizadas " + n + " filas"`), which can never exact-match a
   dictionary key. Needs a pass through `app.js` splitting each dynamic message into a
   translatable static fragment + the interpolated value, one call site at a time.
2. **Full QA cycle.** Not another quick look — a real pass covering:
   - End to end: signup (real email) → login by code → import Excel → assign points →
     turn on bot → check in via bot **and** PWA → verify on dashboard/stats → export data.
   - All three roles: admin, worker (PWA), and the connector API with a real generated key.
   - All three languages, on the actual views (not just nav labels).
   - A real phone, not just the emulator.
   - Stripe checkout → webhook → plan upgrade, end to end, in test mode.
   - Password reset end to end with a real email arriving.
3. **Fix whatever the QA cycle finds.**

## 🗺️ After that — roadmap ideas

**Trust / ops**
- Per-tenant (not just per-IP) rate limiting on the `/api/v1` connector.
- A defined dunning policy for `past_due` subscriptions (grace period, reminder emails)
  beyond just flipping to read-only.
- Product-usage analytics for *you* (active companies/day, check-ins/day trend) — the new
  `/admin/analytics` page is the seed of this; extend it with a trend chart, not just
  today's snapshot.
- Confirm Supabase automated backups are on (ops checklist, not code).

**Functionality**
- Routes/ordering — an ordered daily sequence of stops per worker (the single most-asked
  logistics feature; natural upsell tier).
- Notifications — Telegram daily "here's your route" push; manager alert for missed stops
  at end of day.
- Scheduled report emails (needs the email infra already built — natural follow-on).
- Roles beyond admin/worker — a read-only supervisor, a dispatcher (assign, no billing).

**Design**
- Empty states + loading skeletons everywhere data can be zero (currently just "Cargando…").
- A short documented component/brand reference so new screens stay consistent without
  re-deriving the design system each time.
