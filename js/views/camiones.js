import { store } from "../store.js";
import { can } from "../permissions.js";
import { DOC_TYPES } from "../checklist.js";
import { truckAvailability, deriveFallas } from "../planning.js";
import { createOrder, reportarFallaAdmin, chooseFallaAction, openFallas } from "./panel.js";
import { I, esc, fmtDate, fmtDateTime, fmtCLP, docStatus, iconSpan, emptyBox, toast, openSheet, closeSheet, $, $$ } from "../ui.js";

const EST_O = { pendiente: "Pendiente", agendado: "Agendado", en_taller: "En taller", completado: "Completado", descartada: "Descartada" };

// Semáforo operativo (mismo criterio del panel).
function availPill(k) {
  if (k === "operativo") return { cls: "ok", label: "Operativo" };
  if (k === "observacion") return { cls: "warn", label: "Observación" };
  return { cls: "crit", label: "No disponible" };
}
// Fallas por gestionar de un camión, con título/origen (para el detalle).
function fallasDe(truckId, cks, bits, orders, resolved) {
  const linked = new Set(); (orders || []).forEach(o => (o.sources || []).forEach(s => linked.add(s)));
  const res = new Set(resolved || []);
  const out = [];
  (cks || []).forEach(c => { if (c.truckId !== truckId) return; (c.fails || []).forEach(f => { const id = "chk:" + c.id + ":" + f.k; if (!linked.has(id) && !res.has(id)) out.push({ titulo: f.n, origen: "Checklist", sev: f.sev || "media", ts: c.ts, detalle: f.note || "" }); }); });
  (bits || []).forEach(b => { if (b.truckId !== truckId) return; if (b.tipo === "Falla mecánica" || b.tipo === "Incidente") { const id = "bit:" + b.id; if (!linked.has(id) && !res.has(id)) out.push({ titulo: b.tipo + ": " + (b.desc || "").slice(0, 44), origen: "Bitácora", sev: b.sev || "media", ts: b.ts, detalle: b.desc || "" }); } });
  return out.sort((a, b) => b.ts - a.ts);
}

let form = null;

let cform = null;

export async function renderCamiones(view, ctx) {
  if (ctx.route === "truckForm") return truckForm(view, ctx);
  if (ctx.route === "truckDetail") return truckDetail(view, ctx);
  if (ctx.route === "carroForm") return carroForm(view, ctx);
  if (ctx.route === "carroDetail") return carroDetail(view, ctx);
  return list(view, ctx);
}

function worstDoc(t) {
  let worst = { k: "vigente", rank: 0 };
  const rankOf = { vigente: 0, none: 1, porvencer: 2, vencido: 3 };
  const check = v => { const st = docStatus(v); if (rankOf[st.k] > worst.rank) worst = { k: st.k, rank: rankOf[st.k], label: st.label, cls: st.cls }; };
  DOC_TYPES.forEach(dt => check(t.docs && t.docs[dt.k] && t.docs[dt.k].vence));
  (t.docs && t.docs.otros || []).forEach(o => check(o.vence));
  if (worst.rank === 0) return { cls: "ok", label: "Docs al día" };
  return { cls: worst.cls || "neutral", label: worst.label || "Sin fecha" };
}

