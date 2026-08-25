import { store } from "./store.js";
import { CK_ITEMS } from "./checklist.js";
import {
  I, esc, uid, fmtCLP, fmtDate, fmtDateTime, todayKey, dInput, iconSpan, emptyBox,
  toast, captureGPS, gpsText, $, $$
} from "./ui.js";

let draft = {};

export async function renderConductor(view, ctx) {
  const trucks = await store.listTrucks();
  const selId = ctx.selectedTruck();
  const sel = trucks.find(t => t.id === selId);

  if (!sel) return pickTruck(view, ctx, trucks);

  const screen = ctx.params.screen || "home";
  if (screen === "checklist") return checklist(view, ctx, sel);
  if (screen === "bitacora") return bitacora(view, ctx, sel);
  if (screen === "combustible") return combustible(view, ctx, sel);
  if (screen === "viaje") return viajeSalida(view, ctx, sel);
  if (screen === "viajesAbiertos") return viajesAbiertos(view, ctx, sel);
  if (screen === "cerrarViaje") return viajeLlegada(view, ctx, sel);
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
  const [cks, trips] = await Promise.all([store.listChecklists(), store.listTrips()]);
  const doneToday = cks.some(c => c.truckId === t.id && todayKey(c.ts) === todayKey());
  const abiertos = trips.filter(v => v.truckId === t.id && v.estado !== "cerrado");
  const alerta = abiertos.length
    ? '<div class="banner" id="c-open-alert" style="cursor:pointer;border-left-color:var(--warn);background:var(--warn-soft)">' + I.alert +
      "<div><b>Tienes " + abiertos.length + " viaje(s) sin cerrar.</b> Toca para registrar la llegada a destino.</div></div>"
    : "";
  view.innerHTML =
    alerta +
    '<div class="card pad section" style="margin-bottom:16px"><div class="stat-truck">' +
      '<span class="trucknum">' + esc(t.num) + "</span>" +
      '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.15rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
      '<div style="margin-top:4px"><span class="plate">' + esc(t.patente) + "</span></div></div></div>" +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      (doneToday ? '<span class="pill ok"><span class="dot"></span>Checklist de hoy listo</span>'
                 : '<span class="pill warn"><span class="dot"></span>Falta checklist de hoy</span>') +
      (abiertos.length ? '<span class="pill warn"><span class="dot"></span>' + abiertos.length + " viaje(s) abierto(s)</span>" : "") +
      "</div></div>" +
    '<div class="tiles section">' +
      tile("c-checklist", I.check, doneToday ? "Repetir checklist" : "Checklist de inicio de turno", doneToday ? "Ya registraste uno hoy" : "Revisa el camión antes de salir") +
      tile("c-combustible", I.fuel, "Cargar combustible", "Litros, precio, kilómetros y estación") +
      tile("c-viaje", I.route, "Iniciar viaje (salida)", "Origen, producto y GPS de salida") +
      (abiertos.length ? tile("c-cerrar", I.check, "Cerrar viaje (llegada)", abiertos.length + " viaje(s) pendiente(s) de cierre") : "") +
      tile("c-bitacora", I.note, "Registrar novedad", "Falla, incidente o kilometraje") +
      tile("c-historial", I.history, "Historial del camión", "Últimos checklists y registros") +
    "</div>" +
    '<button class="backlink" id="c-changetruck">' + I.back + " Cambiar de camión</button>";
  $("#c-checklist", view).onclick = () => ctx.go("home", { screen: "checklist" });
  $("#c-combustible", view).onclick = () => ctx.go("home", { screen: "combustible" });
  $("#c-viaje", view).onclick = () => ctx.go("home", { screen: "viaje" });
  const cc = $("#c-cerrar", view); if (cc) cc.onclick = () => ctx.go("home", { screen: "viajesAbiertos" });
  const oa = $("#c-open-alert", view); if (oa) oa.onclick = () => ctx.go("home", { screen: "viajesAbiertos" });
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

// ---------------- COMBUSTIBLE ----------------
function combustible(view, ctx, t) {
  if (!draft.fuel) draft.fuel = { fecha: dInput(Date.now()), km: "", litros: "", precio: "", estacion: "" };
  const d = draft.fuel;
  const total = (Number(d.litros) || 0) * (Number(d.precio) || 0);
  view.innerHTML =
    '<button class="backlink" id="fu-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Carga de combustible</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Fecha</span><input class="input" type="date" id="fu-fecha" value="' + esc(d.fecha) + '"></label>' +
      '<div class="grid2"><label class="fld"><span class="lb">Kilómetros (odómetro)</span><input class="input num" id="fu-km" inputmode="numeric" placeholder="Ej: 121500" value="' + esc(d.km) + '"></label>' +
      '<label class="fld"><span class="lb">Litros</span><input class="input num" id="fu-litros" inputmode="decimal" placeholder="Ej: 320" value="' + esc(d.litros) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Precio por litro</span><input class="input num" id="fu-precio" inputmode="numeric" placeholder="$" value="' + esc(d.precio) + '"></label>' +
      '<label class="fld"><span class="lb">Total</span><input class="input num" id="fu-total" value="' + fmtCLP(total) + '" disabled></label></div>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Estación de servicio</span><input class="input" id="fu-estacion" placeholder="Ej: Copec Angol" value="' + esc(d.estacion) + '"></label>' +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="fu-submit">' + I.fuel + "Guardar carga</button></div>";
  const sync = () => { ["fecha", "km", "litros", "precio", "estacion"].forEach(k => { const el = $("#fu-" + k, view); if (el) d[k] = el.value; }); };
  ["km", "litros", "precio"].forEach(k => { const el = $("#fu-" + k, view); if (el) el.oninput = () => { d[k] = el.value; const tl = $("#fu-total", view); if (tl) tl.value = fmtCLP((Number(d.litros) || 0) * (Number(d.precio) || 0)); }; });
  ["fecha", "estacion"].forEach(k => { const el = $("#fu-" + k, view); if (el) el.oninput = () => { d[k] = el.value; }; });
  $("#fu-back", view).onclick = () => { draft.fuel = null; ctx.go("home", { screen: "home" }); };
  $("#fu-submit", view).onclick = async () => {
    sync();
    if (!d.km || !d.litros) { toast("Ingresa kilómetros y litros", "err"); return; }
    const rec = {
      truckId: t.id, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
      fecha: d.fecha ? new Date(d.fecha + "T12:00:00").getTime() : Date.now(),
      km: Math.round(Number(d.km) || 0), litros: Number(d.litros) || 0, precioLitro: Math.round(Number(d.precio) || 0),
      estacion: (d.estacion || "").trim(), total: Math.round((Number(d.litros) || 0) * (Number(d.precio) || 0)), ts: Date.now()
    };
    const btn = $("#fu-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.addFuel(rec); draft.fuel = null; toast("Carga de combustible guardada", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar carga"; }
  };
}

// ---------------- VIAJE · utilidades ----------------
function dtLocal(ts) { const d = new Date(ts); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); }
function nfv(n) { return (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 }); }
function prodListHTML(d) {
  if (!d.products.length) return '<div class="empty" style="padding:16px">Aún no hay productos cargados. El administrador o supervisor deben agregarlos.</div>';
  const q = (d.prodQuery || "").toLowerCase().trim();
  const matches = (q ? d.products.filter(p => (p.codigo + " " + p.descripcion + " " + p.especie).toLowerCase().includes(q)) : d.products).slice(0, 8);
  if (!matches.length) return '<div class="empty" style="padding:16px">Sin coincidencias</div>';
  return matches.map(p => '<div class="row" data-prod="' + esc(p.id) + '" style="cursor:pointer"><div class="rl"><div class="t">' + esc(p.codigo) + (p.um ? ' <span class="pill neutral">' + esc(p.um) + "</span>" : "") + '</div><div class="m"><span>' + esc(p.descripcion) + "</span><span>" + esc(p.especie) + "</span></div></div></div>").join("");
}

