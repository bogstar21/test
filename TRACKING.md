# StarX — Project Tracking

> **AI context guidelines — read this before touching code.**
> This is the **only** project-management file in this repo. There is no LAUNCH.md,
> PLAN.md, BUSINESS_PLAN.md, STRUCTURE.md, or ARCHITECTURE.md anymore — everything about
> status, history, and roadmap lives **here**, in one place, so it never drifts out of
> sync with itself across multiple files.
>
> If you are Claude, ChatGPT, Cursor, or any other assistant working on this repo:
> 1. **Before starting work**, read the "Active Sprint" and "Backlog & Roadmap" sections to
>    know what's already planned vs. what's a new ask.
> 2. **When you ship something**, move its checkbox from Active Sprint (or add a new one
>    from Backlog) into "Completed History" with a one-line entry: what changed and why,
>    not a full diff. Keep entries terse — this is a log, not a changelog essay.
> 3. **When you plan something new**, add it to Backlog & Roadmap under the right category
>    instead of creating a new .md file. If no category fits, add one.
> 4. **Never re-create** LAUNCH.md/PLAN.md/STRUCTURE.md/etc. — if you find yourself wanting
>    a separate architecture doc, add an "Architecture Snapshot" subsection here instead.
> 5. Keep the "Last updated" date below current.

_Last updated: 2026-07-23_

---

## 1. Architecture Snapshot

StarX is a multi-tenant field check-in SaaS: workers check in at physical points with
GPS + photo via a **Telegram bot** or an installable **PWA**; managers watch it live on a
web dashboard.