async function list(view, ctx) {
  const [trucks, carros, orders, fuel, cks, bits, resolved] = await Promise.all([
    store.listTrucks(), store.listCarros().catch(() => []), store.listOrders().catch(() => []), store.listFuel().catch(() => []),
    store.listChecklists().catch(() => []), store.listBitacora().catch(() => []), store.listResolved().catch(() => [])
  ]);
  const fallas = deriveFallas(cks, bits, orders, resolved);
  const refs = { orders, fuel, fallas };
  const manage = can(ctx.profile, "truck.manage");
  const carroDe = id => carros.find(c => (c.camionId || "") === id);
  const rows = trucks.length ? trucks.map(t => {
    const av = truckAvailability(t, refs, Date.now());
    const ap = availPill(av.k);
    const w = worstDoc(t);
    const nF = fallas.filter(f => f.truckId === t.id).length;
    const cr = carroDe(t.id);
    return '<div class="row" data-truck="' + t.id + '" style="cursor:pointer"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + ' <span class="plate" style="font-size:.78rem;padding:2px 7px">' + esc(t.patente) + "</span></div>" +
      '<div class="m"><span>' + (t.anio ? "Año " + t.anio : "") + "</span>" +
      '<span class="' + (w.cls === "ok" ? "" : "") + '" style="color:' + (w.cls === "ok" ? "var(--muted)" : "var(--crit)") + '">' + esc(w.label) + "</span>" +
      (nF ? '<span style="color:var(--crit)">' + nF + " falla" + (nF > 1 ? "s" : "") + " por gestionar</span>" : "") +
      (t.activo === false ? '<span style="color:var(--muted)">Inactivo</span>' : "") +
      (cr ? '<span style="flex-basis:100%;color:var(--accent)">' + iconSpan("truck") + "Carro " + esc(cr.num || cr.patente) + "</span>" : "") + "</div></div>" +
      '<span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>";
  }).join("") : emptyBox("No hay camiones registrados");

  const truckNum = id => { const x = trucks.find(y => y.id === id); return x ? x.num : null; };
  const carroRows = carros.length ? carros.map(c => {
    const av = truckAvailability(c, refs, Date.now());
    const ap = availPill(av.k);
    const w = worstDoc(c);
    const nF = fallas.filter(f => f.truckId === c.id).length;
    const asoc = truckNum(c.camionId);
    return '<div class="row" data-carro="' + c.id + '" style="cursor:pointer"><span class="trucknum" style="background:var(--ink-2)">' + esc(c.num || "CA") + "</span>" +
      '<div class="rl"><div class="t">' + esc(c.marca || "Carro") + (c.modelo ? " " + esc(c.modelo) : "") + ' <span class="plate" style="font-size:.78rem;padding:2px 7px">' + esc(c.patente) + "</span></div>" +
      '<div class="m"><span>' + (asoc ? iconSpan("truck") + "Camión " + esc(asoc) : "Sin camión asociado") + "</span>" +
      '<span style="color:' + (w.cls === "ok" ? "var(--muted)" : "var(--crit)") + '">' + esc(w.label) + "</span>" +
      (nF ? '<span style="color:var(--crit)">' + nF + " falla" + (nF > 1 ? "s" : "") + " por gestionar</span>" : "") +
      (c.activo === false ? '<span style="color:var(--muted)">Inactivo</span>' : "") + "</div></div>" +
      '<span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>";
  }).join("") : emptyBox("No hay carros registrados");

  view.innerHTML =
    '<button class="backlink" id="cm-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Camiones</h2><span class="meta-line num">' + trucks.length + "</span></div>" +
    (manage ? '<button class="btn btn-primary section" id="cm-new">' + I.plus + "Registrar camión</button>" : "") +
    '<div class="card">' + rows + "</div>" +
    '<div class="subhead" style="margin-top:22px"><h2>Carros</h2><span class="meta-line num">' + carros.length + "</span></div>" +
    (manage ? '<button class="btn btn-primary section" id="cm-newcarro">' + I.plus + "Registrar carro</button>" : "") +
    '<div class="card">' + carroRows + "</div>";

  $("#cm-back", view).onclick = () => ctx.go("home", {});
  const nb = $("#cm-new", view); if (nb) nb.onclick = () => { form = null; ctx.go("truckForm", {}); };
  const nc = $("#cm-newcarro", view); if (nc) nc.onclick = () => { cform = null; ctx.go("carroForm", {}); };
  $$("[data-truck]", view).forEach(b => b.onclick = () => ctx.go("truckDetail", { id: b.getAttribute("data-truck") }));
  $$("[data-carro]", view).forEach(b => b.onclick = () => ctx.go("carroDetail", { id: b.getAttribute("data-carro") }));
}