// ---------------- VIAJE · ETAPA 1 (salida) ----------------
async function viajeSalida(view, ctx, t) {
  if (!draft.viaje) draft.viaje = { origen: "", predio: "", volumen: "", unidad: "M3", guia: "", producto: null, prodQuery: "", gps: null, gpsState: "idle", products: null };
  const d = draft.viaje;
  if (d.products === null) { d.products = []; try { d.products = await store.listProducts(); } catch (e) {} }
  const unidadChips = ["M3", "MR"].map(u => '<button class="chip' + (d.unidad === u ? " on" : "") + '" data-unidad="' + u + '">' + u + "</button>").join("");
  const prodBox = d.producto
    ? '<div class="row" style="border:1px solid var(--line);border-radius:11px;background:var(--surface-2)"><div class="rl"><div class="t">' + esc(d.producto.codigo) + (d.producto.um ? ' <span class="pill neutral">' + esc(d.producto.um) + "</span>" : "") + '</div><div class="m"><span>' + esc(d.producto.descripcion) + "</span><span>" + esc(d.producto.especie) + '</span></div></div><button class="btn sm btn-soft" id="vj-prod-clear">Cambiar</button></div>'
    : '<input class="input" id="vj-prod" placeholder="Buscar por código, descripción o especie" value="' + esc(d.prodQuery || "") + '" autocomplete="off"><div class="card" id="vj-prod-list" style="margin-top:6px;max-height:240px;overflow:auto">' + prodListHTML(d) + "</div>";

  view.innerHTML =
    '<button class="backlink" id="vj-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Salida del predio</h2><span class="pill neutral">Etapa 1 de 2</span></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="card pad section">' + gpsBox(d) + '<p class="meta-line" style="font-size:.8rem;margin:10px 2px 0">La salida se registra con la fecha y hora actuales.</p></div>' +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Origen</span><input class="input" id="vj-origen" placeholder="Lugar o camino de origen" value="' + esc(d.origen) + '"></label>' +
      '<label class="fld"><span class="lb">Nombre del predio</span><input class="input" id="vj-predio" placeholder="Predio de carga" value="' + esc(d.predio) + '"></label>' +
      '<label class="fld"><span class="lb">Producto trasladado</span>' + prodBox + "</label>" +
      '<div class="grid2"><label class="fld" style="margin-bottom:0"><span class="lb">Volumen</span><input class="input num" id="vj-volumen" inputmode="decimal" placeholder="Ej: 32" value="' + esc(d.volumen) + '"></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Unidad</span><div class="chips">' + unidadChips + "</div></label></div>" +
      '<label class="fld" style="margin:14px 0 0"><span class="lb">Guía de despacho</span><input class="input" id="vj-guia" placeholder="N° de guía" value="' + esc(d.guia) + '"></label>' +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="vj-submit">' + I.route + "Registrar salida</button></div>";

  const sync = () => { ["origen", "predio", "volumen", "guia"].forEach(k => { const el = $("#vj-" + k, view); if (el) d[k] = el.value; }); const pq = $("#vj-prod", view); if (pq) d.prodQuery = pq.value; };
  ["origen", "predio", "volumen", "guia"].forEach(k => { const el = $("#vj-" + k, view); if (el) el.oninput = () => { d[k] = el.value; }; });
  const pick = p => { sync(); if (p) { d.producto = { codigo: p.codigo, descripcion: p.descripcion, especie: p.especie, um: p.um || "" }; if (p.um === "M3" || p.um === "MR") d.unidad = p.um; } else d.producto = null; d.prodQuery = ""; viajeSalida(view, ctx, t); };
  const pq = $("#vj-prod", view);
  if (pq) pq.oninput = () => { d.prodQuery = pq.value; const lc = $("#vj-prod-list", view); if (lc) { lc.innerHTML = prodListHTML(d); $$("[data-prod]", lc).forEach(b => b.onclick = () => pick(d.products.find(x => x.id === b.getAttribute("data-prod")))); } };
  $$("[data-prod]", view).forEach(b => b.onclick = () => pick(d.products.find(x => x.id === b.getAttribute("data-prod"))));
  const pc = $("#vj-prod-clear", view); if (pc) pc.onclick = () => { sync(); d.producto = null; viajeSalida(view, ctx, t); };
  $$("[data-unidad]", view).forEach(b => b.onclick = () => { sync(); d.unidad = b.getAttribute("data-unidad"); viajeSalida(view, ctx, t); });
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; viajeSalida(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "viaje") viajeSalida(view, ctx, t); }); };
  $("#vj-back", view).onclick = () => { draft.viaje = null; ctx.go("home", { screen: "home" }); };
  $("#vj-submit", view).onclick = async () => {
    sync();
    if (!d.predio.trim() && !d.origen.trim()) { toast("Indica el origen o el predio", "err"); return; }
    if (!d.producto) { toast("Selecciona el producto trasladado", "err"); return; }
    const now = Date.now();
    const rec = {
      truckId: t.id, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
      estado: "abierto", origen: d.origen.trim(), predio: d.predio.trim(), producto: d.producto,
      volumen: Number(d.volumen) || 0, unidad: d.unidad, guiaDespacho: (d.guia || "").trim(),
      salida: now, salidaGps: d.gps || null, plantaDestino: "", llegada: null, llegadaGps: null, gmm: "", ts: now
    };
    const btn = $("#vj-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.addTrip(rec); draft.viaje = null; toast("Salida registrada. Cierra el viaje al llegar.", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Registrar salida"; }
  };
  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "viaje") viajeSalida(view, ctx, t); }); }
}

