import { store } from "./store.js";
import { can } from "./permissions.js";
import { DOC_TYPES } from "./checklist.js";
import { maintenanceAlerts } from "./maintenance.js";
import { weekInfo, dayKey } from "./planning.js";
import { openTruckWeek } from "./truckweek.js";
import { autoSyncClimaHistBg } from "./planificacion.js";
import {
  I, esc, fmtCLP, fmtDate, fmtDateTime, monthKey, dInput, docStatus,
  iconSpan, emptyBox, toast, openSheet, openDrawer, closeSheet, $, $$
} from "./ui.js";

const EST = {
  pendiente: { l: "Pendiente", c: "neutral" }, agendado: { l: "Agendado", c: "warn" },
  en_taller: { l: "En taller", c: "crit" }, completado: { l: "Completado", c: "ok" },
  descartada: { l: "Descartada", c: "neutral" }
};
const activa = o => o.estado !== "completado" && o.estado !== "descartada";

let orderDraft = null;

export async function renderPanel(view, ctx) {
  if (ctx.route === "order") return orderDetail(view, ctx);
  return dashboard(view, ctx);
}

function openFallas(cks, bits, orders, resolved) {
  const linked = new Set(); orders.forEach(o => (o.sources || []).forEach(s => linked.add(s)));
  const res = new Set(resolved);
  const rank = { alta: 0, media: 1, baja: 2 };
  const out = [];
  cks.forEach(c => (c.fails || []).forEach(f => {
    const id = "chk:" + c.id + ":" + f.k;
    if (!linked.has(id) && !res.has(id))
      out.push({ id, truckId: c.truckId, titulo: f.n, detalle: f.note || "Reportado en checklist", sev: f.sev || "media", origen: "Checklist", driver: c.driverNombre, ts: c.ts });
  }));
  bits.forEach(b => {
    if (b.tipo === "Falla mecánica" || b.tipo === "Incidente") {
      const id = "bit:" + b.id;
      if (!linked.has(id) && !res.has(id))
        out.push({ id, truckId: b.truckId, titulo: b.tipo + ": " + b.desc.slice(0, 40), detalle: b.desc, sev: b.sev || "media", origen: "Bitácora", driver: b.driverNombre, ts: b.ts });
    }
  });
  return out.sort((a, b) => (rank[a.sev] - rank[b.sev]) || b.ts - a.ts);
}

function truckStatus(id, orders, fallas) {
  const open = orders.filter(o => o.truckId === id && activa(o));
  if (open.some(o => o.estado === "en_taller")) return { cls: "crit", label: "En taller" };
  const fs = fallas.filter(f => f.truckId === id);
  if (fs.some(f => f.sev === "alta")) return { cls: "crit", label: "Con falla" };
  if (fs.length || open.length) return { cls: "warn", label: "Con novedad" };
  return { cls: "ok", label: "Operativo" };
}
function orderTotal(o) { return (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0) + (Number(o.manoObra) || 0); }

// Semáforo de disponibilidad operativa del camión.
// verde = operativo · amarillo = observación · rojo = fuera de servicio
function availStatus(truckId, orders, fallas) {
  const open = orders.filter(o => o.truckId === truckId && activa(o));
  const fs = fallas.filter(f => f.truckId === truckId);
  const enTaller = open.find(o => o.estado === "en_taller");
  if (enTaller) return { k: "fuera", cls: "crit", label: "Fuera de servicio", order: enTaller };
  if (fs.some(f => f.sev === "alta")) return { k: "fuera", cls: "crit", label: "Fuera de servicio", order: open[0] || null };
  const prog = open.find(o => o.estado === "agendado" || o.estado === "pendiente");
  if (prog || fs.length) return { k: "observacion", cls: "warn", label: "Observación", order: prog || null };
  return { k: "operativo", cls: "ok", label: "Operativo", order: null };
}

// Alertas automáticas: documentos vencidos/por vencer y camiones detenidos.
const DETENIDO_DIAS = 5;
function buildAlerts(trucks, orders) {
  const out = [];
  trucks.forEach(t => {
    const push = (nombre, vence) => {
      const st = docStatus(vence);
      if (st.k === "vencido") out.push({ cls: "crit", kind: "doc", truckId: t.id, text: t.num + " · " + nombre + " vencido" });
      else if (st.k === "porvencer") out.push({ cls: "warn", kind: "doc", truckId: t.id, text: t.num + " · " + nombre + " vence en " + st.days + " días" });
    };
    DOC_TYPES.forEach(dt => push(dt.n, t.docs && t.docs[dt.k] && t.docs[dt.k].vence));
    (t.docs && t.docs.otros || []).forEach(o => push(o.nombre || "Documento", o.vence));
  });
  orders.filter(o => o.estado === "en_taller").forEach(o => {
    const since = o.fechaAgendada || o.createdAt;
    const dias = Math.floor((Date.now() - since) / 86400000);
    if (dias >= DETENIDO_DIAS) {
      const t = trucks.find(x => x.id === o.truckId) || { num: "?" };
      out.push({ cls: "crit", kind: "detenido", orderId: o.id, text: t.num + " detenido hace " + dias + " días" + (o.otNumero ? " (" + o.otNumero + ")" : "") });
    }
  });
  return out.sort((a, b) => (a.cls === "crit" ? 0 : 1) - (b.cls === "crit" ? 0 : 1));
}

