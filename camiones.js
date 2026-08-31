import { store } from "./store.js";
import { can } from "./permissions.js";
import { DOC_TYPES } from "./checklist.js";
import { truckAvailability, deriveFallas } from "./planning.js";
import { I, esc, fmtDate, fmtDateTime, docStatus, iconSpan, emptyBox, toast, $, $$ } from "./ui.js";

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

export async function renderCamiones(view, ctx) {
  if (ctx.route === "truckForm") return truckForm(view, ctx);
  if (ctx.route === "truckDetail") return truckDetail(view, ctx);
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
  const [trucks, orders, fuel, cks, bits, resolved] = await Promise.all([
    store.listTrucks(), store.listOrders().catch(() => []), store.listFuel().catch(() => []),
    store.listChecklists().catch(() => []), store.listBitacora().catch(() => []), store.listResolved().catch(() => [])
  ]);
  const fallas = deriveFallas(cks, bits, orders, resolved);
  const refs = { orders, fuel, fallas };
  const manage = can(ctx.profile, "truck.manage");
  const rows = trucks.length ? trucks.map(t => {
    const av = truckAvailability(t, refs, Date.now());
    const ap = availPill(av.k);
    const w = worstDoc(t);
    const nF = fallas.filter(f => f.truckId === t.id).length;
    return '<div class="row" data-truck="' + t.id + '" style="cursor:pointer"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + ' <span class="plate" style="font-size:.78rem;padding:2px 7px">' + esc(t.patente) + "</span></div>" +
      '<div class="m"><span>' + (t.anio ? "Año " + t.anio : "") + "</span>" +
      '<span class="' + (w.cls === "ok" ? "" : "") + '" style="color:' + (w.cls === "ok" ? "var(--muted)" : "var(--crit)") + '">' + esc(w.label) + "</span>" +
      (nF ? '<span style="color:var(--crit)">' + nF + " falla" + (nF > 1 ? "s" : "") + " por gestionar</span>" : "") +
      (t.activo === false ? '<span style="color:var(--muted)">Inactivo</span>' : "") + "</div></div>" +
      '<span class="pill ' + ap.cls + '"><span class="dot"></span>' + ap.label + "</span></div>";
  }).join("") : emptyBox("No hay camiones registrados");

  view.innerHTML =
    '<button class="backlink" id="cm-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Camiones</h2><span class="meta-line num">' + trucks.length + "</span></div>" +
    (manage ? '<button class="btn btn-primary section" id="cm-new">' + I.plus + "Registrar camión</button>" : "") +
    '<div class="card">' + rows + "</div>";

  $("#cm-back", view).onclick = () => ctx.go("home", {});
  const nb = $("#cm-new", view); if (nb) nb.onclick = () => { form = null; ctx.go("truckForm", {}); };
  $$("[data-truck]", view).forEach(b => b.onclick = () => ctx.go("truckDetail", { id: b.getAttribute("data-truck") }));
}

async function truckDetail(view, ctx) {
  const t = await store.getTruck(ctx.params.id);
  if (!t) return list(view, ctx);
  const manage = can(ctx.profile, "truck.manage");
  const [orders, fuel, cks, bits, resolved] = await Promise.all([
    store.listOrders().catch(() => []), store.listFuel().catch(() => []),
    store.listChecklists().catch(() => []), store.listBitacora().catch(() => []), store.listResolved().catch(() => [])
  ]);
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
    '<div class="meta-line" style="margin-top:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.users + "</span>Conductor: <b style=\"color:var(--ink)\">" + esc(t.conductorNombre || "Sin asignar") + "</b></div></div></div></div>" +
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
