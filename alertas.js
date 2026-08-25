import { store } from "./store.js";
import { DOC_TYPES } from "./checklist.js";
import { maintenanceAlerts } from "./maintenance.js";
import { I, esc, docStatus, emptyBox, $, $$ } from "./ui.js";

const DETENIDO_DIAS = 5;

export async function renderAlertas(view, ctx) {
  view.innerHTML = '<button class="backlink" id="al-back">' + I.back + ' Panel</button><div class="meta-line" style="padding:20px 2px">Cargando alertas...</div>';
  const bk = $("#al-back", view); if (bk) bk.onclick = () => ctx.go("home", {});

  const [trucks, orders, fuel] = await Promise.all([store.listTrucks(), store.listOrders(), store.listFuel()]);

  const docs = [];
  trucks.forEach(t => {
    const push = (nombre, vence) => {
      const st = docStatus(vence);
      if (st.k === "vencido") docs.push({ cls: "crit", truckId: t.id, text: t.num + " · " + nombre, detalle: "Vencido" });
      else if (st.k === "porvencer") docs.push({ cls: "warn", truckId: t.id, text: t.num + " · " + nombre, detalle: "Vence en " + st.days + " días" });
    };
    DOC_TYPES.forEach(dt => push(dt.n, t.docs && t.docs[dt.k] && t.docs[dt.k].vence));
    (t.docs && t.docs.otros || []).forEach(o => push(o.nombre || "Documento", o.vence));
  });

  const det = [];
  orders.filter(o => o.estado === "en_taller").forEach(o => {
    const since = o.fechaAgendada || o.createdAt, dias = Math.floor((Date.now() - since) / 86400000);
    if (dias >= DETENIDO_DIAS) { const t = trucks.find(x => x.id === o.truckId) || { num: "?" }; det.push({ cls: "crit", orderId: o.id, text: t.num + " detenido hace " + dias + " días" + (o.otNumero ? " (" + o.otNumero + ")" : "") }); }
  });

  const mant = maintenanceAlerts(trucks, fuel);
  const total = docs.length + det.length + mant.length;
  const anyCrit = docs.some(d => d.cls === "crit") || det.length || mant.some(m => m.cls === "crit");

  const section = (title, items, attr) => items.length
    ? '<div class="section"><span class="eyebrow">' + title + " (" + items.length + ")</span><div class='card' style='margin-top:8px'>" +
      items.map(a => '<div class="row" ' + attr(a) + ' style="cursor:pointer"><span class="sev-stripe ' + (a.cls === "crit" ? "sev-alta" : "sev-media") + '"></span><div class="rl"><div class="t">' + esc(a.text) + "</div>" + (a.detalle ? '<div class="m"><span>' + esc(a.detalle) + "</span></div>" : "") + "</div><span class='arrow'>" + I.arrow + "</span></div>").join("") + "</div></div>"
    : "";

  view.innerHTML =
    '<button class="backlink" id="al-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Alertas</h2><span class="pill ' + (total ? (anyCrit ? "crit" : "warn") : "ok") + '"><span class="dot"></span>' + total + "</span></div>" +
    (total
      ? section("Documentos", docs, a => 'data-a-truck="' + a.truckId + '"') +
        section("Camiones detenidos", det, a => 'data-a-order="' + a.orderId + '"') +
        section("Mantención preventiva", mant, a => 'data-a-truck="' + a.truckId + '"')
      : '<div class="empty">' + I.check + "<div>No hay alertas. Todo al día.</div></div>");

  $("#al-back", view).onclick = () => ctx.go("home", {});
  $$("[data-a-truck]", view).forEach(b => b.onclick = () => ctx.go("truckDetail", { id: b.getAttribute("data-a-truck") }));
  $$("[data-a-order]", view).forEach(b => b.onclick = () => ctx.go("order", { id: b.getAttribute("data-a-order") }));
}