async function dashboard(view, ctx) {
  const p = ctx.profile;
  const [trucks, cks, bits, orders, resolvedDocs, fuel] = await Promise.all([
    store.listTrucks(), store.listChecklists(), store.listBitacora(), store.listOrders(), store.listResolvedDocs(), store.listFuel()
  ]);
  const resolved = resolvedDocs.map(r => r.id);
  const fallas = openFallas(cks, bits, orders, resolved);
  const manage = can(p, "order.manage");
  const avail = trucks.map(t => ({ t, a: availStatus(t.id, orders, fallas) }));
  const nOp = avail.filter(x => x.a.k === "operativo").length;
  const nObs = avail.filter(x => x.a.k === "observacion").length;
  const nFuera = avail.filter(x => x.a.k === "fuera").length;
  const operativos = nOp;
  const openOrders = orders.filter(o => activa(o));
  const mesTotal = orders.filter(o => o.estado === "completado" && monthKey(o.completedAt) === monthKey()).reduce((s, o) => s + orderTotal(o), 0);

  const kpis = '<div class="kpis section">' +
    kpi("a", operativos + "/" + trucks.length, "Operativos", "camiones sin novedad", "operativos") +
    kpi(fallas.length ? "c" : "g", String(fallas.length), "Fallas por gestionar", fallas.length ? "requieren acción" : "todo al día", "fallas") +
    kpi("w", String(openOrders.length), "Órdenes abiertas", "en proceso o agendadas", "ordenes") +
    kpi("a", fmtCLP(mesTotal), "Costo del mes", "taller completado", "costo") +
    "</div>";

  const availRows = avail.map(({ t, a }) =>
    '<div class="row" data-avail="' + t.id + '" style="cursor:pointer"><span class="trucknum">' + esc(t.num) + "</span>" +
    '<div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
    '<div class="m"><span>' + esc(t.patente) + "</span>" + (a.order && a.order.otNumero ? "<span>" + esc(a.order.otNumero) + "</span>" : "") + "</div></div>" +
    '<span class="pill ' + a.cls + '"><span class="dot"></span>' + a.label + "</span></div>"
  ).join("");
  const legend = '<div class="meta-line" style="display:flex;gap:12px;flex-wrap:wrap;margin:0 2px 10px;font-size:.82rem">' +
    '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:var(--ok)"></span>' + nOp + " operativos</span>" +
    '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:var(--warn)"></span>' + nObs + " observación</span>" +
    '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:var(--crit)"></span>' + nFuera + " fuera</span></div>";
  const availBoard = '<div class="section"><div class="subhead"><h2>Disponibilidad de flota</h2>' +
    '<span class="pill ' + (nFuera ? "crit" : nObs ? "warn" : "ok") + '"><span class="dot"></span>' + nOp + " de " + trucks.length + " disponibles</span></div>" +
    legend + '<div class="card">' + (trucks.length ? availRows : emptyBox("No hay camiones registrados")) + "</div></div>";

  const alerts = buildAlerts(trucks, orders).concat(maintenanceAlerts(trucks, fuel));
  alerts.sort((a, b) => (a.cls === "crit" ? 0 : 1) - (b.cls === "crit" ? 0 : 1));
  const critN = alerts.filter(a => a.cls === "crit").length;
  // Botón/tarjeta que muestra la cantidad; el detalle abre en panel lateral.
  const alertsCard = '<button class="tile" id="alr-open">' +
    '<span class="ic">' + I.alert + "</span>" +
    '<span class="tx"><b>Alertas</b><span>' + (alerts.length ? "Toca para ver el detalle" : "Sin alertas pendientes") + "</span></span>" +
    '<span class="pill ' + (critN ? "crit" : alerts.length ? "warn" : "ok") + '"><span class="dot"></span>' + alerts.length + "</span></button>";
  const alertsDrawerBody = alerts.length
    ? '<div class="card" style="box-shadow:none;border:0">' + alerts.map(a =>
        '<div class="row" ' + (a.kind === "detenido" ? 'data-alert-order="' + a.orderId + '"' : 'data-alert-truck="' + a.truckId + '"') + ' style="cursor:pointer">' +
        '<span class="sev-stripe ' + (a.cls === "crit" ? "sev-alta" : "sev-media") + '"></span><div class="rl"><div class="t">' + iconSpan(a.kind === "doc" ? "doc" : "wrench") + esc(a.text) + "</div></div><span class='arrow'>" + I.arrow + "</span></div>"
      ).join("") + "</div>"
    : '<div class="empty">' + I.check + "<div>Sin alertas. Flota al día.</div></div>";

  const descRecientes = resolvedDocs.slice(0, 5);
  const descBlock = (!can(p, "falla.view") || !descRecientes.length) ? "" :
    ('<div class="section"><span class="eyebrow">Fallas descartadas (' + resolvedDocs.length + ')</span><div class="card" style="margin-top:8px">' +
      descRecientes.map(r => {
        const t = trucks.find(x => x.id === r.truckId) || { num: "?", patente: "" };
        return '<div class="row"><span class="sev-stripe sev-baja"></span><div class="rl">' +
          '<div class="t" style="text-decoration:line-through;color:var(--ink-2)">' + esc(r.titulo || "Falla") + "</div>" +
          '<div class="m"><span>' + iconSpan("truck") + esc(t.num) + "</span>" + (r.driverFalla ? "<span>Reportó: " + esc(r.driverFalla) + "</span>" : "") + "<span>" + fmtDateTime(r.ts) + "</span></div>" +
          '<div style="font-size:.86rem;margin-top:4px;color:var(--ink-2)">Descartada por ' + esc(r.por || "?") + (r.motivo ? ": " + esc(r.motivo) : "") + "</div>" +
          "</div></div>";
      }).join("") + "</div></div>");

  const openList = openOrders.sort((a, b) => b.createdAt - a.createdAt);
  const done = orders.filter(o => o.estado === "completado").sort((a, b) => b.completedAt - a.completedAt).slice(0, 6);
  // Tarjeta clicable → abre el listado de órdenes en panel lateral.
  const ordersCard = '<button class="tile" id="ord-open">' +
    '<span class="ic">' + I.wrench + "</span>" +
    '<span class="tx"><b>Órdenes de taller</b><span>' + (openOrders.length ? "Ver y editar las órdenes" : "Sin órdenes abiertas") + "</span></span>" +
    '<span class="pill steel">' + openOrders.length + " abiertas</span></button>";
  const ordersDrawerBody =
    '<span class="eyebrow" style="display:block;margin:0 0 8px">Abiertas (' + openList.length + ")</span>" +
    '<div class="card" style="box-shadow:none;border:0">' +
      (openList.length ? openList.map(o => orderRow(o, trucks)).join("") : '<div class="empty">' + I.wrench + "<div>Sin órdenes de taller abiertas</div></div>") + "</div>" +
    (done.length ? '<span class="eyebrow" style="display:block;margin:14px 0 8px">Completadas recientes</span><div class="card" style="box-shadow:none;border:0">' + done.map(o => orderRow(o, trucks)).join("") + "</div>" : "");

  view.innerHTML = kpis + availBoard + '<div class="section dash-two">' + alertsCard + ordersCard + "</div>" + descBlock;

  $$("[data-avail]", view).forEach(b => b.onclick = () => availSheet(ctx, b.getAttribute("data-avail"), trucks, orders, fallas));
  $$("[data-kpi]", view).forEach(b => b.onclick = () => kpiDetail(ctx, b.getAttribute("data-kpi"), { trucks, orders, fallas, avail, openOrders, mesTotal }));
  // Alertas → panel lateral
  $("#alr-open", view).onclick = () => openDrawer("Alertas (" + alerts.length + ")", alertsDrawerBody, () => {
    $$("[data-alert-truck]").forEach(b => b.onclick = () => { closeSheet(); ctx.go("truckDetail", { id: b.getAttribute("data-alert-truck") }); });
    $$("[data-alert-order]").forEach(b => b.onclick = () => { closeSheet(); orderDraft = null; ctx.go("order", { id: b.getAttribute("data-alert-order") }); });
  });
  // Órdenes de taller → panel lateral con el listado
  $("#ord-open", view).onclick = () => openDrawer("Órdenes de taller", ordersDrawerBody, () => {
    $$("[data-openorder]").forEach(b => b.onclick = () => { closeSheet(); orderDraft = null; ctx.go("order", { id: b.getAttribute("data-openorder") }); });
  });
  // La navegación se hace desde el menú lateral (ver appbar/openMenu en main.js).

  // Sincronización automática del historial de clima (una vez al día).
  autoSyncClimaHistBg(p);
}

