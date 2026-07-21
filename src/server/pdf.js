// Albarán / proof-of-visit PDF generation (pdfkit + qrcode). One tenant-branded, single-page
// A4 document per visit. Shared by both auth surfaces that can download it — the
// session-authenticated platform (routes/visits.js) and the API-key connector
// (routes/connect.js) — same split as the photo proxy each of those already has.
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const INK = "#1b1a16", DIM = "#6b665b", LINE = "#d5cfbf";

function fmtDateTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }); }
  catch { return String(ts); }
}
function fmtShort(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }); }
  catch { return String(ts); }
}
// Human duration between two ISO timestamps (mirrors the client's durationText()).
function durationText(startIso, endIso) {
  const a = Date.parse(startIso), b = Date.parse(endIso);
  if (!isFinite(a) || !isFinite(b) || b < a) return "—";
  const min = Math.round((b - a) / 60000);
  if (min < 60) return min + " min";
  return Math.floor(min / 60) + " h " + (min % 60) + " min";
}

// Resolve one of the visit's stored photos to raw bytes, same logic as the photo-proxy
// routes (Telegram file_id for bot check-ins, Supabase Storage ref for PWA ones). Best
// effort: a photo that fails to resolve is just skipped rather than failing the whole PDF.
async function fetchPhotoBuffer(source, visit, idx) {
  const ids = String(visit.photoFileIds || "").split(",").map(s => s.trim()).filter(Boolean);
  const ref = ids[idx];
  if (!ref) return null;
  try {
    if (visit.source === "pwa") {
      const photo = await source.getPhoto(ref);
      return photo ? photo.buffer : null;
    }
    const link = await require("./bot/manager").fileLink(ref);
    const tg = await fetch(link);
    if (!tg.ok) return null;
    return Buffer.from(await tg.arrayBuffer());
  } catch (e) { return null; }
}

