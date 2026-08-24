import { store } from "../store.js";
import { can } from "../permissions.js";
import { DOC_TYPES } from "../checklist.js";
import { I, esc, fmtDate, docStatus, emptyBox, toast, $, $$ } from "../ui.js";

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
  const trucks = await store.listTrucks();
  const manage = can(ctx.profile, "truck.manage");
  const rows = trucks.length ? trucks.map(t => {
    const w = worstDoc(t);
    return '<div class="row" data-truck="' + t.id + '" style="cursor:pointer"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + ' <span class="plate" style="font-size:.78rem;padding:2px 7px">' + esc(t.patente) + "</span></div>" +
      '<div class="m"><span>' + (t.anio ? "Año " + t.anio : "") + "</span>" + (t.activo === false ? '<span style="color:var(--muted)">Inactivo</span>' : "") + "</div></div>" +
      '<span class="pill ' + w.cls + '"><span class="dot"></span>' + w.label + "</span></div>";
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
    '<span class="pill ' + (t.activo === false ? "neutral" : "ok") + '"><span class="dot"></span>' + (t.activo === false ? "Inactivo" : "Activo") + "</span></div></div></div></div>" +
    '<div class="section"><span class="eyebrow">Documentación</span><div class="card pad" style="margin-top:8px">' + docs + "</div></div>" +
    (manage ? '<button class="btn btn-ghost" id="td-edit">' + I.doc + "Editar datos y documentos</button>" : "");

  $("#td-back", view).onclick = () => ctx.go("camiones", {});
  const eb = $("#td-edit", view); if (eb) eb.onclick = () => { form = null; ctx.go("truckForm", { id: t.id }); };
}

async function truckForm(view, ctx) {
  const editing = !!ctx.params.id;
  const t = editing ? await store.getTruck(ctx.params.id) : null;
  if (!form) {
    form = t ? {
      num: t.num || "", patente: t.patente || "", marca: t.marca || "", modelo: t.modelo || "", anio: t.anio || "",
      activo: t.activo !== false,
      docs: {
        permisoCirculacion: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.permisoCirculacion),
        soap: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.soap),
        revisionTecnica: Object.assign({ numero: "", vence: "" }, t.docs && t.docs.revisionTecnica),
        otros: (t.docs && t.docs.otros || []).map(o => ({ nombre: o.nombre, numero: o.numero, vence: o.vence }))
      }
    } : {
      num: "", patente: "", marca: "", modelo: "", anio: "", activo: true,
      docs: { permisoCirculacion: { numero: "", vence: "" }, soap: { numero: "", vence: "" }, revisionTecnica: { numero: "", vence: "" }, otros: [] }
    };
  }
  const f = form;
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
      '<label class="fld" style="margin-bottom:0"><span class="lb">Año</span><input class="input num" id="tf-anio" inputmode="numeric" placeholder="2022" value="' + esc(f.anio) + '"></label>' +
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
  $$("[data-doc]", view).forEach(inp => inp.oninput = () => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-otro]", view).forEach(inp => inp.oninput = () => { const i = +inp.getAttribute("data-otro"); f.docs.otros[i][inp.getAttribute("data-f")] = inp.value; });
  $$("[data-delotro]", view).forEach(b => b.onclick = () => { syncOtros(view); f.docs.otros.splice(+b.getAttribute("data-delotro"), 1); truckForm(view, ctx); });
  $("#tf-addotro", view).onclick = () => { syncOtros(view); f.docs.otros.push({ nombre: "", numero: "", vence: "" }); truckForm(view, ctx); };
  $("#tf-save", view).onclick = async () => {
    syncAll(view);
    if (!f.num.trim() || !f.patente.trim()) { toast("N° interno y patente son obligatorios", "err"); return; }
    const data = {
      num: f.num.trim(), patente: f.patente.trim().toUpperCase(), marca: f.marca.trim(), modelo: f.modelo.trim(),
      anio: f.anio ? Number(f.anio) : null, activo: f.activo !== false,
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
    $$("[data-doc]", v).forEach(inp => { f.docs[inp.getAttribute("data-doc")][inp.getAttribute("data-f")] = inp.value; });
    syncOtros(v);
  }
}
function cleanDoc(d) { return { numero: (d.numero || "").trim(), vence: d.vence || "" }; }
