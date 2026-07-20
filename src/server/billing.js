// Billing over Stripe — zero-dependency (talks to the Stripe REST API with fetch, no SDK).
// Entirely OPTIONAL: with no STRIPE_SECRET_KEY the whole module reports "disabled" and the
// platform runs exactly as before (useful for the self-hosted single company).
//
// Env:
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET    whsec_…  (to verify webhook signatures)
//   STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS   price_… ids
const crypto = require("crypto");
const tenants = require("./tenants");

function enabled() { return !!process.env.STRIPE_SECRET_KEY; }

const PRICE_ENV = { basic: "STRIPE_PRICE_BASIC", pro: "STRIPE_PRICE_PRO", business: "STRIPE_PRICE_BUSINESS" };
function priceForPlan(plan) { return process.env[PRICE_ENV[plan] || ""] || ""; }
function planForPrice(priceId) {
  for (const plan of Object.keys(PRICE_ENV)) if (process.env[PRICE_ENV[plan]] === priceId) return plan;
  return "basic";
}

// Flatten nested params into Stripe's bracket notation (line_items[0][price]=…).
function flatten(obj, prefix, out) {
  out = out || {};
  for (const k of Object.keys(obj)) {
    const key = prefix ? prefix + "[" + k + "]" : k;
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => flatten(item, key + "[" + i + "]", out));
    else if (v != null) out[key] = String(v);
  }
  return out;
}

async function stripeReq(path, params) {
  const body = new URLSearchParams(flatten(params || {})).toString();
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || ("stripe_http_" + res.status));
  return data;
}

// Start a subscription checkout for a company. Returns the hosted Checkout URL.
async function createCheckout(tenant, plan, origin) {
  if (!enabled()) throw new Error("billing_disabled");
  const price = priceForPlan(plan);
  if (!price) throw new Error("no_price_for_plan");
  const params = {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: origin + "/platform?billing=ok",
    cancel_url: origin + "/platform?billing=cancel",
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id },
    subscription_data: { metadata: { tenant_id: tenant.id } },
  };
  if (tenant.stripeCustomerId) params.customer = tenant.stripeCustomerId;
  const session = await stripeReq("checkout/sessions", params);
  return session.url;
}

// Open the Stripe customer portal (update card, cancel, invoices). Needs a customer id.
async function createPortal(tenant, origin) {
  if (!enabled()) throw new Error("billing_disabled");
  if (!tenant.stripeCustomerId) throw new Error("no_customer");
  const session = await stripeReq("billing_portal/sessions", {
    customer: tenant.stripeCustomerId, return_url: origin + "/platform",
  });
  return session.url;
}

// Verify a Stripe webhook signature (scheme: header "t=…,v1=…"; signed = `${t}.${rawBody}`).
function verifyWebhook(rawBody, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("no_webhook_secret");
  const parts = {};
  String(sigHeader || "").split(",").forEach(kv => { const [k, v] = kv.split("="); parts[k] = v; });
  if (!parts.t || !parts.v1) throw new Error("bad_signature_header");
  const signed = parts.t + "." + (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("signature_mismatch");
  // Replay protection: reject signatures older than the tolerance window (default 5 min).
  const tolerance = parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE || "300", 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(parts.t)) > tolerance) throw new Error("timestamp_out_of_tolerance");
  return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
}

// Idempotency: Stripe can deliver the same event more than once. Remember the ids we've
// already applied (bounded, in-memory) so a duplicate/replayed delivery is a no-op.
const _seenEvents = new Set();
function alreadyHandled(id) {
  if (!id) return false;
  if (_seenEvents.has(id)) return true;
  _seenEvents.add(id);
  if (_seenEvents.size > 5000) _seenEvents.delete(_seenEvents.values().next().value);
  return false;
}

// Map the subset of Stripe events we care about onto tenant plan/subscription state.
async function handleEvent(event) {
  if (alreadyHandled(event && event.id)) return; // duplicate/replayed delivery → no-op
  const obj = (event.data && event.data.object) || {};
  const tenantId = (obj.metadata && obj.metadata.tenant_id) || obj.client_reference_id || "";
  switch (event.type) {
    case "checkout.session.completed": {
      const patch = { subscriptionStatus: "active" };
      if (obj.customer) patch.stripeCustomerId = obj.customer;
      if (tenantId) await tenants.update(tenantId, patch);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const status = obj.status === "active" || obj.status === "trialing" ? "active"
        : (obj.status === "past_due" || obj.status === "unpaid" ? "past_due" : obj.status);
      const priceId = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
      const patch = { subscriptionStatus: status };
      if (priceId) patch.plan = planForPrice(priceId);
      if (tenantId) await tenants.update(tenantId, patch);
      break;
    }
    case "customer.subscription.deleted":
      if (tenantId) await tenants.update(tenantId, { subscriptionStatus: "canceled" });
      break;
    case "invoice.payment_failed":
      if (tenantId) await tenants.update(tenantId, { subscriptionStatus: "past_due" });
      break;
  }
}

module.exports = { enabled, createCheckout, createPortal, verifyWebhook, handleEvent, priceForPlan };