async function truckDetail(view, ctx) {
  const t = await store.getTruck(ctx.params.id);
  if (!t) return list(view, ctx);
  const manage = can(ctx.profile, "truck.manage");
  const [orders, fuel, cks, bits, resolved, carros] = await Promise.all([
    store.listOrders().catch(() => []), store.listFuel().catch(() => []),
    store.listChecklists().catch(() => []), store.listBitacora().catch(() => []), store.listResolved().catch(() => []), store.listCarros().catch(() => [])
  ]);
  const carroAsoc = carros.find(c => (c.camionId || "") === t.id);
  const fallas = deriveFallas(cks, bits, orders, resolved);
  const av = truckAvailability(t, { orders, fuel, fallas }, Date.now());
  const ap = availPill(av.k);
  const fList = fallasDe(t.id, cks, bits, orders, resolved);
  const sevPill = { alta: "crit", media: "warn", baja: "neutral" };
  const dotColor = st => st === "bad" ? "var(--crit)" : st === "warn" ? "var(--warn)" : "var(--ok)";

  // Estado operativo (semáforo + detalle de items).
  const estadoCard = '<div class="section"><span class="eyebrow">Estado operativo</span>' +
    '<div class="card pad" style="margin-top:8px">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>" +
    av.items.map(it => '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.88rem">' +
      '<span style="width:9px;height:9px;border-radius:50%;flex:none;background:' + dotColor(it.st) + '"></span>' + esc(it.label) + "</div>").join("") +
    "</div></div>";

  // Fallas por gestionar de este camión.
  const fallasCard = '<div class="section"><span class="eyebrow">Fallas por gestionar' + (fList.length ? " (" + fList.length + ")" : "") + '</span>' +
    '<div class="card" style="margin-top:8px">' +
    (fList.length ? fList.map(f => '<div class="row"><span class="sev-stripe sev-' + f.sev + '"></span><div class="rl">' +
      '<div class="t">' + esc(f.titulo) + ' <span class="pill ' + sevPill[f.sev] + '">' + ({ alta: "Alta", media: "Media", baja: "Baja" }[f.sev]) + "</span></div>" +
      '<div class="m"><span>' + esc(f.origen) + "</span><span>" + fmtDateTime(f.ts) + "</span></div>" +
      (f.detalle ? '<div style="font-size:.85rem;margin-top:3px;color:var(--ink-2)">' + esc(f.detalle) + "</div>" : "") +
      "</div></div>").join("")
      : '<div class="empty">' + I.check + "<div>Sin fallas pendientes para este camión.</div></div>") +
    "</div>" +
    (manage && (av.k !== "operativo" || fList.length) ? '<div class="meta-line" style="font-size:.78rem;margin-top:6px">Gestiona órdenes de taller y el descarte de fallas desde el panel principal.</div>' : "") +
    "</div>";

  const docRow = (nombre, numero, vence) => {
    const st = docStatus(vence);
    return '<div class="doc-row"><div class="dl"><div class="dn">' + esc(nombre) + "</div>" +
      '<div class="dm">N° ' + esc(numero || "sin registro") + (vence ? " · vence " + fmtDate(new Date(vence + "T12:00:00").getTime()) : "") + "</div></div>" +
      '<span class="pill ' + st.cls + '"><span class="dot"></span>' + st.label + (st.days != null && st.k === "porvencer" ? " (" + st.days + "d)" : "") + "</span></div>";
  };
  const docs = DOC_TYPES.map(dt => docRow(dt.n, t.docs && t.docs[dt.k] && t.docs[dt.k].numero, t.docs && t.docs[dt.k] && t.docs[dt.k].vence)).join("") +
    (t.docs && t.docs.otros || []).map(o => docRow(o.nombre, o.numero, o.vence)).join("");

  view.innerHTML =
    '<button class="backlink" id="td-back">' + I.back + " Camiones</button>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum">' + esc(t.num) + "</span>" +
    '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.2rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
    '<div style="margin-top:5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="plate">' + esc(t.patente) + "</span>" +
    (t.anio ? '<span class="meta-line">Año ' + t.anio + "</span>" : "") +
    '<span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span>" +
    (t.activo === false ? '<span class="pill neutral"><span class="dot"></span>Inactivo</span>' : "") + "</div>" +
    '<div class="meta-line" style="margin-top:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.users + "</span>Conductor: <b style=\"color:var(--ink)\">" + esc(t.conductorNombre || "Sin asignar") + "</b></div>" +
    '<div class="meta-line" style="margin-top:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.truck + "</span>Carro: <b style=\"color:var(--ink)\">" + (carroAsoc ? esc((carroAsoc.num || "Carro") + " · " + carroAsoc.patente) : "Sin carro asociado") + "</b></div></div></div></div>" +
    estadoCard + fallasCard +
    '<div class="section"><span class="eyebrow">Documentación</span><div class="card pad" style="margin-top:8px">' + docs + "</div></div>" +
    '<button class="btn btn-soft section" id="td-resumen">' + I.chart + "Ver resumen operativo</button>" +
    (manage ? '<button class="btn btn-soft section" id="td-mant">' + I.wrench + "Pauta de mantención</button>" : "") +
    (manage ? '<button class="btn btn-ghost" id="td-edit">' + I.doc + "Editar datos y documentos</button>" : "");

  $("#td-back", view).onclick = () => ctx.go("camiones", {});
  $("#td-resumen", view).onclick = () => ctx.go("resumen", { id: t.id, from: "camiones" });
  const mb = $("#td-mant", view); if (mb) mb.onclick = () => ctx.go("mantencion", { id: t.id });
  const eb = $("#td-edit", view); if (eb) eb.onclick = () => { form = null; ctx.go("truckForm", { id: t.id }); };
}