// ---------------- VIAJE · viajes abiertos ----------------
async function viajesAbiertos(view, ctx, t) {
  const trips = await store.listTrips();
  const abiertos = trips.filter(v => v.truckId === t.id && v.estado !== "cerrado").sort((a, b) => (b.salida || b.ts) - (a.salida || a.ts));
  const rows = abiertos.length ? abiertos.map(v =>
    '<div class="row"><span class="sev-stripe sev-media"></span><div class="rl"><div class="t">' + esc((v.predio || v.origen || "") + (v.producto ? " · " + v.producto.descripcion : "")) + "</div>" +
    '<div class="m">' + (v.volumen ? '<span class="num">' + nfv(v.volumen) + " " + esc(v.unidad || "") + "</span>" : "") + (v.guiaDespacho ? "<span>" + esc(v.guiaDespacho) + "</span>" : "") + "<span>Salida " + fmtDateTime(v.salida || v.ts) + "</span></div>" +
    '<div style="margin-top:10px"><button class="btn sm btn-primary" data-close="' + esc(v.id) + '">' + I.check + "Cerrar viaje</button></div></div></div>"
  ).join("") : emptyBox("No tienes viajes abiertos");
  view.innerHTML =
    '<button class="backlink" id="va-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Viajes sin cerrar</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="card">' + rows + "</div>";
  $("#va-back", view).onclick = () => ctx.go("home", { screen: "home" });
  $$("[data-close]", view).forEach(b => b.onclick = () => ctx.go("home", { screen: "cerrarViaje", tripId: b.getAttribute("data-close") }));
}

