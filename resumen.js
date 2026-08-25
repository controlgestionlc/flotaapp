import { store } from "./store.js";
import { DOC_TYPES } from "./checklist.js";
import { I, esc, fmtCLP, fmtDate, fmtDateTime, docStatus, iconSpan, emptyBox, $ } from "./ui.js";

const EST = { pendiente: "Pendiente", agendado: "Agendado", en_taller: "En taller", completado: "Completado" };
function orderTotal(o) { return (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0) + (Number(o.manoObra) || 0); }
function nf(n, dec) { return (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: dec || 0 }); }

function truckRend(id, fuel) {
  const list = fuel.filter(f => f.truckId === id && f.km > 0).sort((a, b) => a.km - b.km);
  if (list.length < 2) return { rend: null, costoKm: null };
  let km = 0, lt = 0, gasto = 0;
  for (let i = 1; i < list.length; i++) { const dk = list[i].km - list[i - 1].km, l = Number(list[i].litros) || 0; if (dk > 0 && l > 0) { km += dk; lt += l; } }
  list.forEach(f => gasto += Number(f.total) || 0);
  return { rend: lt > 0 ? km / lt : null, costoKm: km > 0 ? gasto / km : null };
}
function openFallasTruck(id, cks, bits, orders, resolved) {
  const linked = new Set(); orders.forEach(o => (o.sources || []).forEach(s => linked.add(s)));
  const res = new Set(resolved);
  const out = [];
  cks.filter(c => c.truckId === id).forEach(c => (c.fails || []).forEach(f => {
    const k = "chk:" + c.id + ":" + f.k; if (!linked.has(k) && !res.has(k)) out.push({ sev: f.sev || "media" });
  }));
  bits.filter(b => b.truckId === id).forEach(b => {
    if (b.tipo === "Falla mecánica" || b.tipo === "Incidente") { const k = "bit:" + b.id; if (!linked.has(k) && !res.has(k)) out.push({ sev: b.sev || "media" }); }
  });
  return out;
}

