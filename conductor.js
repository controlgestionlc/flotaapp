import { store } from "../store.js";
import { CK_ITEMS } from "../checklist.js";
import {
  I, esc, uid, fmtDate, fmtDateTime, todayKey, iconSpan, emptyBox,
  toast, captureGPS, gpsText, $, $$
} from "../ui.js";

let draft = {};

export async function renderConductor(view, ctx) {
  const trucks = await store.listTrucks();
  const selId = ctx.selectedTruck();
  const sel = trucks.find(t => t.id === selId);

  if (!sel) return pickTruck(view, ctx, trucks);

  const screen = ctx.params.screen || "home";
  if (screen === "checklist") return checklist(view, ctx, sel);
  if (screen === "bitacora") return bitacora(view, ctx, sel);
  if (screen === "historial") return historial(view, ctx, sel);
  return home(view, ctx, sel);
}

function truckStatusLite(t) {
  return { cls: t.activo === false ? "neutral" : "ok", label: t.activo === false ? "Inactivo" : "Operativo" };
}

function pickTruck(view, ctx, trucks) {
  const opts = trucks.filter(t => t.activo !== false).map(t => {
    const st = truckStatusLite(t);
    return '<button class="tile" data-pick="' + t.id + '"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<span class="tx"><b>' + esc(t.marca + " " + (t.modelo || "")) + "</b><span>" + esc(t.patente) + "</span></span>" +
      '<span class="pill ' + st.cls + '"><span class="dot"></span>' + st.label + "</span></button>";
  }).join("");
  view.innerHTML =
    '<section class="section" style="margin-top:6px"><span class="eyebrow">Inicio de turno</span>' +
    '<h1 style="font-size:1.5rem;margin:6px 0 6px">Hola, ' + esc(ctx.profile.nombre.split(" ")[0]) + "</h1>" +
    '<p class="meta-line" style="margin-bottom:16px">Elige el camión con el que trabajarás hoy.</p>' +
    '<div class="tiles">' + (opts || emptyBox("No hay camiones registrados")) + "</div></section>";
  $$("[data-pick]", view).forEach(b => b.onclick = () => { ctx.setTruck(b.getAttribute("data-pick")); ctx.go("home", { screen: "home" }); });
}

async function home(view, ctx, t) {
  const cks = await store.listChecklists();
  const doneToday = cks.some(c => c.truckId === t.id && todayKey(c.ts) === todayKey());
  view.innerHTML =
    '<div class="card pad section" style="margin-bottom:16px"><div class="stat-truck">' +
      '<span class="trucknum">' + esc(t.num) + "</span>" +
      '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.15rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
      '<div style="margin-top:4px"><span class="plate">' + esc(t.patente) + "</span></div></div></div>" +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      (doneToday ? '<span class="pill ok"><span class="dot"></span>Checklist de hoy listo</span>'
                 : '<span class="pill warn"><span class="dot"></span>Falta checklist de hoy</span>') +
      "</div></div>" +
    '<div class="tiles section">' +
      tile("c-checklist", I.check, doneToday ? "Repetir checklist" : "Checklist de inicio de turno", doneToday ? "Ya registraste uno hoy" : "Revisa el camión antes de salir") +
      tile("c-bitacora", I.note, "Registrar novedad", "Falla, incidente, combustible o kilometraje") +
      tile("c-historial", I.history, "Historial del camión", "Últimos checklists y registros") +
    "</div>" +
    '<button class="backlink" id="c-changetruck">' + I.back + " Cambiar de camión</button>";
  $("#c-checklist", view).onclick = () => ctx.go("home", { screen: "checklist" });
  $("#c-bitacora", view).onclick = () => ctx.go("home", { screen: "bitacora" });
  $("#c-historial", view).onclick = () => ctx.go("home", { screen: "historial" });
  $("#c-changetruck", view).onclick = () => { ctx.setTruck(null); ctx.go("home", { screen: "home" }); };
}

function tile(id, ic, title, sub) {
  return '<button class="tile" id="' + id + '"><span class="ic">' + ic + '</span><span class="tx"><b>' +
    esc(title) + "</b><span>" + esc(sub) + "</span></span><span class='arrow'>" + I.arrow + "</span></button>";
}