// ---------------- VIAJE · ETAPA 2 (llegada / cierre) ----------------
async function viajeLlegada(view, ctx, t) {
  const tripId = ctx.params.tripId;
  const trips = await store.listTrips();
  const trip = trips.find(v => v.id === tripId);
  if (!trip) { toast("Viaje no encontrado", "err"); return ctx.go("home", { screen: "viajesAbiertos" }); }
  if (!draft.lleg || draft.lleg.tripId !== tripId) {
    draft.lleg = { tripId, planta: trip.plantaDestino || "", llegada: dtLocal(Date.now()), gmm: trip.gmm || "", gps: null, gpsState: "idle" };
  }
  const d = draft.lleg;
  const plants = Array.from(new Set(trips.map(v => v.plantaDestino).filter(Boolean)));
  view.innerHTML =
    '<button class="backlink" id="vl-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Llegada a destino</h2><span class="pill neutral">Etapa 2 de 2</span></div>' +
    '<div class="card pad section" style="margin-bottom:12px"><div class="meta-line" style="font-size:.85rem">Viaje desde <b style="color:var(--ink)">' + esc(trip.predio || trip.origen || "") + "</b>" + (trip.producto ? " · " + esc(trip.producto.descripcion) : "") + "<br>Salida: " + fmtDateTime(trip.salida || trip.ts) + "</div></div>" +
    '<div class="card pad section">' + gpsBox(d) + '<p class="meta-line" style="font-size:.8rem;margin:10px 2px 0">GPS, fecha y hora se toman por defecto; puedes editarlos si registras después.</p></div>' +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Planta destino</span><input class="input" id="vl-planta" list="vl-plants" placeholder="Planta o aserradero" value="' + esc(d.planta) + '"><datalist id="vl-plants">' + plants.map(p => '<option value="' + esc(p) + '"></option>').join("") + "</datalist></label>" +
      '<label class="fld"><span class="lb">Llegada (fecha y hora)</span><input class="input" type="datetime-local" id="vl-llegada" value="' + esc(d.llegada) + '"></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">GMM de recepción</span><input class="input" id="vl-gmm" placeholder="N° GMM" value="' + esc(d.gmm) + '"></label>' +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="vl-submit">' + I.check + "Cerrar viaje</button></div>";
  const sync = () => { const g = (id, k) => { const el = $(id, view); if (el) d[k] = el.value; }; g("#vl-planta", "planta"); g("#vl-llegada", "llegada"); g("#vl-gmm", "gmm"); };
  ["#vl-planta", "#vl-llegada", "#vl-gmm"].forEach(id => { const el = $(id, view); if (el) el.oninput = sync; });
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; viajeLlegada(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "cerrarViaje") viajeLlegada(view, ctx, t); }); };
  $("#vl-back", view).onclick = () => { draft.lleg = null; ctx.go("home", { screen: "viajesAbiertos" }); };
  $("#vl-submit", view).onclick = async () => {
    sync();
    if (!d.planta.trim()) { toast("Indica la planta de destino", "err"); return; }
    const patch = Object.assign({}, trip, {
      plantaDestino: d.planta.trim(), llegada: d.llegada ? new Date(d.llegada).getTime() : Date.now(),
      llegadaGps: d.gps || trip.llegadaGps || null, gmm: (d.gmm || "").trim(), estado: "cerrado"
    });
    const btn = $("#vl-submit", view); btn.disabled = true; btn.textContent = "Cerrando...";
    try { await store.saveTrip(tripId, patch); draft.lleg = null; toast("Viaje cerrado", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo cerrar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Cerrar viaje"; }
  };
  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "cerrarViaje") viajeLlegada(view, ctx, t); }); }
}

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
