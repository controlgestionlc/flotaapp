import { store } from "../store.js";
import { can } from "../permissions.js";
import { DOC_TYPES } from "../checklist.js";
import {
  I, esc, fmtCLP, fmtDate, fmtDateTime, monthKey, dInput, docStatus,
  iconSpan, emptyBox, toast, $, $$
} from "../ui.js";

const EST = {
  pendiente: { l: "Pendiente", c: "neutral" }, agendado: { l: "Agendado", c: "warn" },
  en_taller: { l: "En taller", c: "crit" }, completado: { l: "Completado", c: "ok" }
};

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
  const open = orders.filter(o => o.truckId === id && o.estado !== "completado");
  if (open.some(o => o.estado === "en_taller")) return { cls: "crit", label: "En taller" };
  const fs = fallas.filter(f => f.truckId === id);
  if (fs.some(f => f.sev === "alta")) return { cls: "crit", label: "Con falla" };
  if (fs.length || open.length) return { cls: "warn", label: "Con novedad" };
  return { cls: "ok", label: "Operativo" };
}
function orderTotal(o) { return (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0) + (Number(o.manoObra) || 0); }

function docAlerts(trucks) {
  let vencidos = 0, porvencer = 0;
  trucks.forEach(t => {
    DOC_TYPES.forEach(dt => {
      const st = docStatus(t.docs && t.docs[dt.k] && t.docs[dt.k].vence);
      if (st.k === "vencido") vencidos++; else if (st.k === "porvencer") porvencer++;
    });
    (t.docs && t.docs.otros || []).forEach(o => {
      const st = docStatus(o.vence); if (st.k === "vencido") vencidos++; else if (st.k === "porvencer") porvencer++;
    });
  });
  return { vencidos, porvencer };
}