// Render the Albarán straight into `res` as a streamed PDF response.
//   visit       — the stored Visit record
//   point       — the matching Point record, if still found (may be null)
//   tenant      — the owning tenant (name used as a fallback company name)
//   pdfSettings — { pdfCompanyName, pdfTaxId, pdfAddress, pdfLogoUrl, pdfDocTitle, pdfFootnote }
//   source      — this tenant's bound datasource (for photo lookups)
//   baseUrl     — origin used to build the verification QR link
async function renderVisitPdf(res, { visit, point, tenant, pdfSettings, source, baseUrl }) {
  pdfSettings = pdfSettings || {};
  const docId = `ALB-${new Date(visit.timestamp || Date.now()).getFullYear()}-${visit.visitId}`;
  const title = pdfSettings.pdfDocTitle || "Albarán de Visita";

  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${docId}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);

  // ── Header: logo + legal details on the left, doc title + ID + date on the right ──
  let textX = 40;
  if (pdfSettings.pdfLogoUrl) {
    try {
      const r = await fetch(pdfSettings.pdfLogoUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        doc.image(buf, 40, 40, { fit: [64, 64] });
        textX = 114;
      }
    } catch (e) { /* logo is optional — skip on any fetch/format failure */ }
  }
  doc.fillColor(INK).fontSize(15).font("Helvetica-Bold").text(pdfSettings.pdfCompanyName || tenant.name || "—", textX, 40, { width: 250 });
  doc.fontSize(8.5).font("Helvetica").fillColor(DIM);
  if (pdfSettings.pdfTaxId) doc.text("CIF/NIF: " + pdfSettings.pdfTaxId, textX);
  if (pdfSettings.pdfAddress) doc.text(pdfSettings.pdfAddress, textX, doc.y, { width: 250 });

  doc.fontSize(15).font("Helvetica-Bold").fillColor(INK).text(title, 300, 40, { width: 255, align: "right" });
  doc.fontSize(8.5).font("Helvetica").fillColor(DIM)
    .text(docId, 300, 60, { width: 255, align: "right" })
    .text("Generado: " + fmtDateTime(new Date().toISOString()), 300, 72, { width: 255, align: "right" });

  doc.moveTo(40, 118).lineTo(555, 118).strokeColor(LINE).lineWidth(1).stroke();

  // ── Target point ──
  let y = 132;
  doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK).text("Punto de visita", 40, y);
  y += 15;
  doc.fontSize(10).font("Helvetica").fillColor(INK).text((point && (point.name || point.id)) || visit.pointName || visit.pointId || "—", 40, y);
  y = doc.y + 2;
  doc.fontSize(8.5).fillColor(DIM).text((point && point.address) || "—", 40, y);
  y = doc.y + 16;

  // ── Execution metadata ──
  doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK).text("Ejecución", 40, y);
  y += 15;
  const rows = [["Trabajador", visit.workerName || visit.workerTelegramId || "—"], ["Check-in", fmtDateTime(visit.timestamp)]];
  if (visit.checkoutAt) {
    rows.push(["Check-out", fmtDateTime(visit.checkoutAt)]);
    rows.push(["Duración", durationText(visit.timestamp, visit.checkoutAt)]);
  }
  rows.push(["Coordenadas GPS", (visit.lat && visit.lng) ? `${visit.lat}, ${visit.lng}` : "—"]);
  rows.forEach(([k, v]) => {
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor(DIM).text(k, 40, y, { continued: true, width: 130 });
    doc.font("Helvetica").fillColor(INK).text("   " + v);
    y += 13;
  });
  y += 10;

  // ── Notes / work done ──
  doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK).text("Comentario del trabajador", 40, y);
  y += 15;
  const noteText = String(visit.note || "").indexOf("🎙️voice:") === 0
    ? "🎙️ Nota de voz adjunta (disponible en la plataforma)."
    : (visit.note || "— sin comentario —");
  doc.fontSize(9).font("Helvetica").fillColor(INK)
    .text(noteText, 40, y, { width: 515, height: 32, ellipsis: true });
  y += 40;

  // ── Photos (GPS/timestamp stamped as an overlay bar) ──
  const photoCount = Number(visit.photoCount) || 0;
  if (photoCount) {
    doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK).text("Fotos del check-in", 40, y);
    y += 15;
    const thumbW = 160, thumbH = 110;
    let x = 40;
    for (let i = 0; i < Math.min(photoCount, 3); i++) {
      const buf = await fetchPhotoBuffer(source, visit, i);
      if (buf) {
        try {
          doc.image(buf, x, y, { fit: [thumbW, thumbH], align: "center", valign: "center" });
          doc.rect(x, y + thumbH - 15, thumbW, 15).fillOpacity(0.62).fillColor("#000").fill();
          doc.fillOpacity(1).fontSize(6.2).fillColor("#fff")
            .text(`${visit.lat || "—"}, ${visit.lng || "—"} · ${fmtShort(visit.timestamp)}`, x + 4, y + thumbH - 12, { width: thumbW - 8 });
        } catch (e) { /* a photo that fails to embed is just skipped */ }
      }
      x += thumbW + 14;
    }
    y += thumbH + 16;
  }

  // ── Verification QR + signature box (fixed near the bottom to keep this one page) ──
  const boxY = Math.max(y, 690);
  const verifyUrl = `${baseUrl}/verify/${encodeURIComponent(tenant.id)}/${encodeURIComponent(visit.visitId)}`;
  doc.rect(40, boxY, 340, 76).strokeColor(LINE).lineWidth(1).stroke();
  doc.fontSize(8).fillColor(DIM).text("Firma del cliente / Client signature", 46, boxY + 6);
  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 76 });
    doc.image(Buffer.from(qrDataUrl.split(",")[1], "base64"), 470, boxY, { width: 76, height: 76 });
    doc.fontSize(6.5).fillColor(DIM).text("Verificar", 470, boxY + 78, { width: 76, align: "center" });
  } catch (e) { /* QR is a nice-to-have, never block the document on it */ }

  doc.fontSize(7.2).fillColor(DIM)
    .text(pdfSettings.pdfFootnote || "Documento generado automáticamente por StarX como justificante de visita.", 40, boxY + 92, { width: 515, align: "center" });

  doc.end();
}

module.exports = { renderVisitPdf };
