// Public, ungated routes: health check + the marketing landing page at the root.
const path = require("path");
const config = require("../config");
function mountPublicRoutes(app, _deps) {
  app.get("/health", (_req, res) => res.json({ ok: true, service: "starx", ts: Date.now() }));
  // Root is the public website (about + pricing + sign-in / sign-up CTAs). The app itself
  // lives under /platform; the landing's buttons link there.
  app.get("/", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "landing.html")));
  app.get("/terms", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "terms.html")));
  app.get("/privacy", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "privacy.html")));
}

module.exports = { mountPublicRoutes };