| Layer | Stack |
|---|---|
| Server | Node.js + Express, one process (`bot.js` → `src/server/index.js`) |
| Datastore | **Supabase** (Postgres) in production; in-memory or Google Sheets as zero-config/legacy fallbacks — all behind one `datasource` seam (`src/server/datasource/`) |
| Worker channel | **Telegram Bot API** (`node-telegram-bot-api`), always-English conversation flow (`src/server/bot/`) |
| Worker channel (alt) | Installable **PWA** (`public/platform`), phone-only login, same check-in write path as the bot |
| Manager dashboard | Server-rendered single-page shell (`public/platform/index.html` + `assets/app.js`, no build step/framework) |
| Billing | **Stripe** (checkout + webhook + dunning grace period), fully optional — off with no `STRIPE_SECRET_KEY` |
| Documents | **pdfkit** — Albarán / proof-of-visit PDF per visit, embedded Noto Sans for Cyrillic, QR verification |
| Multi-tenancy | One tenant = one company = one login + one datastore; plans/quotas/dunning in `src/server/tenants.js` |
| i18n | Two independent systems: `platform/assets/i18n.js` (dictionary + MutationObserver) for the app, a separate `I18N` object in `landing.html` for the marketing site. Bot is English-only. |
| Auth | Stateless HMAC-signed session cookie (no server-side session store — Railway's filesystem is ephemeral) |

Full historical rationale for these choices lives in the commit log, not in a second doc —
see `git log` if you need the "why," not another markdown file.

---

## 2. Completed History (Log)

Newest first. One line per shipped item.

- **PDF Cyrillic fix**: embedded static Noto Sans (Latin+Cyrillic) in the Albarán PDF so
  Ukrainian text no longer renders as mojibake; labels now localize per tenant language;
  GPS rounded to 5 decimals; header/photo/comment-box padding fixed.
- **Bidirectional worker↔point auto-sync**: a point imported/created with an unresolved
  `workerPhone` now retro-links automatically the moment that worker is created (single
  add or bulk import), across all three datasources (memory/sheets/supabase).
- **Bulk delete**: `POST /api/points/bulk-delete` and `/api/workers/bulk-delete`, with
  select-all + row checkboxes and a bulk action bar in both tables.
- **Bot language simplified back to English-only**: multi-language bot support (es/en/uk,
  `src/server/bot/i18n.js`, per-tenant `bot_lang` setting) was built, hit a caching bug
  (language never updated until process restart), got fixed, then was deliberately
  simplified away as overcomplicated for the actual need — the dictionary/i18n scaffolding
  stays in the code for a cheap re-enable later, but the UI toggle and setting are gone.
- **Worker PWA card redesign**: assigned-stops and recent-check-ins are now individual
  hard-bordered cards instead of shared glass panels, with compact monospace status badges.
- **Design system de-AI-ification**: removed glassmorphism (`backdrop-filter`, translucent
  surfaces) across cards/topbar/tables in favor of solid opaque backgrounds and 1px
  borders; flattened gradient buttons/badges to solid ink/coral; monospaced timestamps,
  GPS, IDs, and status badges; tightened corner radii and table density.
- **Albarán / proof-of-visit PDF**: tenant-branded (logo, legal name, tax ID, address,
  custom title/footnote) single-page A4 PDF per visit — header, point + execution
  details, embedded check-in photos stamped with GPS/timestamp, a verification QR
  (public `/verify/:tenantId/:visitId` page), signature box. Available to both the
  session-authenticated dashboard and the API-key connector.
- **Optional visit commentary**: bot offers a post-photo comment step (quick-pick inline
  buttons, free text, or a voice note); the PWA note field got quick-pick chips, a 0/250
  counter, and a localStorage draft so a dropped connection never loses what was typed.
- **Admin Workers page enrichment**: KPI summary row (team size/active/linked/today's
  stops) above the roster table; avatar+name+phone combined cell; dedicated
  "Vinculado" (Telegram-linked) column.
- **Login/signup separation**: split the old tabbed login page into a dedicated
  `/platform/signup` page and a `/platform/login` with a role dropdown (Gestor/Trabajador)
  instead of a 3-way tab switcher.
- **i18n completion pass**: fixed dictionary-coverage gaps and a text-node-fragmentation
  bug (inline `<b>`/`<code>` tags split sentences into untranslated pieces) that caused
  visibly mixed-language UI; converted dynamic/interpolated strings to `LF.tf()` templates.
- **Log history over live-tail**: replaced the flaky mandatory live log tail on
  `/admin/analytics` with a persisted-history view (Supabase `starx_logs` table),
  refresh-on-demand + optional 30s auto-refresh.
- **Per-tenant connector rate limiting** and **dunning grace period** (default 7 days)
  for `past_due` subscriptions, with a reminder email, before the account goes read-only.
- **Platform-operator analytics** (`/admin/analytics`): unlisted, gated by
  `PLATFORM_PASSWORD` + its own signed cookie, never linked from nav.
- **Security/launch-readiness batch**: private photo proxy (no public bucket, no raw
  Telegram token exposure), CSRF/origin checks + per-tenant audit log, Stripe webhook
  replay protection, password reset via email, Terms/Privacy pages, full data export.
- **Full visual redesign**: warm-paper light theme + coral accent, dark mode, cube+arrow
  logo, interactive SVG charts replacing div/pill bars, onboarding wizard.
- **Core MVP**: Telegram check-in flow (GPS + photo), multi-tenant engine, Google
  Sheets/Supabase/memory datasource seam, connector API (`/api/v1`), Excel/CSV import.

---

## 3. Active Sprint — 2-Week Launch Plan (target: 2026-08-06)

Everything below is pre-launch, in priority order. **Functional Essentials first** (they're
infrastructure/trust fixes that get harder to retrofit after real customer data exists),
then **Strategic Essentials** (sales/trust surface) in week 2, finishing with a hard QA pass
before flipping the switch. Check items off as they ship; move each one to Completed
History (§2) with a one-line note, don't just delete the checkbox.

### Week 1 (Jul 23 – Jul 29) — Functional Essentials

**A. Offload photo storage (critical infra fix)**
- [ ] Current state: PWA check-in photos already go to a **Supabase Storage** bucket
  (`datasource/supabase.js: uploadPhoto`/`getPhoto`) — that half is done. **Bot** check-in
  photos are still Telegram `file_id`s, resolved live on every view/PDF-embed via
  `bot/manager.fileLink()` + a server-side fetch/stream (`routes/visits.js`,
  `routes/connect.js`, `pdf.js`). That's the RAM/bandwidth risk under concurrent load.
- [ ] Fix: when the bot finalizes a visit (`bot/handlers.js`, `finalizeVisit`), download
  each photo from Telegram **once** and push it into the same Supabase Storage bucket via
  the existing `uploadPhoto()`; store the storage ref instead of the raw `file_id`.
- [ ] Keep the current Telegram-proxy path as a fallback for visits written before this
  change (don't break old data) — new writes just stop taking that path.
- [ ] Update the photo-proxy routes (`visits.js`, `connect.js`) and `pdf.js`'s
  `fetchPhotoBuffer()` to check the ref type and read from Storage first.

**B. Backup & recovery**
- [ ] Verify Supabase automated daily backups are enabled on the production project
  (Dashboard → Database → Backups). This is an ops/config checklist item, not code.
- [ ] Do one manual test restore (or at least confirm a restore point exists and is recent)
  so "restore in minutes" is a tested claim, not an assumption.

**C. Custom domain & SSL**
- [ ] Point a real domain (e.g. `app.starx.com` / `starx.app`) at the Railway deployment
  through Cloudflare, with SSL active — replace the raw `*.railway.app` URL everywhere
  it's hardcoded (`PLATFORM_URL` env var, any absolute links in emails/PDFs).
- [ ] Re-check cookie settings (`COOKIE_SECURE=true`) and CORS/Origin checks still make
  sense under the new domain.

### Week 2 (Jul 30 – Aug 5) — Strategic Essentials

**A. Legal & Terms pages**
- [ ] Terms of Service + Privacy Policy already exist (`/terms`, `/privacy`) and are linked
  from `signup.html`'s required checkbox — confirm both are still reachable after the
  domain change (item 1C) and read cleanly on mobile.
- [ ] Add explicit GDPR-relevant language to the Privacy Policy: that check-ins capture
  **GPS location at time of check-in only** (not continuous tracking) and **photos**, how
  long both are retained, and that they're stored in Supabase (EU region if applicable) —
  this matters specifically for European clients.

**B. Stripe production-mode verification**
- [ ] Switch the Stripe keys from test (`sk_test_…`) to live (`sk_live_…`) and the webhook
  endpoint/secret to the live one, in the Railway env.
- [ ] Run one real €1/$1 checkout end to end with a real card and confirm, without any
  manual DB edit: (1) Checkout opens cleanly, (2) the `checkout.session.completed` webhook
  fires and is received, (3) the tenant's `plan`/`subscriptionStatus` flips in Supabase
  automatically (`routes/billing.js` webhook handler).
- [ ] Refund/cancel that test charge afterward.

**C. A 60-second "how it works" demo**
- [ ] Record (or GIF) the 3-step loop: add a point on the dashboard → a worker taps
  check-in on Telegram or the PWA → the manager downloads the Albarán PDF instantly.
- [ ] Embed it on `landing.html` near the hero — managers evaluating field-ops tools want
  30 seconds of proof over a paragraph of docs.

### Final QA + Launch (Aug 5–6)
- [ ] Full end-to-end pass on the **live** domain with **live** Stripe: signup → login →
  import → assign → bot check-in → PWA check-in → dashboard/stats → Albarán PDF → export.
- [ ] Confirm no `*.railway.app` links leak anywhere a customer would see them (emails,
  PDFs, the connector's `PLATFORM_URL`).
- [ ] Ship it.

---

## 4. Backlog & Roadmap

### Geofencing
- [ ] `GEOFENCE_METERS` exists and enforces a radius on check-in (server-side, per
  deployment) — **not yet exposed in the UI** as a per-tenant setting; today it's an env
  var only. Surface it in Ajustes so a manager can set/change it without a redeploy.
- [ ] Visual radius indicator on the map view (draw the geofence circle around a point).

### Live Route Map
- [ ] Routes/ordering — an ordered daily sequence of stops per worker (the most-requested
  logistics feature; natural upsell tier for a higher plan).
- [ ] Live map view: workers' current/last-known position plotted alongside their route
  progress (today's dashboard map shows visit history, not a live route).

### PDF / Verification
- [x] Verification QR on the Albarán PDF, linking to a public `/verify/:tenantId/:visitId`
  confirmation page — shipped.
- [ ] Actual e-signature capture (today's "signature box" is a static printable box, not a
  capture-and-store flow) — would need a signature-pad UI + storage + embedding back into
  the PDF.
- [ ] Let the client (not just the worker/manager) view+download their own Albarán via the
  verification link, not just a bare confirmation summary.

### Webhooks
- [ ] Outbound webhooks for tenants (visit created, worker checked in, subscription
  changed) so a client's own systems can react in real time instead of polling
  `/api/v1/visits`.
- [ ] Retry/backoff + signature (HMAC) on outbound webhook delivery, mirroring how the
  Stripe webhook is verified inbound.

### Analytics
- [ ] Product-usage trend chart on `/admin/analytics` (active companies/day,
  check-ins/day over time) — today's page is a snapshot, not a trend.
- [ ] Per-tenant analytics: a manager-facing trend view (not just today's stats) on the
  Estadísticas tab.
- [ ] Scheduled report emails (daily/weekly summary) — the email infra already exists
  (`src/server/email.js`); this is a natural follow-on, not new infrastructure.

### Notifications
- [ ] Telegram daily "here's your route" push to each worker.
- [ ] Manager alert for missed stops at end of day.

### Roles & Permissions
- [ ] Roles beyond admin/worker: a read-only supervisor, a dispatcher (can assign
  points/routes, no billing access). The login page's role dropdown is UI-only today —
  there's no permission model behind a third role yet.

### Design
- [ ] Empty states + loading skeletons everywhere data can be zero (several views still
  just show "Cargando…" with nothing further).
- [ ] A short documented component/brand reference so new screens stay consistent without
  re-deriving the design system each time from the CSS file directly.

### Trust / Ops
- [ ] Re-enable per-tenant bot language if a real customer asks for it — the `bot/i18n.js`
  dictionary and resolution logic already exist and were deliberately kept after being
  simplified out of the live flow (see Completed History).