async function truckForm(view, ctx) {
  const editing = !!ctx.params.id;
  const t = editing ? await store.getTruck(ctx.params.id) : null;
  const conductores = (await store.listUsers().catch(() => [])).filter(u => u.role === "conductor" && u.activo !== false);
  if (!form) {
    form = t ? {
      num: t.num || "", patente: t.patente || "", marca: t.marca || "", modelo: t.modelo || "", anio: t.anio || "",
      activo: t.activo !== false, conductorUid: t.conductorUid || "",
      docs: {
        permisoCirculacion: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.permisoCirculacion),
        soap: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.soap),
        revisionTecnica: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.revisionTecnica),
        otros: (t.docs && t.docs.otros || []).map(o => ({ nombre: o.nombre, numero: o.numero, vence: o.vence }))
      }
    } : {
      num: "", patente: "", marca: "", modelo: "", anio: "", activo: true, conductorUid: "",
      docs: { permisoCirculacion: { numero: "", vence: "" }, soap: { numero: "", vence: "" }, revisionTecnica: { numero: "", vence: "" }, otros: [] }
    };
  }
  const f = form;
  const condOpts = '<option value="">Sin asignar</option>' + conductores.map(u =>
    '<option value="' + esc(u.uid) + '"' + (f.conductorUid === u.uid ? " selected" : "") + ">" + esc(u.nombre || u.email) + "</option>").join("");
  const docFields = DOC_TYPES.map(dt =>
    '<div class="section" style="margin-bottom:14px"><span class="eyebrow" style="display:block;margin-bottom:8px">' + esc(dt.n) + "</span>" +
    '<div class="grid2"><label class="fld" style="margin:0"><span class="lb">Número</span><input class="input" data-doc="' + dt.k + '" data-f="numero" placeholder="N° de documento" value="' + esc(f.docs[dt.k].numero || "") + '"></label>' +
    '<label class="fld" style="margin:0"><span class="lb">Vence</span><input class="input" type="date" data-doc="' + dt.k + '" data-f="vence" value="' + esc(f.docs[dt.k].vence || "") + '"></label></div></div>'
  ).join("");
  const otros = f.docs.otros.map((o, i) =>
    '<div class="card pad" style="margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input class="input" data-otro="' + i + '" data-f="nombre" placeholder="Nombre del documento" value="' + esc(o.nombre || "") + '"><button class="del" style="width:42px;height:44px;flex:none" data-delotro="' + i + '">' + I.x + "</button></div>" +
    '<div class="grid2"><input class="input" data-otro="' + i + '" data-f="numero" placeholder="Número" value="' + esc(o.numero || "") + '"><input class="input" type="date" data-otro="' + i + '" data-f="vence" value="' + esc(o.vence || "") + '"></div></div>'
  ).join("");

  view.innerHTML =
    '<button class="backlink" id="tf-back">' + I.back + " Cancelar</button>" +
    '<div class="subhead"><h2>' + (editing ? "Editar camión" : "Registrar camión") + "</h2></div>" +
    '<div class="card pad section">' +
      '<div class="grid2"><label class="fld"><span class="lb">N° interno</span><input class="input" id="tf-num" placeholder="C-11" value="' + esc(f.num) + '"></label>' +
      '<label class="fld"><span class="lb">Patente</span><input class="input" id="tf-patente" placeholder="ABCD-12" value="' + esc(f.patente) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Marca</span><input class="input" id="tf-marca" placeholder="Volvo" value="' + esc(f.marca) + '"></label>' +
      '<label class="fld"><span class="lb">Modelo</span><input class="input" id="tf-modelo" placeholder="FH" value="' + esc(f.modelo) + '"></label></div>' +
      '<label class="fld"><span class="lb">Año</span><input class="input num" id="tf-anio" inputmode="numeric" placeholder="2022" value="' + esc(f.anio) + '"></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Conductor asignado</span><select class="input" id="tf-cond">' + condOpts + "</select>" +
      '<span class="meta-line" style="margin-top:6px">Solo este conductor podrá seleccionar el camión al iniciar su turno.</span></label>' +
    "</div>" +
    '<div class="section"><span class="eyebrow" style="display:block;margin:0 2px 10px">Documentación (número y vencimiento)</span>' +
      '<div class="card pad">' + docFields +
      '<span class="eyebrow" style="display:block;margin:6px 0 10px">Otros documentos</span>' + otros +
      '<button class="btn sm btn-soft" id="tf-addotro">' + I.plus + "Agregar otro documento</button></div></div>" +
    '<div class="formbar"><button class="btn btn-primary" id="tf-save">' + I.check + (editing ? "Guardar cambios" : "Registrar camión") + "</button></div>";

  const back = () => { form = null; ctx.go(editing ? "truckDetail" : "camiones", editing ? { id: ctx.params.id } : {}); };
  $("#tf-back", view).onclick = back;
  const bindF = (id, key) => { const el = $(id, view); if (el) el.oninput = () => { f[key] = el.value; }; };
  bindF("#tf-num", "num"); bindF("#tf-patente", "patente"); bindF("#tf-marca", "marca"); bindF("#tf-modelo", "modelo"); bindF("#tf-anio", "anio");
  const condSel = $("#tf-cond", view); if (condSel) condSel.onchange = () => { f.conductorUid = condSel.value; };
  $$("[data-doc]", view).forEach(inp => inp.oninput = () => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-otro]", view).forEach(inp => inp.oninput = () => { const i = +inp.getAttribute("data-otro"); f.docs.otros[i][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-delotro]", view).forEach(b => b.onclick = () => { syncOtros(view); f.docs.otros.splice(+b.getAttribute("data-delotro"), 1); truckForm(view, ctx); });
  $("#tf-addotro", view).onclick = () => { syncOtros(view); f.docs.otros.push({ nombre: "", numero: "", vence: "" }); truckForm(view, ctx); };
  $("#tf-save", view).onclick = async () => {
    syncAll(view);
    if (!f.num.trim() || !f.patente.trim()) { toast("N° interno y patente son obligatorios", "err"); return; }
    const cond = conductores.find(u => u.uid === f.conductorUid);
    const data = {
      num: f.num.trim(), patente: f.patente.trim().toUpperCase(), marca: f.marca.trim(), modelo: f.modelo.trim(),
      anio: f.anio ? Number(f.anio) : null, activo: f.activo !== false,
      conductorUid: cond ? cond.uid : null, conductorNombre: cond ? (cond.nombre || cond.email) : null,
      docs: {
        permisoCirculacion: cleanDoc(f.docs.permisoCirculacion),
        soap: cleanDoc(f.docs.soap),
        revisionTecnica: cleanDoc(f.docs.revisionTecnica),
        otros: f.docs.otros.filter(o => (o.nombre && o.nombre.trim())).map(o => ({ nombre: o.nombre.trim(), numero: (o.numero || "").trim(), vence: o.vence || "" }))
      }
    };
    if (!editing) { data.createdAt = Date.now(); data.createdBy = ctx.profile.uid; }
    const btn = $("#tf-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.saveTruck(editing ? ctx.params.id : null, editing ? Object.assign({}, t, data) : data); form = null; toast(editing ? "Camión actualizado" : "Camión registrado", "ok"); ctx.go("camiones", {}); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar"; }
  };

  function syncOtros(v) { $$("[data-otro]", v).forEach(inp => { const i = +inp.getAttribute("data-otro"); if (f.docs.otros[i]) f.docs.otros[i][inp.getAttribute("data-f")] = inp.value; }); }
  function syncAll(v) {
    ["num", "patente", "marca", "modelo", "anio"].forEach(k => { const el = $("#tf-" + k, v); if (el) f[k] = el.value; });
    const cs = $("#tf-cond", v); if (cs) f.conductorUid = cs.value;
    $$("[data-doc]", v).forEach(inp => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
    syncOtros(v);
  }
}
function cleanDoc(d) { return { numero: (d.numero || "").trim(), vence: d.vence || "" }; }

