// Public, ungated routes: health check + the marketing landing page at the root.
const path = require("path");
const config = require("../config");
const { forTenant } = require("../datasource");

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function mountPublicRoutes(app, _deps) {
  app.get("/health", (_req, res) => res.json({ ok: true, service: "starx", ts: Date.now() }));
  // Root is the public website (about + pricing + sign-in / sign-up CTAs). The app itself
  // lives under /platform; the landing's buttons link there.
  app.get("/", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "landing.html")));
  app.get("/terms", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "terms.html")));
  app.get("/privacy", (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, "privacy.html")));

  // Scanned from the Albarán PDF's verification QR code. Deliberately minimal and public
  // (no session needed — that's the point of a scannable proof-of-visit): confirms the
  // visit is a real record and shows only non-sensitive summary fields, never photos/GPS.
  app.get("/verify/:tenantId/:visitId", async (req, res) => {
    res.type("html");
    try {
      const tenant = config.tenants.byId(req.params.tenantId);
      if (!tenant) return res.status(404).send(verifyPage(false));
      const visits = await forTenant(tenant).listVisits({ limit: 5000 });
      const visit = visits.find(v => String(v.visitId) === String(req.params.visitId));
      if (!visit) return res.status(404).send(verifyPage(false));
      res.send(verifyPage(true, {
        company: tenant.name, point: visit.pointName || visit.pointId,
        worker: visit.workerName, timestamp: visit.timestamp,
      }));
    } catch (e) { res.status(500).send(verifyPage(false)); }
  });
}

function verifyPage(ok, v) {
  const body = ok
    ? `<div class="ok">✓ Visita verificada</div>
       <div class="row"><span>Empresa</span><b>${esc(v.company)}</b></div>
       <div class="row"><span>Punto</span><b>${esc(v.point)}</b></div>
       <div class="row"><span>Trabajador</span><b>${esc(v.worker)}</b></div>
       <div class="row"><span>Fecha</span><b>${esc(v.timestamp ? new Date(v.timestamp).toLocaleString("es-ES") : "—")}</b></div>`
    : `<div class="bad">✗ No se encontró ningún registro para este documento.</div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>StarX — Verificación</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f0e9;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1b1a16;padding:20px}
      .box{width:100%;max-width:360px;padding:28px;background:#fff;border:1px solid #e6e1d5;border-radius:12px}
      .ok{color:#217a52;font-weight:700;font-size:16px;margin-bottom:16px}
      .bad{color:#b5382a;font-weight:700;font-size:15px}
      .row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #e6e1d5;font-size:13px}
      .row span{color:#6b665b}
    </style></head><body><div class="box">${body}</div></body></html>`;
}

module.exports = { mountPublicRoutes };