async function dashboard(view, ctx) {
  const p = ctx.profile;
  const [trucks, cks, bits, orders, resolved] = await Promise.all([
    store.listTrucks(), store.listChecklists(), store.listBitacora(), store.listOrders(), store.listResolved()
  ]);
  const fallas = openFallas(cks, bits, orders, resolved);
  const manage = can(p, "order.manage");
  const conNovedad = trucks.filter(t => truckStatus(t.id, orders, fallas).cls !== "ok").length;
  const operativos = trucks.length - conNovedad;
  const openOrders = orders.filter(o => o.estado !== "completado");
  const mesTotal = orders.filter(o => o.estado === "completado" && monthKey(o.completedAt) === monthKey()).reduce((s, o) => s + orderTotal(o), 0);
  const docs = docAlerts(trucks);

  const kpis = '<div class="kpis section">' +
    kpi("a", operativos + "/" + trucks.length, "Operativos", "camiones sin novedad") +
    kpi(fallas.length ? "c" : "g", String(fallas.length), "Fallas por gestionar", fallas.length ? "requieren acción" : "todo al día") +
    kpi("w", String(openOrders.length), "Órdenes abiertas", "en proceso o agendadas") +
    kpi("a", fmtCLP(mesTotal), "Costo del mes", "taller completado") +
    "</div>";

  const docBanner = (docs.vencidos || docs.porvencer)
    ? '<div class="banner" id="doc-banner" style="cursor:pointer">' + I.alert +
      "<div><b>Documentación:</b> " + (docs.vencidos ? docs.vencidos + " vencido(s)" : "") +
      (docs.vencidos && docs.porvencer ? " y " : "") + (docs.porvencer ? docs.porvencer + " por vencer" : "") +
      ". Toca para revisar los camiones.</div></div>"
    : "";

  const navRow = '<div class="section" style="display:grid;grid-template-columns:1fr' + (can(p, "user.manage") ? " 1fr" : "") + ';gap:10px">' +
    '<button class="btn btn-ghost" id="nav-camiones">' + I.truck + "Camiones</button>" +
    (can(p, "user.manage") ? '<button class="btn btn-ghost" id="nav-usuarios">' + I.users + "Usuarios</button>" : "") +
    "</div>";

  const fallaCards = !can(p, "falla.view") ? "" :
    ('<div class="section"><div class="subhead"><h2>Fallas por gestionar</h2></div><div class="card">' +
      (fallas.length ? fallas.map(f => {
        const t = trucks.find(x => x.id === f.truckId) || { num: "?", patente: "" };
        return '<div class="row"><span class="sev-stripe sev-' + f.sev + '"></span><div class="rl">' +
          '<div class="t">' + esc(f.titulo) + ' <span class="pill ' + (f.sev === "alta" ? "crit" : f.sev === "media" ? "warn" : "neutral") + '">' + ({ alta: "Alta", media: "Media", baja: "Baja" }[f.sev]) + "</span></div>" +
          '<div class="m"><span>' + iconSpan("truck") + esc(t.num + " · " + t.patente) + "</span><span>" + esc(f.origen) + "</span><span>" + fmtDateTime(f.ts) + "</span></div>" +
          (f.detalle ? '<div style="font-size:.86rem;margin-top:4px;color:var(--ink-2)">' + esc(f.detalle) + "</div>" : "") +
          (manage ? '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn sm btn-steel" data-order="' + esc(f.id) + '">' + I.wrench + "Crear orden</button>" +
            '<button class="btn sm btn-soft" data-resolve="' + esc(f.id) + '">Descartar</button></div>' : "") +
          "</div></div>";
      }).join("") : '<div class="empty">' + I.check + "<div>No hay fallas pendientes. Flota al día.</div></div>") +
      "</div></div>");

  const openList = openOrders.sort((a, b) => b.createdAt - a.createdAt);
  const orderCards = '<div class="section"><div class="subhead"><h2>Órdenes de taller</h2><span class="pill steel">' + openOrders.length + ' abiertas</span></div><div class="card">' +
    (openList.length ? openList.map(o => orderRow(o, trucks)).join("") : '<div class="empty">' + I.wrench + "<div>Sin órdenes de taller abiertas</div></div>") + "</div></div>";

  const done = orders.filter(o => o.estado === "completado").sort((a, b) => b.completedAt - a.completedAt).slice(0, 4);
  const doneBlock = done.length ? '<div class="section"><span class="eyebrow">Últimas completadas</span><div class="card" style="margin-top:8px">' + done.map(o => orderRow(o, trucks)).join("") + "</div></div>" : "";

  view.innerHTML = docBanner + kpis + navRow + fallaCards + orderCards + doneBlock;

  $("#nav-camiones", view).onclick = () => ctx.go("camiones", {});
  const nu = $("#nav-usuarios", view); if (nu) nu.onclick = () => ctx.go("usuarios", {});
  const db = $("#doc-banner", view); if (db) db.onclick = () => ctx.go("camiones", {});
  $$("[data-order]", view).forEach(b => b.onclick = () => createOrder(ctx, b.getAttribute("data-order"), fallas));
  $$("[data-resolve]", view).forEach(b => b.onclick = () => resolveFalla(ctx, b.getAttribute("data-resolve")));
  $$("[data-openorder]", view).forEach(b => b.onclick = () => { orderDraft = null; ctx.go("order", { id: b.getAttribute("data-openorder") }); });
}