// Aplica el enroque de la asociación carro-camión y guarda el carro.
// Si el camión destino ya tiene otro carro, ese carro toma el camión anterior.
async function setCarroCamion(carro, newCamionId) {
  const carros = await store.listCarros();
  const prev = carro.camionId || "";
  const nxt = newCamionId || "";
  if (nxt && nxt !== prev) {
    const occ = carros.find(c => c.id !== carro.id && (c.camionId || "") === nxt);
    if (occ) await store.saveTruck(occ.id, Object.assign({}, occ, { camionId: prev || null }));
  }
  await store.saveTruck(carro.id, Object.assign({}, carro, { camionId: nxt || null }));
}

// ---------------- CARRO: formulario ----------------
async function carroForm(view, ctx) {
  const editing = !!ctx.params.id;
  const c = editing ? await store.getTruck(ctx.params.id) : null;
  const trucks = await store.listTrucks().catch(() => []);
  const carros = await store.listCarros().catch(() => []);
  if (!cform) {
    cform = c ? {
      num: c.num || "", patente: c.patente || "", marca: c.marca || "", modelo: c.modelo || "", anio: c.anio || "",
      activo: c.activo !== false, camionId: c.camionId || "",
      docs: {
        permisoCirculacion: Object.assign({ numero: "", vence: "" }, c.docs && c.docs.permisoCirculacion),
        soap: Object.assign({ numero: "", vence: "" }, c.docs && c.docs.soap),
        revisionTecnica: Object.assign({ numero: "", vence: "" }, c.docs && c.docs.revisionTecnica),
        otros: (c.docs && c.docs.otros || []).map(o => ({ nombre: o.nombre, numero: o.numero, vence: o.vence }))
      }
    } : {
      num: "", patente: "", marca: "", modelo: "", anio: "", activo: true, camionId: "",
      docs: { permisoCirculacion: { numero: "", vence: "" }, soap: { numero: "", vence: "" }, revisionTecnica: { numero: "", vence: "" }, otros: [] }
    };
  }
  const f = cform;
  // Para el select: camión libre o el ya asociado a este carro.
  const asignados = {}; carros.forEach(x => { if (x.camionId && x.id !== (editing ? ctx.params.id : null)) asignados[x.camionId] = true; });
  const camOpts = '<option value="">Sin camión asociado</option>' + trucks.map(t =>
    '<option value="' + esc(t.id) + '"' + (f.camionId === t.id ? " selected" : "") + ">" + esc(t.num + " · " + t.patente) + (asignados[t.id] ? " (tiene carro — se enroca)" : "") + "</option>").join("");
  const docFields = DOC_TYPES.map(dt =>
    '<div class="section" style="margin-bottom:14px"><span class="eyebrow" style="display:block;margin-bottom:8px">' + esc(dt.n) + "</span>" +
    '<div class="grid2"><label class="fld" style="margin:0"><span class="lb">Número</span><input class="input" data-doc="' + dt.k + '" data-f="numero" placeholder="N° de documento" value="' + esc(f.docs[dt.k].numero || "") + '"></label>' +
    '<label class="fld" style="margin:0"><span class="lb">Vence</span><input class="input" type="date" data-doc="' + dt.k + '" data-f="vence" value="' + esc(f.docs[dt.k].vence || "") + '"></label></div></div>').join("");
  const otros = f.docs.otros.map((o, i) =>
    '<div class="card pad" style="margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input class="input" data-otro="' + i + '" data-f="nombre" placeholder="Nombre del documento" value="' + esc(o.nombre || "") + '"><button class="del" style="width:42px;height:44px;flex:none" data-delotro="' + i + '">' + I.x + "</button></div>" +
    '<div class="grid2"><input class="input" data-otro="' + i + '" data-f="numero" placeholder="Número" value="' + esc(o.numero || "") + '"><input class="input" type="date" data-otro="' + i + '" data-f="vence" value="' + esc(o.vence || "") + '"></div></div>').join("");

  view.innerHTML =
    '<button class="backlink" id="cf-back">' + I.back + " Cancelar</button>" +
    '<div class="subhead"><h2>' + (editing ? "Editar carro" : "Registrar carro") + "</h2></div>" +
    '<div class="card pad section">' +
      '<div class="grid2"><label class="fld"><span class="lb">N° interno</span><input class="input" id="cf-num" placeholder="R-1" value="' + esc(f.num) + '"></label>' +
      '<label class="fld"><span class="lb">Patente</span><input class="input" id="cf-patente" placeholder="ABCD-12" value="' + esc(f.patente) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Marca</span><input class="input" id="cf-marca" placeholder="(opcional)" value="' + esc(f.marca) + '"></label>' +
      '<label class="fld"><span class="lb">Año</span><input class="input num" id="cf-anio" inputmode="numeric" placeholder="2022" value="' + esc(f.anio) + '"></label></div>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Camión asociado</span><select class="input" id="cf-camion">' + camOpts + "</select>" +
      '<span class="meta-line" style="margin-top:6px">Un carro se asocia a un solo camión. Si el camión elegido ya tiene un carro, se enrocan automáticamente.</span></label>' +
    "</div>" +
    '<div class="section"><span class="eyebrow" style="display:block;margin:0 2px 10px">Documentación (número y vencimiento)</span>' +
      '<div class="card pad">' + docFields +
      '<span class="eyebrow" style="display:block;margin:6px 0 10px">Otros documentos</span>' + otros +
      '<button class="btn sm btn-soft" id="cf-addotro">' + I.plus + "Agregar otro documento</button></div></div>" +
    '<div class="formbar"><button class="btn btn-primary" id="cf-save">' + I.check + (editing ? "Guardar cambios" : "Registrar carro") + "</button></div>";

  const back = () => { cform = null; ctx.go(editing ? "carroDetail" : "camiones", editing ? { id: ctx.params.id } : {}); };
  $("#cf-back", view).onclick = back;
  const bindF = (id, key) => { const el = $(id, view); if (el) el.oninput = () => { f[key] = el.value; }; };
  bindF("#cf-num", "num"); bindF("#cf-patente", "patente"); bindF("#cf-marca", "marca"); bindF("#cf-anio", "anio");
  const camSel = $("#cf-camion", view); if (camSel) camSel.onchange = () => { f.camionId = camSel.value; };
  $$("[data-doc]", view).forEach(inp => inp.oninput = () => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-otro]", view).forEach(inp => inp.oninput = () => { const i = +inp.getAttribute("data-otro"); f.docs.otros[i][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-delotro]", view).forEach(b => b.onclick = () => { syncOtros(view); f.docs.otros.splice(+b.getAttribute("data-delotro"), 1); carroForm(view, ctx); });
  $("#cf-addotro", view).onclick = () => { syncOtros(view); f.docs.otros.push({ nombre: "", numero: "", vence: "" }); carroForm(view, ctx); };
  $("#cf-save", view).onclick = async () => {
    syncAll(view);
    if (!f.patente.trim()) { toast("La patente es obligatoria", "err"); return; }
    const nxt = f.camionId || "";
    const data = {
      tipo: "carro", num: f.num.trim(), patente: f.patente.trim().toUpperCase(), marca: f.marca.trim(), modelo: (f.modelo || "").trim(),
      anio: f.anio ? Number(f.anio) : null, activo: f.activo !== false, camionId: nxt || null,
      docs: {
        permisoCirculacion: cleanDoc(f.docs.permisoCirculacion),
        soap: cleanDoc(f.docs.soap),
        revisionTecnica: cleanDoc(f.docs.revisionTecnica),
        otros: f.docs.otros.filter(o => (o.nombre && o.nombre.trim())).map(o => ({ nombre: o.nombre.trim(), numero: (o.numero || "").trim(), vence: o.vence || "" }))
      }
    };
    if (!editing) { data.createdAt = Date.now(); data.createdBy = ctx.profile.uid; }
    const btn = $("#cf-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try {
      const prev = editing ? (c.camionId || "") : "";
      // Enroque: si el camión destino ya tiene otro carro, ese toma el camión anterior.
      if (nxt && nxt !== prev) {
        const occ = carros.find(x => x.id !== (editing ? ctx.params.id : null) && (x.camionId || "") === nxt);
        if (occ) await store.saveTruck(occ.id, Object.assign({}, occ, { camionId: prev || null }));
      }
      await store.saveTruck(editing ? ctx.params.id : null, editing ? Object.assign({}, c, data) : data);
      cform = null; toast(editing ? "Carro actualizado" : "Carro registrado", "ok"); ctx.go("camiones", {});
    } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar"; }
  };
  function syncOtros(v) { $$("[data-otro]", v).forEach(inp => { const i = +inp.getAttribute("data-otro"); if (f.docs.otros[i]) f.docs.otros[i][inp.getAttribute("data-f")] = inp.value; }); }
  function syncAll(v) {
    ["num", "patente", "marca", "anio"].forEach(k => { const el = $("#cf-" + k, v); if (el) f[k] = el.value; });
    const cs = $("#cf-camion", v); if (cs) f.camionId = cs.value;
    $$("[data-doc]", v).forEach(inp => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
    syncOtros(v);
  }
}