function kpi(cls, val, lab, sub, key) {
  return '<div class="kpi ' + cls + '"' + (key ? ' data-kpi="' + key + '" style="cursor:pointer"' : "") + '><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";
}

// Ficha de detalle al tocar un KPI del panel.
function kpiDetail(ctx, key, D) {
  let title = "", body = "";
  if (key === "operativos") {
    title = "Disponibilidad de la flota";
    body = D.avail.map(({ t, a }) =>
      '<div class="row" data-k-truck="' + t.id + '" style="cursor:pointer"><span class="trucknum">' + esc(t.num) + '</span><div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + '</div><div class="m"><span>' + esc(t.patente) + '</span></div></div><span class="pill ' + a.cls + '"><span class="dot"></span>' + a.label + "</span></div>").join("");
  } else if (key === "fallas") {
    title = "Fallas por gestionar";
    const manage = can(ctx.profile, "order.manage");
    body = D.fallas.length ? D.fallas.map(f => { const t = D.trucks.find(x => x.id === f.truckId) || { num: "?" };
      return '<div class="row"><span class="sev-stripe sev-' + f.sev + '"></span><div class="rl"><div class="t">' + esc(f.titulo) + ' <span class="pill ' + (f.sev === "alta" ? "crit" : f.sev === "media" ? "warn" : "neutral") + '">' + ({ alta: "Alta", media: "Media", baja: "Baja" }[f.sev]) + "</span></div><div class=\"m\"><span>" + esc(t.num) + "</span><span>" + esc(f.origen) + "</span><span>" + fmtDateTime(f.ts) + "</span></div>" +
        (f.detalle ? '<div style="font-size:.85rem;margin-top:4px;color:var(--ink-2)">' + esc(f.detalle) + "</div>" : "") +
        (manage ? '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn sm btn-steel" data-order="' + esc(f.id) + '">' + I.wrench + "Crear orden</button><button class=\"btn sm btn-soft\" data-resolve=\"" + esc(f.id) + "\">Descartar</button></div>" : "") +
        "</div></div>"; }).join("")
      : '<div class="empty">' + I.check + "<div>Sin fallas pendientes</div></div>";
  } else if (key === "ordenes") {
    title = "Órdenes de taller abiertas";
    body = D.openOrders.length ? D.openOrders.map(o => { const t = D.trucks.find(x => x.id === o.truckId) || { num: "?" };
      return '<div class="row" data-k-order="' + o.id + '" style="cursor:pointer"><div class="rl"><div class="t">' + esc(o.titulo) + ' <span class="pill ' + EST[o.estado].c + '">' + EST[o.estado].l + '</span></div><div class="m"><span>' + esc(t.num) + "</span>" + (o.taller ? "<span>" + esc(o.taller) + "</span>" : "") + (o.otNumero ? "<span>" + esc(o.otNumero) + "</span>" : "") + "</div></div><span class='arrow'>" + I.arrow + "</span></div>"; }).join("")
      : '<div class="empty">' + I.wrench + "<div>Sin órdenes abiertas</div></div>";
  } else if (key === "costo") {
    title = "Costo de taller del mes";
    const done = D.orders.filter(o => o.estado === "completado" && monthKey(o.completedAt) === monthKey());
    body = (done.length ? done.map(o => { const t = D.trucks.find(x => x.id === o.truckId) || { num: "?" };
      return '<div class="row" data-k-order="' + o.id + '" style="cursor:pointer"><div class="rl"><div class="t">' + esc(o.titulo) + '</div><div class="m"><span>' + esc(t.num) + "</span>" + (o.taller ? "<span>" + esc(o.taller) + "</span>" : "") + "<span>" + fmtDate(o.completedAt) + "</span></div></div><b class='num'>" + fmtCLP(orderTotal(o)) + "</b></div>"; }).join("")
      : '<div class="empty">' + I.cash + "<div>Sin gasto este mes</div></div>") +
      '<div class="row" style="background:var(--surface-2)"><div class="rl"><div class="t">Total del mes</div></div><b class="num" style="font-size:1.1rem">' + fmtCLP(D.mesTotal) + "</b></div>";
  }
  openSheet(title, '<div class="card" style="box-shadow:none;border:0">' + body + "</div>", () => {
    $$("[data-k-truck]").forEach(b => b.onclick = () => { closeSheet(); ctx.go("resumen", { id: b.getAttribute("data-k-truck"), from: "home" }); });
    $$("[data-k-order]").forEach(b => b.onclick = () => { closeSheet(); orderDraft = null; ctx.go("order", { id: b.getAttribute("data-k-order") }); });
    $$("[data-order]").forEach(b => b.onclick = () => { closeSheet(); createOrder(ctx, b.getAttribute("data-order"), D.fallas); });
    $$("[data-resolve]").forEach(b => b.onclick = () => { closeSheet(); resolveFalla(ctx, b.getAttribute("data-resolve"), D.fallas); });
  });
}
function orderRow(o, trucks) {
  const t = trucks.find(x => x.id === o.truckId) || { num: "?" };
  const e = EST[o.estado];
  return '<div class="row" data-openorder="' + o.id + '" style="cursor:pointer"><div class="rl">' +
    '<div class="t">' + esc(o.titulo) + ' <span class="pill ' + e.c + '"><span class="dot"></span>' + e.l + "</span></div>" +
    '<div class="m"><span>' + iconSpan("truck") + esc(t.num) + "</span>" +
    (o.taller ? "<span>" + esc(o.taller) + "</span>" : "") +
    (o.estado === "completado" ? '<span class="num" style="color:var(--ink);font-weight:600">' + fmtCLP(orderTotal(o)) + "</span>"
      : (o.fechaAgendada ? "<span>" + iconSpan("pin") + fmtDate(o.fechaAgendada) + "</span>" : "")) +
    "</div></div><span class='arrow'>" + I.arrow + "</span></div>";
}

// Ficha de disponibilidad al tocar un camión en el semáforo.
async function availSheet(ctx, truckId, trucks, orders, fallas) {
  const t = trucks.find(x => x.id === truckId); if (!t) return;
  const a = availStatus(truckId, orders, fallas);
  let body = '<div class="stat-truck" style="margin-bottom:16px"><span class="trucknum">' + esc(t.num) + "</span>" +
    '<div style="flex:1"><div style="font-weight:700;font-family:Barlow Semi Condensed;font-size:1.15rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
    '<div style="margin-top:4px"><span class="plate">' + esc(t.patente) + "</span></div></div>" +
    '<span class="pill ' + a.cls + '"><span class="dot"></span>' + a.label + "</span></div>";

  // Planificación de hoy para este camión.
  try {
    const [plans, faenas, users] = await Promise.all([store.listPlans(), store.listFaenas(), store.listUsers()]);
    const dk = dayKey(Date.now()), wk = weekInfo(Date.now());
    const plan = plans.find(p => p.id === wk.key);
    const asigs = (plan && plan.asignaciones || []).filter(x => x.camionId === truckId && x.fecha === dk && x.faenaId)
      .sort((x, y) => (x.turnoInicio || "").localeCompare(y.turnoInicio || ""));
    const faN = id => { const f = faenas.find(z => z.id === id); return f ? f.nombre : "Faena"; };
    const coN = uid => { const u = users.find(z => z.uid === uid); return u ? u.nombre : ""; };
    if (asigs.length) {
      body += '<div class="card pad" style="box-shadow:none;border-color:var(--line);margin-bottom:10px"><span class="eyebrow" style="display:block;margin-bottom:8px">Planificación de hoy</span>' +
        asigs.map(x => '<div class="row" style="padding:7px 0"><span class="sev-stripe sev-baja" style="background:var(--accent)"></span><div class="rl">' +
          '<div class="t">' + esc(faN(x.faenaId)) + ' <span class="pill neutral">' + (x.viajesObjetivo || 0) + " v.</span></div>" +
          '<div class="m"><span>' + esc((x.turnoInicio || "--") + " ─ " + (x.turnoFin || "--")) + "</span>" +
          (x.conductorId ? "<span>" + esc(coN(x.conductorId)) + "</span>" : "") + (x.volumenObjetivo ? "<span>" + x.volumenObjetivo + "</span>" : "") + "</div></div></div>").join("") + "</div>";
    } else {
      body += '<div class="meta-line" style="margin:-6px 0 10px;font-size:.82rem">Sin faena asignada hoy en la planificación.</div>';
    }
    body += '<button class="btn sm btn-soft" style="margin-bottom:14px" id="av-week">' + I.route + "Ver semana completa</button>";
  } catch (e) { /* la planificación es complementaria */ }

  if (a.k === "operativo") {
    body += '<p class="meta-line" style="margin-bottom:10px">Operativo, sin novedades pendientes. Disponible para operar.</p>';
    if (can(ctx.profile, "order.manage"))
      body += '<button class="btn btn-soft" id="av-gen">' + I.wrench + "Generar orden de taller</button>";
  } else if (a.order) {
    const o = a.order, estim = Number(o.costoEstimado) || 0;
    body += '<div class="card pad" style="box-shadow:none;border-color:var(--line)">' +
      row2("Estado", EST[o.estado].l) +
      (o.otNumero ? row2("N° de orden", o.otNumero) : "") +
      row2("Fuera de servicio desde", fmtDate(o.fechaAgendada || o.createdAt)) +
      row2("Problema", o.titulo) +
      (o.taller ? row2("Taller", o.taller) : "") +
      (estim ? row2("Reparación estimada", fmtCLP(estim)) : "") +
      (o.fechaEntregaEstimada ? row2("Entrega estimada", fmtDate(o.fechaEntregaEstimada)) : "") +
      "</div>";
    if (can(ctx.profile, "order.manage"))
      body += '<button class="btn btn-primary" style="margin-top:14px" id="av-order">' + I.wrench + "Ver o editar la orden</button>";
  } else {
    const fs = fallas.filter(f => f.truckId === truckId);
    body += '<p class="meta-line" style="margin-bottom:10px">Novedades reportadas, sin orden de taller todavía:</p>' +
      '<div class="card" style="box-shadow:none">' + fs.map(f =>
        '<div class="row"><span class="sev-stripe sev-' + f.sev + '"></span><div class="rl"><div class="t">' + esc(f.titulo) +
        '</div><div class="m"><span>' + esc(f.origen) + "</span><span>" + fmtDate(f.ts) + "</span></div></div></div>").join("") + "</div>";
    if (can(ctx.profile, "order.manage") && fs[0])
      body += '<button class="btn btn-primary" style="margin-top:14px" id="av-crear">' + I.wrench + "Crear orden de taller</button>";
  }

  if (can(ctx.profile, "truck.manage"))
    body += '<button class="btn btn-soft" style="margin-top:10px" id="av-assign">' + I.users + "Asignar chofer" + (t.conductorNombre ? " · " + esc(t.conductorNombre) : "") + "</button>";
  if (can(ctx.profile, "order.manage"))
    body += '<button class="btn btn-soft" style="margin-top:10px;color:var(--crit)" id="av-falla">' + I.alert + "Reportar falla / marcar no disponible</button>";
  body += '<button class="btn btn-soft" style="margin-top:10px" id="av-resumen">' + I.chart + "Ver resumen del camión</button>";

  openSheet("Disponibilidad · " + t.num, body, () => {
    const bo = $("#av-order"); if (bo) bo.onclick = () => { closeSheet(); orderDraft = null; ctx.go("order", { id: a.order.id }); };
    const bc = $("#av-crear"); if (bc) bc.onclick = () => { const fs = fallas.filter(f => f.truckId === truckId); closeSheet(); createOrder(ctx, fs[0].id, fallas); };
    const bg = $("#av-gen"); if (bg) bg.onclick = () => { closeSheet(); createOrder(ctx, null, fallas, truckId); };
    const ba = $("#av-assign"); if (ba) ba.onclick = () => { closeSheet(); asignarChofer(ctx, t); };
    const bfa = $("#av-falla"); if (bfa) bfa.onclick = () => { closeSheet(); reportarFallaAdmin(ctx, truckId, t.num); };
    const bw = $("#av-week"); if (bw) bw.onclick = () => { closeSheet(); openTruckWeek(ctx, truckId, Date.now()); };
    const br = $("#av-resumen"); if (br) br.onclick = () => { closeSheet(); ctx.go("resumen", { id: truckId, from: "home" }); };
  });
}
function row2(k, v) {
  return '<div style="display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line)">' +
    '<span class="meta-line">' + esc(k) + '</span><b style="text-align:right;font-weight:600">' + esc(v) + "</b></div>";
}

// El supervisor/admin reporta una falla del camión desde el panel. Se guarda
// igual que la del chofer: entra a "Fallas por gestionar" (crear orden / descartar)
// y una severidad alta deja el camión fuera de servicio.
function reportarFallaAdmin(ctx, truckId, truckNum) {
  const tipos = ["Falla mecánica", "Incidente"];
  const st = { tipo: "Falla mecánica", sev: "alta", desc: "" };
  const tipoChips = tipos.map(x => '<button class="chip' + (st.tipo === x ? " on" : "") + '" data-rf-t="' + esc(x) + '">' + esc(x) + "</button>").join("");
  const sevChips = [["alta", "Alta"], ["media", "Media"], ["baja", "Baja"]].map(s => '<button class="chip sev-' + s[0] + (st.sev === s[0] ? " on sev-" + s[0] : "") + '" data-rf-s="' + s[0] + '">' + s[1] + "</button>").join("");
  openSheet("Reportar falla · " + truckNum,
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Queda registrada como novedad del camión. Aparecerá en “Fallas por gestionar” con las mismas opciones (crear orden o descartar). Severidad <b>alta</b> deja el camión fuera de servicio.</p>' +
    '<label class="fld"><span class="lb">Tipo</span><div class="chips" id="rf-tipo">' + tipoChips + "</div></label>" +
    '<label class="fld"><span class="lb">Severidad</span><div class="chips" id="rf-sev">' + sevChips + "</div></label>" +
    '<label class="fld"><span class="lb">Descripción</span><textarea class="input" id="rf-desc" placeholder="Describe la falla o el motivo por el que no está disponible..."></textarea></label>' +
    '<button class="btn btn-danger" id="rf-ok" style="width:100%">' + I.check + "Guardar y marcar</button>",
    () => {
      $$("#rf-tipo [data-rf-t]").forEach(b => b.onclick = () => { st.tipo = b.getAttribute("data-rf-t"); $$("#rf-tipo [data-rf-t]").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
      $$("#rf-sev [data-rf-s]").forEach(b => b.onclick = () => { st.sev = b.getAttribute("data-rf-s"); $$("#rf-sev [data-rf-s]").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
      $("#rf-ok").onclick = async () => {
        const desc = ($("#rf-desc").value || "").trim();
        if (!desc) { toast("Escribe una descripción", "err"); return; }
        const btn = $("#rf-ok"); btn.disabled = true; btn.textContent = "Guardando...";
        try {
          await store.addBitacora({
            truckId, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
            ts: Date.now(), tipo: st.tipo, sev: st.sev, desc, gps: null, origenReporte: "supervisor"
          });
          closeSheet(); toast("Falla registrada", "ok"); ctx.go("home", {});
        } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar y marcar"; }
      };
    });
}

// Ventana de creación de orden de taller. Se abre desde una falla (prefill) o
// como orden nueva (truckId directo). Permite ingresar todos los datos antes de
// crear la orden; luego navega al detalle para seguir gestionándola.
function createOrder(ctx, fid, fallas, truckId) {
  const f = fid ? (fallas || []).find(x => x.id === fid) : null;
  const tId = f ? f.truckId : truckId;
  if (!tId) return;
  const st = { estado: "agendado" };
  const estados = [["pendiente", "Pendiente"], ["agendado", "Agendado"], ["en_taller", "En taller"]];
  const estChips = estados.map(s => '<button class="chip' + (st.estado === s[0] ? " on" : "") + '" data-oe="' + s[0] + '">' + s[1] + "</button>").join("");
  openSheet("Nueva orden de taller",
    (f ? '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Basada en la falla reportada' + (f.driver ? " por " + esc(f.driver) : "") + ". Puedes ajustar los datos.</p>" : "") +
    '<label class="fld"><span class="lb">Problema / título</span><input class="input" id="no-tit" placeholder="Ej: Cambio de pastillas de freno" value="' + esc(f ? f.titulo : "") + '"></label>' +
    '<label class="fld"><span class="lb">Detalle</span><textarea class="input" id="no-det" placeholder="Describe el trabajo requerido...">' + esc(f ? (f.detalle || "") : "") + "</textarea></label>" +
    '<label class="fld"><span class="lb">Estado inicial</span><div class="chips" id="no-est">' + estChips + "</div></label>" +
    '<label class="fld"><span class="lb">Taller</span><input class="input" id="no-taller" placeholder="Nombre del taller"></label>' +
    '<label class="fld"><span class="lb">Fecha agendada</span><input class="input" type="date" id="no-fecha"></label>' +
    '<label class="fld"><span class="lb">Costo estimado</span><input class="input num" id="no-estim" inputmode="numeric" placeholder="$"></label>' +
    '<label class="fld"><span class="lb">Fecha estimada de entrega</span><input class="input" type="date" id="no-entrega"></label>' +
    '<p class="meta-line" style="font-size:.78rem;margin:0 0 12px">Estado <b>En taller</b> deja el camión fuera de servicio.</p>' +
    '<button class="btn btn-primary" id="no-ok" style="width:100%">' + I.check + "Crear orden</button>",
    () => {
      $$("#no-est [data-oe]").forEach(b => b.onclick = () => { st.estado = b.getAttribute("data-oe"); $$("#no-est [data-oe]").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
      $("#no-ok").onclick = async () => {
        const titulo = ($("#no-tit").value || "").trim();
        if (!titulo) { toast("Escribe el problema o título", "err"); return; }
        let otNumero = "";
        try {
          const all = await store.listOrders();
          const yr = new Date().getFullYear();
          const seq = all.filter(o => o.otNumero && o.otNumero.indexOf("OT-" + yr + "-") === 0).length + 1;
          otNumero = "OT-" + yr + "-" + String(seq).padStart(4, "0");
        } catch (e) { otNumero = "OT-" + new Date().getFullYear() + "-" + String(Date.now()).slice(-4); }
        const fecha = $("#no-fecha").value, entrega = $("#no-entrega").value;
        const o = {
          truckId: tId, otNumero, titulo, detalle: ($("#no-det").value || "").trim(),
          sources: f ? [fid] : [], reportadoPor: f ? f.driver : ctx.profile.nombre,
          estado: st.estado, taller: ($("#no-taller").value || "").trim(),
          fechaAgendada: fecha ? new Date(fecha + "T12:00:00").getTime() : null,
          costoEstimado: Math.round(Number($("#no-estim").value) || 0),
          fechaEntregaEstimada: entrega ? new Date(entrega + "T12:00:00").getTime() : null,
          trabajo: "", repuestos: [], manoObra: 0, createdBy: ctx.profile.uid, createdAt: Date.now(), completedAt: null
        };
        const btn = $("#no-ok"); btn.disabled = true; btn.textContent = "Creando...";
        try { const id = await store.saveOrder(null, o); orderDraft = null; closeSheet(); toast("Orden creada: " + otNumero, "ok"); ctx.go("order", { id }); }
        catch (e) { toast("No se pudo crear: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Crear orden"; }
      };
    });
}

// Asignar o cambiar el chofer de un camión desde el panel (supervisor/admin).
async function asignarChofer(ctx, t) {
  let conductores = [];
  try { conductores = (await store.listUsers()).filter(u => u.role === "conductor" && u.activo !== false); }
  catch (e) { toast("No se pudo cargar la lista de conductores", "err"); return; }
  const st = { uid: t.conductorUid || "" };
  const opts = '<option value="">Sin asignar</option>' + conductores.map(u =>
    '<option value="' + esc(u.uid) + '"' + (st.uid === u.uid ? " selected" : "") + ">" + esc(u.nombre || u.email) + "</option>").join("");
  openSheet("Asignar chofer · " + t.num,
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Solo el chofer asignado podrá seleccionar este camión al iniciar su turno. Si su camión queda en taller, podrá tomar un camión de reserva.</p>' +
    '<label class="fld"><span class="lb">Conductor asignado</span><select class="input" id="ac-sel">' + opts + "</select></label>" +
    '<button class="btn btn-primary" id="ac-ok" style="width:100%">' + I.check + "Guardar asignación</button>",
    () => {
      const sel = $("#ac-sel"); if (sel) sel.onchange = () => { st.uid = sel.value; };
      $("#ac-ok").onclick = async () => {
        const cond = conductores.find(u => u.uid === st.uid);
        const btn = $("#ac-ok"); btn.disabled = true; btn.textContent = "Guardando...";
        try {
          await store.saveTruck(t.id, Object.assign({}, t, { conductorUid: cond ? cond.uid : null, conductorNombre: cond ? (cond.nombre || cond.email) : null }));
          closeSheet(); toast(cond ? "Chofer asignado: " + (cond.nombre || cond.email) : "Camión sin chofer asignado", "ok"); ctx.go("home", {});
        } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar asignación"; }
      };
    });
}
function resolveFalla(ctx, fid, fallas) {
  const f = (fallas || []).find(x => x.id === fid);
  openSheet("Descartar falla",
    '<p style="margin:0 0 4px;font-weight:600">' + (f ? esc(f.titulo) : "") + "</p>" +
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">El reporte del chofer se conserva con su fecha, hora, GPS y nombre. Solo se registra que la falla fue descartada, con el motivo.</p>' +
    '<label class="fld"><span class="lb">Motivo del descarte</span><textarea class="input" id="rs-motivo" placeholder="Ej: revisado en terreno, sin problema real"></textarea></label>' +
    '<button class="btn btn-danger" id="rs-ok">Descartar falla</button>',
    () => {
      const ta = $("#rs-motivo"); if (ta) ta.focus();
      $("#rs-ok").onclick = async () => {
        const motivo = ($("#rs-motivo").value || "").trim();
        if (!motivo) { toast("Indica el motivo del descarte", "err"); return; }
        const btn = $("#rs-ok"); btn.disabled = true; btn.textContent = "Descartando...";
        try {
          await store.resolveFalla(fid, {
            titulo: f ? f.titulo : "", truckId: f ? f.truckId : "", origen: f ? f.origen : "",
            driverFalla: f ? f.driver : "", fallaTs: f ? f.ts : null, sev: f ? f.sev : "",
            motivo, por: ctx.profile.nombre, uid: ctx.profile.uid
          });
          closeSheet(); toast("Falla descartada", "ok"); ctx.go("home", {});
        } catch (e) { toast("No se pudo descartar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Descartar falla"; }
      };
    });
}

// ---------------- ORDEN detalle ----------------
async function orderDetail(view, ctx) {
  const orders = await store.listOrders();
  const trucks = await store.listTrucks();
  const o = orders.find(x => x.id === ctx.params.id);
  if (!o) return dashboard(view, ctx);
  const t = trucks.find(x => x.id === o.truckId) || { num: "?", marca: "", patente: "" };
  const editable = can(ctx.profile, "order.manage");
  if (!orderDraft) orderDraft = {
    estado: o.estado, taller: o.taller || "", fecha: o.fechaAgendada ? dInput(o.fechaAgendada) : "",
    estim: o.costoEstimado || "", entrega: o.fechaEntregaEstimada ? dInput(o.fechaEntregaEstimada) : "",
    trabajo: o.trabajo || "", manoObra: o.manoObra || "", repuestos: (o.repuestos || []).map(r => ({ desc: r.desc, costo: r.costo }))
  };
  const d = orderDraft;
  const e = EST[o.estado];
  const estados = ["pendiente", "agendado", "en_taller", "completado"];
  const estChips = estados.map(s => '<button class="chip' + (d.estado === s ? " on" : "") + '" data-est="' + s + '"' + (editable ? "" : " disabled") + ">" + EST[s].l + "</button>").join("");
  const reps = d.repuestos.map((r, i) =>
    '<div class="rep-row"><input class="input" data-rep="' + i + '" data-f="desc" placeholder="Repuesto / descripción" value="' + esc(r.desc || "") + '">' +
    '<input class="input cost num" data-rep="' + i + '" data-f="costo" inputmode="numeric" placeholder="$" value="' + esc(r.costo || "") + '">' +
    '<button class="del" data-delrep="' + i + '">' + I.x + "</button></div>").join("");
  const total = d.repuestos.reduce((s, r) => s + (Number(r.costo) || 0), 0) + (Number(d.manoObra) || 0);
  const showWork = d.estado === "completado" || d.estado === "en_taller";
  const esDesc = o.estado === "descartada";
  const descBanner = esDesc
    ? '<div class="card pad section" style="border-color:var(--line)"><span class="eyebrow" style="display:block;margin-bottom:6px">Orden descartada</span>' +
      '<p style="margin:0;font-size:.9rem;color:var(--ink-2)">' + esc((o.descartada && o.descartada.motivo) || "") + "</p>" +
      '<div class="meta-line" style="margin-top:6px;font-size:.8rem">Por ' + esc((o.descartada && o.descartada.por) || "?") + (o.descartada && o.descartada.ts ? " · " + fmtDateTime(o.descartada.ts) : "") + "</div></div>"
    : "";
  const descBtn = (editable && !esDesc && o.estado !== "completado")
    ? '<div class="section"><button class="btn btn-soft" id="o-descartar" style="width:100%;color:var(--crit)">Descartar orden</button>' +
      '<div class="meta-line" style="font-size:.78rem;margin-top:6px;text-align:center">Anula la orden y deja el camión disponible. El reporte del chofer se conserva.</div></div>'
    : "";

  view.innerHTML =
    '<button class="backlink" id="o-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Orden de taller</h2><span class="pill ' + e.c + '">' + e.l + "</span></div>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum">' + esc(t.num) + "</span>" +
    '<div style="flex:1"><div style="font-weight:700;font-family:Barlow Semi Condensed;font-size:1.05rem">' + esc(o.titulo) + "</div>" +
    '<div class="meta-line" style="margin-top:3px">' + esc(t.marca + " · " + t.patente) + (o.otNumero ? " · " + esc(o.otNumero) : "") + "</div></div></div>" +
    (o.detalle ? '<p style="margin:12px 0 0;font-size:.9rem;color:var(--ink-2)">' + esc(o.detalle) + "</p>" : "") +
    '<div class="meta-line" style="margin-top:8px;font-size:.8rem">Reportado por ' + esc(o.reportadoPor || "chofer") + " · " + fmtDateTime(o.createdAt) + "</div></div>" +
    descBanner +
    '<div class="card pad section"><label class="fld"><span class="lb">Estado</span><div class="chips">' + estChips + "</div></label>" +
    '<label class="fld"><span class="lb">Taller</span><input class="input" id="o-taller" placeholder="Nombre del taller" value="' + esc(d.taller) + '"' + (editable ? "" : " disabled") + "></label>" +
    '<label class="fld"><span class="lb">Fecha agendada</span><input class="input" type="date" id="o-fecha" value="' + esc(d.fecha) + '"' + (editable ? "" : " disabled") + "></label>" +
    '<label class="fld"><span class="lb">Costo estimado de reparación</span><input class="input num" id="o-estim" inputmode="numeric" placeholder="$" value="' + esc(d.estim) + '"' + (editable ? "" : " disabled") + "></label>" +
    '<label class="fld" style="margin-bottom:0"><span class="lb">Fecha estimada de entrega</span><input class="input" type="date" id="o-entrega" value="' + esc(d.entrega) + '"' + (editable ? "" : " disabled") + "></label></div>" +
    (showWork ? '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:12px">Trabajo realizado</span>' +
      '<label class="fld"><span class="lb">Descripción del trabajo</span><textarea class="input" id="o-trabajo" placeholder="Qué se hizo en el taller..."' + (editable ? "" : " disabled") + ">" + esc(d.trabajo) + "</textarea></label>" +
      '<span class="lb" style="display:block;font-family:Barlow Semi Condensed;font-weight:600;font-size:.82rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);margin-bottom:8px">Repuestos</span>' +
      '<div id="rep-list">' + reps + "</div>" +
      (editable ? '<button class="btn sm btn-soft" id="o-addrep" style="margin-bottom:14px">' + I.plus + "Agregar repuesto</button>" : "") +
      '<label class="fld"><span class="lb">Mano de obra</span><input class="input num" id="o-mano" inputmode="numeric" placeholder="$" value="' + esc(d.manoObra) + '"' + (editable ? "" : " disabled") + "></label>" +
      '<div class="total-line"><span class="eyebrow">Costo total</span><b class="num">' + fmtCLP(total) + "</b></div></div>" : "") +
    descBtn +
    (editable && !esDesc ? '<div class="formbar"><button class="btn btn-primary" id="o-save">' + I.check + "Guardar orden</button></div>" : "");

  $("#o-back", view).onclick = () => { orderDraft = null; ctx.go("home", {}); };
  if (!editable || esDesc) return;
  const bd = $("#o-descartar", view); if (bd) bd.onclick = () => descartarOrden(ctx, o);
  $$("[data-est]", view).forEach(b => b.onclick = () => { syncOrder(view); d.estado = b.getAttribute("data-est"); orderDetail(view, ctx); });
  const bindF = (id, f) => { const el = $(id, view); if (el) el.oninput = () => { d[f] = el.value; }; };
  bindF("#o-taller", "taller"); bindF("#o-trabajo", "trabajo"); bindF("#o-mano", "manoObra"); bindF("#o-estim", "estim");
  const fecha = $("#o-fecha", view); if (fecha) fecha.onchange = () => { d.fecha = fecha.value; };
  const entrega = $("#o-entrega", view); if (entrega) entrega.onchange = () => { d.entrega = entrega.value; };
  $$("[data-rep]", view).forEach(inp => inp.oninput = () => {
    const i = +inp.getAttribute("data-rep"), f = inp.getAttribute("data-f");
    d.repuestos[i][f] = inp.value; if (f === "costo") { const el = $(".total-line b", view); if (el) el.textContent = fmtCLP(d.repuestos.reduce((s, r) => s + (Number(r.costo) || 0), 0) + (Number(d.manoObra) || 0)); }
  });
  $$("[data-delrep]", view).forEach(b => b.onclick = () => { syncOrder(view); d.repuestos.splice(+b.getAttribute("data-delrep"), 1); orderDetail(view, ctx); });
  const ar = $("#o-addrep", view); if (ar) ar.onclick = () => { syncOrder(view); d.repuestos.push({ desc: "", costo: "" }); orderDetail(view, ctx); };
  $("#o-save", view).onclick = async () => {
    syncOrder(view);
    if (d.estado === "completado" && !String(d.trabajo).trim()) { toast("Describe el trabajo realizado", "err"); return; }
    const reps = d.repuestos.filter(r => (r.desc && r.desc.trim()) || Number(r.costo)).map(r => ({ desc: (r.desc || "").trim(), costo: Math.round(Number(r.costo) || 0) }));
    const patch = {
      estado: d.estado, taller: String(d.taller).trim(),
      fechaAgendada: d.fecha ? new Date(d.fecha + "T12:00:00").getTime() : null,
      costoEstimado: Math.round(Number(d.estim) || 0),
      fechaEntregaEstimada: d.entrega ? new Date(d.entrega + "T12:00:00").getTime() : null,
      trabajo: String(d.trabajo).trim(), repuestos: reps, manoObra: Math.round(Number(d.manoObra) || 0),
      completedAt: d.estado === "completado" ? (o.completedAt || Date.now()) : null,
      descartada: null
    };
    const btn = $("#o-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.saveOrder(o.id, Object.assign({}, o, patch)); orderDraft = null; toast("Orden actualizada", "ok"); ctx.go("home", {}); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar orden"; }
  };
}
// Descartar (anular) una orden de taller con motivo obligatorio.
// Conserva la orden y el reporte original del chofer; libera el camión.
function descartarOrden(ctx, o) {
  openSheet("Descartar orden",
    '<p style="margin:0 0 4px;font-weight:600">' + esc(o.titulo) + (o.otNumero ? " · " + esc(o.otNumero) : "") + "</p>" +
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">La orden queda anulada y el camión vuelve a estar disponible. El reporte original del chofer (fecha, hora, GPS y nombre) se conserva y no se edita.</p>' +
    '<label class="fld"><span class="lb">Motivo del descarte</span><textarea class="input" id="rs-motivo" placeholder="Ej: revisado en terreno, sin problema real"></textarea></label>' +
    '<button class="btn btn-danger" id="rs-ok">Descartar orden</button>',
    () => {
      const ta = $("#rs-motivo"); if (ta) ta.focus();
      $("#rs-ok").onclick = async () => {
        const motivo = ($("#rs-motivo").value || "").trim();
        if (!motivo) { toast("Indica el motivo del descarte", "err"); return; }
        const btn = $("#rs-ok"); btn.disabled = true; btn.textContent = "Descartando...";
        try {
          const desc = { motivo, por: ctx.profile.nombre, uid: ctx.profile.uid, ts: Date.now() };
          await store.saveOrder(o.id, Object.assign({}, o, { estado: "descartada", descartada: desc }));
          for (const fid of (o.sources || [])) {
            try {
              await store.resolveFalla(fid, {
                titulo: o.titulo, truckId: o.truckId, origen: "Orden " + (o.otNumero || "taller"),
                driverFalla: o.reportadoPor || "", fallaTs: o.createdAt || null, sev: "",
                motivo, por: ctx.profile.nombre, uid: ctx.profile.uid
              });
            } catch (e) { /* la orden ya quedó descartada; el registro de falla es complementario */ }
          }
          orderDraft = null; closeSheet(); toast("Orden descartada", "ok"); ctx.go("home", {});
        } catch (e) { toast("No se pudo descartar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Descartar orden"; }
      };
    });
}
function syncOrder(view) {
  const d = orderDraft; if (!d) return;
  const g = id => { const e = $(id, view); return e ? e.value : undefined; };
  const tl = g("#o-taller"); if (tl !== undefined) d.taller = tl;
  const tr = g("#o-trabajo"); if (tr !== undefined) d.trabajo = tr;
  const mo = g("#o-mano"); if (mo !== undefined) d.manoObra = mo;
  const es = g("#o-estim"); if (es !== undefined) d.estim = es;
  const fc = g("#o-fecha"); if (fc !== undefined) d.fecha = fc;
  const en = g("#o-entrega"); if (en !== undefined) d.entrega = en;
  $$("[data-rep]", view).forEach(inp => { const i = +inp.getAttribute("data-rep"), f = inp.getAttribute("data-f"); if (d.repuestos[i]) d.repuestos[i][f] = inp.value; });
}