// ---------------- CHECKLIST ----------------
function checklist(view, ctx, t) {
  if (!draft.ck) draft.ck = { items: {}, notes: {}, gps: null, gpsState: "idle", obs: "" };
  const d = draft.ck;
  const items = CK_ITEMS.map(it => {
    const v = d.items[it.k], bad = v === "falla";
    return '<div class="ck-item"><div class="ck-head"><div class="n">' + esc(it.n) + "<small>" + esc(it.d) + "</small></div>" +
      '<div class="seg" data-ck="' + it.k + '"><button data-v="ok" class="' + (v === "ok" ? "on-ok" : "") + '">OK</button>' +
      '<button data-v="falla" class="' + (bad ? "on-bad" : "") + '">Falla</button></div></div>' +
      (bad ? '<div class="ck-note"><input class="input" data-note="' + it.k + '" placeholder="¿Qué falla tiene?" value="' + esc(d.notes[it.k] || "") + '"></div>' : "") +
      "</div>";
  }).join("");
  const answered = Object.keys(d.items).length;
  view.innerHTML =
    '<button class="backlink" id="ck-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Checklist de turno</h2><span class="meta-line num">' + answered + "/" + CK_ITEMS.length + "</span></div>" +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + " · " + fmtDate(Date.now()) + "</p>" +
    '<div class="card pad section">' + gpsBox(d) + "</div>" +
    '<div class="card pad section">' + items + "</div>" +
    '<div class="card pad section"><label class="fld" style="margin:0"><span class="lb">Observación general (opcional)</span>' +
    '<textarea class="input" id="ck-obs" placeholder="Comentarios del turno...">' + esc(d.obs) + "</textarea></label></div>" +
    '<div class="formbar"><button class="btn btn-primary" id="ck-submit"' + (answered < CK_ITEMS.length ? " disabled" : "") + ">" +
    I.check + (answered < CK_ITEMS.length ? "Responde los " + CK_ITEMS.length + " puntos" : "Enviar checklist") + "</button></div>";

  $$(".seg[data-ck] button", view).forEach(b => b.onclick = () => {
    const k = b.parentElement.getAttribute("data-ck");
    d.items[k] = b.getAttribute("data-v");
    if (d.items[k] === "ok") delete d.notes[k];
    syncCk(view); checklist(view, ctx, t);
  });
  $$("[data-note]", view).forEach(inp => inp.oninput = () => { d.notes[inp.getAttribute("data-note")] = inp.value; });
  const obs = $("#ck-obs", view); if (obs) obs.oninput = () => { d.obs = obs.value; };
  $("#ck-back", view).onclick = () => { draft.ck = null; ctx.go("home", { screen: "home" }); };
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; checklist(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if ((ctx.params.screen) === "checklist") checklist(view, ctx, t); }); };
  const sb = $("#ck-submit", view);
  if (sb) sb.onclick = async () => {
    syncCk(view);
    if (Object.keys(d.items).length < CK_ITEMS.length) { toast("Responde todos los puntos", "err"); return; }
    const fails = CK_ITEMS.filter(it => d.items[it.k] === "falla").map(it => ({ k: it.k, n: it.n, note: d.notes[it.k] || "", sev: "media" }));
    const rec = {
      truckId: t.id, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
      ts: Date.now(), items: d.items, fails, gps: d.gps, obs: d.obs
    };
    sb.disabled = true; sb.textContent = "Guardando...";
    try {
      await store.addChecklist(rec);
      draft.ck = null;
      toast(fails.length ? "Checklist enviado. " + fails.length + " falla(s) al supervisor" : "Checklist enviado sin fallas", "ok");
      ctx.go("home", { screen: "home" });
    } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); sb.disabled = false; sb.textContent = "Enviar checklist"; }
  };

  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "checklist") checklist(view, ctx, t); }); }
}
function syncCk(view) {
  const d = draft.ck; if (!d) return;
  $$("[data-note]", view).forEach(inp => { d.notes[inp.getAttribute("data-note")] = inp.value; });
  const o = $("#ck-obs", view); if (o) d.obs = o.value;
}

function gpsBox(d) {
  const g = d.gps, gs = d.gpsState;
  const txt = g ? '<b class="num">' + gpsText(g) + '</b><div class="meta-line" style="font-size:.78rem">Ubicación capturada</div>'
    : gs === "loading" ? "Obteniendo ubicación GPS..."
    : gs === "denegado" ? "Permiso denegado. Puedes continuar sin GPS."
    : gs === "no-soportado" ? "Este dispositivo no entrega GPS."
    : gs === "error" ? "No se pudo obtener el GPS. Reintenta."
    : "Ubicación no capturada";
  return '<div class="gps-box ' + (g ? "ok" : "") + '"><span class="ic">' + I.pin + '</span><div style="flex:1">' + txt + "</div>" +
    (g ? "" : '<button class="btn sm btn-soft" id="gps-btn">Capturar</button>') + "</div>";
}