export async function renderResumen(view, ctx) {
  const id = ctx.params.id;
  view.innerHTML = '<button class="backlink" id="rs-back">' + I.back + ' Volver</button><div class="meta-line" style="padding:20px 2px">Cargando ficha...</div>';
  const goBack = () => ctx.go(ctx.params.from === "camiones" ? "camiones" : "home", {});
  const b0 = $("#rs-back", view); if (b0) b0.onclick = goBack;

  const [trucks, orders, fuel, trips, cks, bits, resolved] = await Promise.all([
    store.listTrucks(), store.listOrders(), store.listFuel(), store.listTrips(), store.listChecklists(), store.listBitacora(), store.listResolved()
  ]);
  const t = trucks.find(x => x.id === id);
  if (!t) return ctx.go("camiones", {});

  const tOrders = orders.filter(o => o.truckId === id);
  const openOrders = tOrders.filter(o => o.estado !== "completado");
  const doneOrders = tOrders.filter(o => o.estado === "completado");
  const gastoTaller = doneOrders.reduce((s, o) => s + orderTotal(o), 0);
  const tTrips = trips.filter(v => v.truckId === id);
  const m3 = tTrips.filter(v => v.unidad === "M3").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const mr = tTrips.filter(v => v.unidad === "MR").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const r = truckRend(id, fuel);
  const lastCk = cks.filter(c => c.truckId === id).sort((a, b) => b.ts - a.ts)[0];
  const fallas = openFallasTruck(id, cks, bits, orders, resolved);
  const enTaller = openOrders.find(o => o.estado === "en_taller");
  const estado = enTaller ? { cls: "crit", label: "En taller" }
    : fallas.some(f => f.sev === "alta") ? { cls: "crit", label: "Con falla" }
    : (fallas.length || openOrders.length) ? { cls: "warn", label: "Con novedad" }
    : { cls: "ok", label: "Operativo" };

  const kpi = (val, lab) => '<div class="kpi a"><span class="stripe"></span><div class="val num" style="font-size:1.4rem">' + esc(val) + '</div><div class="lab" style="margin-top:4px">' + esc(lab) + "</div></div>";
  const kpis = '<div class="kpis section">' +
    kpi(r.rend ? nf(r.rend, 2) + " km/L" : "s/d", "Rendimiento") +
    kpi(r.costoKm ? fmtCLP(r.costoKm) : "s/d", "Costo por km") +
    kpi(fmtCLP(gastoTaller), "Gasto en taller") +
    kpi(String(tTrips.length), "Viajes") +
    "</div>";

  const docsMini = DOC_TYPES.map(dt => {
    const dd = t.docs && t.docs[dt.k]; const st = docStatus(dd && dd.vence);
    return '<div class="doc-row"><div class="dl"><div class="dn">' + esc(dt.n) + '</div><div class="dm">N° ' + esc((dd && dd.numero) || "sin registro") + (dd && dd.vence ? " · vence " + fmtDate(new Date(dd.vence + "T12:00:00").getTime()) : "") + '</div></div><span class="pill ' + st.cls + '"><span class="dot"></span>' + st.label + "</span></div>";
  }).join("");

  const ordersBlock = tOrders.length ? tOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5).map(o =>
    '<div class="row"><div class="rl"><div class="t">' + esc(o.titulo) + ' <span class="pill ' + (o.estado === "completado" ? "ok" : o.estado === "en_taller" ? "crit" : "warn") + '">' + EST[o.estado] + "</span></div>" +
    '<div class="m">' + (o.otNumero ? "<span>" + esc(o.otNumero) + "</span>" : "") + (o.taller ? "<span>" + esc(o.taller) + "</span>" : "") +
    (o.estado === "completado" ? '<span class="num" style="color:var(--ink);font-weight:600">' + fmtCLP(orderTotal(o)) + "</span>" : "") + "</div></div></div>"
  ).join("") : emptyBox("Sin órdenes de taller");

  const volTxt = (m3 ? nf(m3) + " M3" : "") + (m3 && mr ? " · " : "") + (mr ? nf(mr) + " MR" : "") || "0";
  const tripsBlock = tTrips.length ? tTrips.slice(0, 5).map(v =>
    '<div class="row"><div class="rl"><div class="t">' + iconSpan("route") + esc((v.predio || v.origen || "") + " → " + (v.plantaDestino || "")) + "</div>" +
    '<div class="m"><span class="num">' + nf(v.volumen) + " " + esc(v.unidad || "") + "</span>" + (v.guiaDespacho ? "<span>" + esc(v.guiaDespacho) + "</span>" : "") + "<span>" + fmtDateTime(v.salida || v.ts) + "</span></div></div></div>"
  ).join("") : emptyBox("Sin viajes registrados");

  view.innerHTML =
    '<button class="backlink" id="rs-back">' + I.back + " Volver</button>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.2rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
      '<div style="margin-top:5px"><span class="plate">' + esc(t.patente) + "</span></div></div>" +
      '<span class="pill ' + estado.cls + '"><span class="dot"></span>' + estado.label + "</span></div>" +
      '<div class="meta-line" style="margin-top:10px;font-size:.82rem">Último checklist: ' + (lastCk ? fmtDate(lastCk.ts) : "nunca") + (fallas.length ? " · " + fallas.length + " falla(s) abierta(s)" : "") + " · Volumen movido: " + volTxt + "</div></div>" +
    kpis +
    '<div class="section"><span class="eyebrow">Documentación</span><div class="card pad" style="margin-top:8px">' + docsMini + "</div></div>" +
    '<div class="section"><span class="eyebrow">Órdenes de taller</span><div class="card" style="margin-top:8px">' + ordersBlock + "</div></div>" +
    '<div class="section"><span class="eyebrow">Últimos viajes</span><div class="card" style="margin-top:8px">' + tripsBlock + "</div></div>";

  $("#rs-back", view).onclick = goBack;
}