function kpi(cls, val, lab, sub) {
  return '<div class="kpi ' + cls + '"><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";
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

async function createOrder(ctx, fid, fallas) {
  const f = fallas.find(x => x.id === fid); if (!f) return;
  const o = {
    truckId: f.truckId, titulo: f.titulo.length > 46 ? f.titulo.slice(0, 46) + "..." : f.titulo, detalle: f.detalle,
    sources: [fid], reportadoPor: f.driver, estado: "agendado", taller: "", fechaAgendada: null,
    trabajo: "", repuestos: [], manoObra: 0, createdBy: ctx.profile.uid, createdAt: Date.now(), completedAt: null
  };
  try { await store.saveOrder(null, o); toast("Orden de taller creada", "ok"); ctx.go("home", {}); }
  catch (e) { toast("No se pudo crear: " + (e.message || e), "err"); }
}
async function resolveFalla(ctx, fid) {
  try { await store.resolveFalla(fid); toast("Falla descartada", "ok"); ctx.go("home", {}); }
  catch (e) { toast("No se pudo descartar: " + (e.message || e), "err"); }
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

  view.innerHTML =
    '<button class="backlink" id="o-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Orden de taller</h2><span class="pill ' + e.c + '">' + e.l + "</span></div>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum">' + esc(t.num) + "</span>" +
    '<div style="flex:1"><div style="font-weight:700;font-family:Barlow Semi Condensed;font-size:1.05rem">' + esc(o.titulo) + "</div>" +
    '<div class="meta-line" style="margin-top:3px">' + esc(t.marca + " · " + t.patente) + "</div></div></div>" +
    (o.detalle ? '<p style="margin:12px 0 0;font-size:.9rem;color:var(--ink-2)">' + esc(o.detalle) + "</p>" : "") +
    '<div class="meta-line" style="margin-top:8px;font-size:.8rem">Reportado por ' + esc(o.reportadoPor || "chofer") + " · " + fmtDateTime(o.createdAt) + "</div></div>" +
    '<div class="card pad section"><label class="fld"><span class="lb">Estado</span><div class="chips">' + estChips + "</div></label>" +
    '<label class="fld"><span class="lb">Taller</span><input class="input" id="o-taller" placeholder="Nombre del taller" value="' + esc(d.taller) + '"' + (editable ? "" : " disabled") + "></label>" +
    '<label class="fld" style="margin-bottom:0"><span class="lb">Fecha agendada</span><input class="input" type="date" id="o-fecha" value="' + esc(d.fecha) + '"' + (editable ? "" : " disabled") + "></label></div>" +
    (showWork ? '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:12px">Trabajo realizado</span>' +
      '<label class="fld"><span class="lb">Descripción del trabajo</span><textarea class="input" id="o-trabajo" placeholder="Qué se hizo en el taller..."' + (editable ? "" : " disabled") + ">" + esc(d.trabajo) + "</textarea></label>" +
      '<span class="lb" style="display:block;font-family:Barlow Semi Condensed;font-weight:600;font-size:.82rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);margin-bottom:8px">Repuestos</span>' +
      '<div id="rep-list">' + reps + "</div>" +
      (editable ? '<button class="btn sm btn-soft" id="o-addrep" style="margin-bottom:14px">' + I.plus + "Agregar repuesto</button>" : "") +
      '<label class="fld"><span class="lb">Mano de obra</span><input class="input num" id="o-mano" inputmode="numeric" placeholder="$" value="' + esc(d.manoObra) + '"' + (editable ? "" : " disabled") + "></label>" +
      '<div class="total-line"><span class="eyebrow">Costo total</span><b class="num">' + fmtCLP(total) + "</b></div></div>" : "") +
    (editable ? '<div class="formbar"><button class="btn btn-primary" id="o-save">' + I.check + "Guardar orden</button></div>" : "");

  $("#o-back", view).onclick = () => { orderDraft = null; ctx.go("home", {}); };
  if (!editable) return;
  $$("[data-est]", view).forEach(b => b.onclick = () => { syncOrder(view); d.estado = b.getAttribute("data-est"); orderDetail(view, ctx); });
  const bindF = (id, f) => { const el = $(id, view); if (el) el.oninput = () => { d[f] = el.value; }; };
  bindF("#o-taller", "taller"); bindF("#o-trabajo", "trabajo"); bindF("#o-mano", "manoObra");
  const fecha = $("#o-fecha", view); if (fecha) fecha.onchange = () => { d.fecha = fecha.value; };
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
      trabajo: String(d.trabajo).trim(), repuestos: reps, manoObra: Math.round(Number(d.manoObra) || 0),
      completedAt: d.estado === "completado" ? (o.completedAt || Date.now()) : null
    };
    const btn = $("#o-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.saveOrder(o.id, Object.assign({}, o, patch)); orderDraft = null; toast("Orden actualizada", "ok"); ctx.go("home", {}); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar orden"; }
  };
}
function syncOrder(view) {
  const d = orderDraft; if (!d) return;
  const g = id => { const e = $(id, view); return e ? e.value : undefined; };
  const tl = g("#o-taller"); if (tl !== undefined) d.taller = tl;
  const tr = g("#o-trabajo"); if (tr !== undefined) d.trabajo = tr;
  const mo = g("#o-mano"); if (mo !== undefined) d.manoObra = mo;
  const fc = g("#o-fecha"); if (fc !== undefined) d.fecha = fc;
  $$("[data-rep]", view).forEach(inp => { const i = +inp.getAttribute("data-rep"), f = inp.getAttribute("data-f"); if (d.repuestos[i]) d.repuestos[i][f] = inp.value; });
}
