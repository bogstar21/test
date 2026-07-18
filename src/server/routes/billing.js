// /api/billing — subscription status + Stripe checkout/portal + webhook.
// All optional: without STRIPE_SECRET_KEY the status route reports enabled:false and the
// UI simply shows the current (self-hosted) plan without an upgrade button.
const express = require("express");
const config  = require("../config");
const billing = require("../billing");
const { requireAuth, requireRole } = require("../auth");

function origin(req) {
  return (config.PLATFORM_URL || (req.protocol + "://" + req.get("host"))).replace(/\/+$/, "");
}

function mountBillingRoutes(app) {
  // Webhook FIRST, with a RAW body parser (signature must be verified over the raw bytes).
  // index.js excludes this path from the global JSON parser so the raw stream survives.
  app.post("/api/billing/webhook", express.raw({ type: "*/*" }), async (req, res) => {
    try {
      const event = billing.verifyWebhook(req.body, req.get("stripe-signature"));
      await billing.handleEvent(event);
      res.json({ received: true });
    } catch (e) {
      console.error("stripe webhook:", e && e.message);
      res.status(400).json({ error: (e && e.message) || "webhook_error" });
    }
  });

  const r = express.Router();
  r.use(requireAuth);

  // Current plan + subscription state for the logged-in company.
  r.get("/", (req, res) => {
    const t = config.getTenant(req);
    const limits = config.tenants.planLimits(t.plan);
    res.json({
      enabled: billing.enabled(),
      plan: t.plan,
      planLabel: limits.label,
      status: t.subscriptionStatus || "active",
      canWrite: config.tenants.canWrite(t),
      trialEndsAt: t.trialEndsAt || null,
      limits: { maxWorkers: limits.maxWorkers === Infinity ? null : limits.maxWorkers, maxPoints: limits.maxPoints === Infinity ? null : limits.maxPoints },
      hasCustomer: !!t.stripeCustomerId,
    });
  });

  // Start a checkout for a plan → returns the hosted Stripe URL to redirect to.
  r.post("/checkout", requireRole("admin"), async (req, res) => {
    try {
      const plan = (req.body && req.body.plan) || "basic";
      const url = await billing.createCheckout(config.getTenant(req), plan, origin(req));
      res.json({ url });
    } catch (e) { res.status(400).json({ error: e.message, detail: e.message === "billing_disabled" ? "El cobro no está configurado en este servidor." : undefined }); }
  });

  // Open the Stripe customer portal (manage card / cancel / invoices).
  r.post("/portal", requireRole("admin"), async (req, res) => {
    try {
      const url = await billing.createPortal(config.getTenant(req), origin(req));
      res.json({ url });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.use("/api/billing", r);
}

module.exports = { mountBillingRoutes };