// ---------------- CARRO: detalle (docs, asociación, fallas, órdenes) ----------------
async function carroDetail(view, ctx) {
  const c = await store.getTruck(ctx.params.id);
  if (!c || c.tipo !== "carro") return list(view, ctx);
  const manage = can(ctx.profile, "truck.manage");
  const [orders, cks, bits, resolved, trucks] = await Promise.all([
    store.listOrders().catch(() => []), store.listChecklists().catch(() => []),
    store.listBitacora().catch(() => []), store.listResolved().catch(() => []), store.listTrucks().catch(() => [])
  ]);
  const av = truckAvailability(c, { orders, fuel: [], fallas: deriveFallas(cks, bits, orders, resolved) }, Date.now());
  const ap = availPill(av.k);
  const fList = openFallas(cks, bits, orders, resolved).filter(f => f.truckId === c.id);
  const cOrders = orders.filter(o => o.truckId === c.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const asoc = trucks.find(t => t.id === (c.camionId || ""));
  const sevPill = { alta: "crit", media: "warn", baja: "neutral" };
  const dotColor = st => st === "bad" ? "var(--crit)" : st === "warn" ? "var(--warn)" : "var(--ok)";

  const estadoCard = '<div class="section"><span class="eyebrow">Estado</span><div class="card pad" style="margin-top:8px">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>" +
    av.items.map(it => '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.88rem"><span style="width:9px;height:9px;border-radius:50%;flex:none;background:' + dotColor(it.st) + '"></span>' + esc(it.label) + "</div>").join("") +
    "</div></div>";

  const fallasCard = '<div class="section"><span class="eyebrow">Fallas por gestionar' + (fList.length ? " (" + fList.length + ")" : "") + '</span>' +
    '<div class="card" style="margin-top:8px">' +
    (fList.length ? fList.map(f => '<div class="row"' + (manage ? ' data-falla="' + esc(f.id) + '" style="cursor:pointer"' : "") + '><span class="sev-stripe sev-' + f.sev + '"></span><div class="rl">' +
      '<div class="t">' + esc(f.titulo) + ' <span class="pill ' + sevPill[f.sev] + '">' + ({ alta: "Alta", media: "Media", baja: "Baja" }[f.sev]) + "</span></div>" +
      '<div class="m"><span>' + esc(f.origen) + "</span><span>" + fmtDateTime(f.ts) + "</span>" + (manage ? "<span>Toca para gestionar</span>" : "") + "</div></div>" + (manage ? "<span class='arrow'>" + I.arrow + "</span>" : "") + "</div>").join("")
      : '<div class="empty">' + I.check + "<div>Sin fallas pendientes para este carro.</div></div>") + "</div>" +
    (manage ? '<button class="btn btn-soft" style="margin-top:10px;color:var(--crit)" id="cd-falla">' + I.alert + "Reportar falla</button>" : "") + "</div>";

  const ordersCard = '<div class="section"><span class="eyebrow">Órdenes de taller</span><div class="card" style="margin-top:8px">' +
    (cOrders.length ? cOrders.map(o => '<div class="row" data-order="' + esc(o.id) + '" style="cursor:pointer"><div class="rl"><div class="t">' + esc(o.titulo) +
      ' <span class="pill ' + (o.estado === "completado" ? "ok" : o.estado === "en_taller" ? "crit" : o.estado === "descartada" ? "neutral" : "warn") + '">' + (EST_O[o.estado] || o.estado) + "</span></div>" +
      '<div class="m">' + (o.otNumero ? "<span>" + esc(o.otNumero) + "</span>" : "") + (o.taller ? "<span>" + esc(o.taller) + "</span>" : "") + "</div></div><span class='arrow'>" + I.arrow + "</span></div>").join("")
      : '<div class="empty">' + I.wrench + "<div>Sin órdenes de taller.</div></div>") + "</div>" +
    (manage ? '<button class="btn btn-soft" style="margin-top:10px" id="cd-order">' + I.wrench + "Generar orden de taller</button>" : "") + "</div>";

  const docRow = (nombre, numero, vence) => {
    const st = docStatus(vence);
    return '<div class="doc-row"><div class="dl"><div class="dn">' + esc(nombre) + "</div>" +
      '<div class="dm">N° ' + esc(numero || "sin registro") + (vence ? " · vence " + fmtDate(new Date(vence + "T12:00:00").getTime()) : "") + "</div></div>" +
      '<span class="pill ' + st.cls + '"><span class="dot"></span>' + st.label + (st.days != null && st.k === "porvencer" ? " (" + st.days + "d)" : "") + "</span></div>";
  };
  const docs = DOC_TYPES.map(dt => docRow(dt.n, c.docs && c.docs[dt.k] && c.docs[dt.k].numero, c.docs && c.docs[dt.k] && c.docs[dt.k].vence)).join("") +
    (c.docs && c.docs.otros || []).map(o => docRow(o.nombre, o.numero, o.vence)).join("");

  view.innerHTML =
    '<button class="backlink" id="cd-back">' + I.back + " Camiones</button>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum" style="background:var(--ink-2)">' + esc(c.num || "CA") + "</span>" +
    '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.2rem">' + esc(c.marca ? c.marca + " " + (c.modelo || "") : "Carro") + "</div>" +
    '<div style="margin-top:5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="plate">' + esc(c.patente) + "</span>" +
    (c.anio ? '<span class="meta-line">Año ' + c.anio + "</span>" : "") +
    '<span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>" +
    '<div class="meta-line" style="margin-top:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.truck + "</span>Camión asociado: <b style=\"color:var(--ink)\">" + (asoc ? esc(asoc.num + " · " + asoc.patente) : "Sin asociar") + "</b></div></div></div>" +
    (manage ? '<button class="btn sm btn-soft" style="margin-top:12px" id="cd-asociar">' + I.truck + "Cambiar camión asociado</button>" : "") + "</div>" +
    estadoCard + fallasCard + ordersCard +
    '<div class="section"><span class="eyebrow">Documentación</span><div class="card pad" style="margin-top:8px">' + docs + "</div></div>" +
    (manage ? '<button class="btn btn-ghost" id="cd-edit">' + I.doc + "Editar datos y documentos</button>" : "");

  $("#cd-back", view).onclick = () => ctx.go("camiones", {});
  const eb = $("#cd-edit", view); if (eb) eb.onclick = () => { cform = null; ctx.go("carroForm", { id: c.id }); };
  const ob = $("#cd-order", view); if (ob) ob.onclick = () => createOrder(ctx, null, [], c.id);
  const fb = $("#cd-falla", view); if (fb) fb.onclick = () => reportarFallaAdmin(ctx, c.id, c.num || c.patente);
  $$("[data-falla]", view).forEach(b => b.onclick = () => chooseFallaAction(ctx, b.getAttribute("data-falla"), fList));
  $$("[data-order]", view).forEach(b => b.onclick = () => ctx.go("order", { id: b.getAttribute("data-order"), carroId: c.id }));
  const ab = $("#cd-asociar", view); if (ab) ab.onclick = () => asociarCamion(ctx, c, trucks);
}

// Sheet rápido para asociar/cambiar el camión de un carro (con enroque).
function asociarCamion(ctx, carro, trucks) {
  const opts = '<option value="">Sin camión asociado</option>' + trucks.map(t =>
    '<option value="' + esc(t.id) + '"' + ((carro.camionId || "") === t.id ? " selected" : "") + ">" + esc(t.num + " · " + t.patente) + "</option>").join("");
  openSheet("Camión asociado · " + esc(carro.num || carro.patente),
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Un carro va con un solo camión. Si el camión elegido ya tiene un carro, se enrocan automáticamente.</p>' +
    '<label class="fld"><span class="lb">Camión</span><select class="input" id="ac-sel">' + opts + "</select></label>" +
    '<button class="btn btn-primary" id="ac-ok" style="width:100%">' + I.check + "Guardar asociación</button>",
    () => {
      $("#ac-ok").onclick = async () => {
        const val = $("#ac-sel").value;
        const btn = $("#ac-ok"); btn.disabled = true; btn.textContent = "Guardando...";
        try { await setCarroCamion(carro, val); closeSheet(); toast("Asociación actualizada", "ok"); ctx.go("carroDetail", { id: carro.id }); }
        catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar asociación"; }
      };
    });
}
