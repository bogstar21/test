// Public, ungated routes: health check + a friendly root redirect to the platform.
function mountPublicRoutes(app, _deps) {
  app.get("/health", (_req, res) => res.json({ ok: true, service: "starx", ts: Date.now() }));
  app.get("/", (_req, res) => res.redirect("/platform"));
}

module.exports = { mountPublicRoutes };
