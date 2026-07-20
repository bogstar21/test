# StarX — Business Plan

_Last updated: 2026-07-20_

## 1. One-liner

**StarX is proof-of-presence for field teams.** A company uploads its stops and its
workers; the workers check in at each stop with GPS + photo from Telegram or a web app;
managers see who went where, when, with proof — live. Sold as a monthly per-seat SaaS.

## 2. The problem

Companies with people in the field — merchandisers, distributors, security patrols,
maintenance crews, promoters, inspectors — need to know their staff actually visited the
places they were supposed to. Today they rely on:

- **WhatsApp photos + trust** — no structure, no GPS, no audit trail, impossible to report.
- **Enterprise field-force suites** (heavy, per-user expensive, weeks of onboarding, built
  for 500+ seats) — overkill and unaffordable for a 5–50 person operation.
- **Spreadsheets** — no live data, no proof, no worker-facing tool.

The gap: a **simple, cheap, self-serve** tool that answers exactly one question —
*who went where, when, with proof* — without an IT project.

## 3. The solution / product

- **Zero-friction for workers.** They check in from the Telegram bot they already have, or
  an installable web app. No app-store install, no per-worker account setup — they link by
  phone number.
- **Zero-infrastructure for managers.** Self-serve signup, import an Excel, assign, done.
  Bot and web check-in toggle on from the dashboard. No servers, no tokens to manage.
- **Proof built in.** Every check-in carries GPS + timestamp + optional (or required) photo,
  with an optional geofence to reject check-ins away from the point.
- **Their data stays theirs.** One-click full export; a connector API (unique key per
  company) to push their catalog and pull the visit log into their own systems.

## 4. Market

- **Primary:** SMB field operations in Spain / LATAM / Eastern Europe (the product already
  ships EN/ES/UK) — merchandising agencies, regional distributors, facility-services and
  security SMBs, promotional-staffing agencies.
- **Segment size that fits:** teams of ~5–100 field workers — too big for WhatsApp, too
  small for enterprise suites.
- **Wedge:** Telegram-native check-in. In markets where field staff already live in
  Telegram, "no install" removes the single biggest adoption blocker competitors have.

## 5. Business model

Monthly subscription, **per active worker seat**, with plan tiers (already implemented):

| Plan | Target | Limits (current) |
|------|--------|------------------|
| Trial | New signups | 14 days, no card |
| Básico | Micro teams | up to 5 workers · 200 points |
| Pro | Growing teams | up to 25 workers · 2 000 points |
| Business | Larger ops | unlimited workers · unlimited points |

- **Billing:** Stripe subscriptions (checkout + customer portal + webhooks) already wired.
- **Trial → paid:** 14-day free trial, no card up front, to maximize activation; convert on
  value once they've imported real routes and seen real check-ins.
- **Expansion revenue:** seats grow with the customer; higher tiers unlock volume + future
  add-ons (routes/ordering, reporting, integrations).
- **Pricing note:** exact €/seat to be set from the first cohort of paying customers —
  anchor against the cost of the manual status quo, not against enterprise suites.

## 6. Go-to-market

1. **Founder-led first customers.** Hand-onboard 3–5 real companies (invoice/transfer, no
   friction), watch them use it, fix what breaks. Goal: proof it retains, not revenue.
2. **Vertical landing + case study.** Once one merchandising/distribution client sticks,
   sell the same shape to look-alikes with their numbers.
3. **Self-serve funnel.** The public landing → 14-day trial → onboarding wizard is the
   scalable path; it exists today and needs the QA cycle before it's pushed hard.
4. **Channel later.** Merchandising/staffing agencies manage many sub-clients — a reseller /
   multi-company angle is a natural expansion once single-company is rock-solid.

## 7. Competitive advantages / moat

- **Simplicity as the product**, not a feature — the whole thing is one question answered
  well, which incumbents can't match without cannibalizing their enterprise pricing.
- **Telegram-native** zero-install check-in in Telegram-heavy markets.
- **True multi-tenant SaaS** already built (isolated data, self-serve signup, per-company
  API keys, billing) — the hard platform work is done, not a demo.
- **Multilingual from day one** (EN/ES/UK) for the target regions.

## 8. Current status

MVP is feature-complete and multi-tenant: signup, billing, security (tenant isolation,
RLS, CSRF, audit log, private photos), email + password reset, onboarding, worker + manager
+ API surfaces, data export, error monitoring, and an operator analytics page. Remaining
before a hard launch: finish the dynamic-string translations and run one full QA cycle
(see `LAUNCH.md`).

## 9. Roadmap that unlocks revenue (see LAUNCH.md for detail)

- **Routes / ordered daily stops** — the most-requested logistics feature; a clean upsell.
- **Notifications** — daily "here's your route" push + missed-stop alerts; drives retention.
- **Reporting & scheduled email digests** — what managers actually pay to receive.
- **Roles** (supervisor / dispatcher) — required once a customer has more than one manager.

## 10. Key risks & mitigations

- **Worker-privacy / labor law** (capturing employee location + photos, esp. EU): mitigated
  by capturing location *only at check-in* (never continuous), a clear Privacy Policy, and
  placing the notice-to-staff obligation on the client (they are the data controller).
- **Adoption / activation:** trial-to-paid depends on workers actually checking in — the
  Telegram zero-install path and onboarding wizard directly attack this.
- **Churn from a single-feature product:** mitigated by the roadmap (routes, reporting)
  that deepens the daily habit before the "why are we paying for this" moment.
- **Platform dependency** (Telegram / Supabase / Stripe / Railway): each is behind a seam
  or standard API; none is irreplaceable, and the datasource layer already abstracts storage.