// ---------------- BITACORA ----------------
function bitacora(view, ctx, t) {
  if (!draft.bt) draft.bt = { tipo: "Falla mecánica", sev: "media", desc: "", gps: null, gpsState: "idle" };
  const d = draft.bt;
  const tipos = ["Falla mecánica", "Incidente", "Observación", "Combustible", "Kilometraje"];
  const tipoChips = tipos.map(x => '<button class="chip' + (d.tipo === x ? " on" : "") + '" data-tipo="' + esc(x) + '">' + esc(x) + "</button>").join("");
  const showSev = d.tipo === "Falla mecánica" || d.tipo === "Incidente";
  const sevChips = ["alta", "media", "baja"].map(s => '<button class="chip sev-' + s + (d.sev === s ? " on sev-" + s : "") + '" data-sev="' + s + '">' + ({ alta: "Alta", media: "Media", baja: "Baja" }[s]) + "</button>").join("");
  view.innerHTML =
    '<button class="backlink" id="bt-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Registrar novedad</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="card pad section"><label class="fld"><span class="lb">Tipo de registro</span><div class="chips">' + tipoChips + "</div></label>" +
    (showSev ? '<label class="fld"><span class="lb">Severidad</span><div class="chips">' + sevChips + "</div></label>" : "") +
    '<label class="fld" style="margin-bottom:0"><span class="lb">Descripción</span><textarea class="input" id="bt-desc" placeholder="Describe lo ocurrido...">' + esc(d.desc) + "</textarea></label></div>" +
    '<div class="card pad section">' + gpsBox(d) + "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="bt-submit">' + I.note + "Guardar en bitácora</button></div>";

  $$("[data-tipo]", view).forEach(b => b.onclick = () => { syncBt(view); d.tipo = b.getAttribute("data-tipo"); bitacora(view, ctx, t); });
  $$("[data-sev]", view).forEach(b => b.onclick = () => { d.sev = b.getAttribute("data-sev"); bitacora(view, ctx, t); });
  const desc = $("#bt-desc", view); if (desc) desc.oninput = () => { d.desc = desc.value; };
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; bitacora(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "bitacora") bitacora(view, ctx, t); }); };
  $("#bt-back", view).onclick = () => { draft.bt = null; ctx.go("home", { screen: "home" }); };
  $("#bt-submit", view).onclick = async () => {
    syncBt(view);
    if (!d.desc.trim()) { toast("Escribe una descripción", "err"); return; }
    const rec = {
      truckId: t.id, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
      ts: Date.now(), tipo: d.tipo, sev: showSev ? d.sev : null, desc: d.desc.trim(), gps: d.gps
    };
    const btn = $("#bt-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.addBitacora(rec); draft.bt = null; toast("Registro guardado en bitácora", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar en bitácora"; }
  };
}
function syncBt(view) { const d = draft.bt; if (!d) return; const el = $("#bt-desc", view); if (el) d.desc = el.value; }

// ---------------- HISTORIAL ----------------
async function historial(view, ctx, t) {
  const [cks, bits] = await Promise.all([store.listChecklists(), store.listBitacora()]);
  const mine = cks.filter(c => c.truckId === t.id).slice(0, 15);
  const mb = bits.filter(b => b.truckId === t.id).slice(0, 15);
  const ckRows = mine.length ? mine.map(c =>
    '<div class="row"><div class="rl"><div class="t">' + iconSpan("check") + "Checklist de turno" +
    (c.fails && c.fails.length ? ' <span class="pill crit">' + c.fails.length + " falla(s)</span>" : ' <span class="pill ok">Sin fallas</span>') +
    '</div><div class="m"><span>' + esc(c.driverNombre || "") + "</span><span>" + fmtDateTime(c.ts) + "</span>" + (c.gps ? "<span>" + iconSpan("pin") + "GPS</span>" : "") + "</div></div></div>"
  ).join("") : emptyBox("Sin checklists aún");
  const btRows = mb.length ? mb.map(b =>
    '<div class="row">' + (b.sev ? '<span class="sev-stripe sev-' + b.sev + '"></span>' : "") +
    '<div class="rl"><div class="t">' + esc(b.tipo) + '</div><div class="m"><span>' + esc(b.driverNombre || "") + "</span><span>" + fmtDateTime(b.ts) + "</span></div>" +
    '<div style="font-size:.88rem;margin-top:4px;color:var(--ink-2)">' + esc(b.desc) + "</div></div></div>"
  ).join("") : emptyBox("Sin registros de bitácora");
  view.innerHTML =
    '<button class="backlink" id="h-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Historial</h2><span class="meta-line">' + esc(t.num) + "</span></div>" +
    '<div class="section"><span class="eyebrow">Checklists</span><div class="card" style="margin-top:8px">' + ckRows + "</div></div>" +
    '<div class="section"><span class="eyebrow">Bitácora</span><div class="card" style="margin-top:8px">' + btRows + "</div></div>";
  $("#h-back", view).onclick = () => ctx.go("home", { screen: "home" });
}
