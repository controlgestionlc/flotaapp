import { store } from "./store.js";
import { CK_ITEMS } from "./checklist.js";
import { weekInfo, dayKey, toMin, truckAvailability, deriveFallas } from "./planning.js";
import { openTruckWeek } from "./truckweek.js";
import {
  I, esc, uid, fmtCLP, fmtDate, fmtDateTime, todayKey, dInput, iconSpan, emptyBox,
  toast, captureGPS, gpsText, openSheet, closeSheet, $, $$
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
  if (screen === "llegada") return viajeLlegada(view, ctx, sel);
  if (screen === "termino") return viajeTermino(view, ctx, sel);
  if (screen === "historial") return historial(view, ctx, sel);
  return home(view, ctx, sel);
}

// Estado de disponibilidad para la selección de camión del conductor.
// Usa el mismo criterio del semáforo del panel (órdenes, fallas, fuera de servicio).
function pickStatus(av) {
  if (av.k === "operativo") return { cls: "ok", label: "Operativo" };
  if (av.k === "observacion") return { cls: "warn", label: "Con observación" };
  return { cls: "bad", label: "No disponible" };
}

async function pickTruck(view, ctx, trucks) {
  // Datos para calcular disponibilidad real (igual que el panel).
  const [orders, fuel, cks, bits, resolved] = await Promise.all([
    store.listOrders().catch(() => []),
    store.listFuel().catch(() => []),
    store.listChecklists().catch(() => []),
    store.listBitacora().catch(() => []),
    store.listResolved().catch(() => [])
  ]);
  const fallas = deriveFallas(cks, bits, orders, resolved);
  const data = { orders, fuel, fallas };
  const now = Date.now();
  const myUid = ctx.profile.uid;

  const activos = trucks.filter(t => t.activo !== false);
  const tengoAsignado = activos.some(t => t.conductorUid === myUid);
  const opts = activos.map(t => {
    const av = truckAvailability(t, data, now);
    const st = pickStatus(av);
    const mine = t.conductorUid === myUid;
    const selectable = mine && av.k === "operativo";
    let msg = "";
    if (!mine) msg = "Este camión no está asignado a ti. Solo puedes usar el que te asignó tu supervisor.";
    else if (av.k !== "operativo") msg = "Tu camión no está disponible en este momento. Consulta con tu supervisor.";
    const attr = selectable ? 'data-pick="' + t.id + '"' : 'data-nope="' + t.id + '" data-msg="' + esc(msg) + '" aria-disabled="true"';
    const badge = mine ? '<span style="font-family:Barlow Semi Condensed;font-weight:600;font-size:.68rem;color:var(--accent);text-transform:uppercase;letter-spacing:.04em">Tu camión</span>' : "";
    return '<button class="tile' + (mine ? " tile-mine" : "") + (selectable ? "" : " tile-off") + '" ' + attr + '><span class="trucknum">' + esc(t.num) + "</span>" +
      '<span class="tx"><b>' + esc(t.marca + " " + (t.modelo || "")) + "</b><span>" + esc(t.patente) + "</span></span>" +
      '<span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end"><span class="pill ' + st.cls + '"><span class="dot"></span>' + st.label + "</span>" + badge + "</span></button>";
  }).join("");
  const intro = tengoAsignado
    ? "Selecciona tu camión para iniciar el turno. Puedes ver el estado de los demás, pero solo puedes usar el que te asignó tu supervisor."
    : "Aún no tienes un camión asignado. Contacta a tu supervisor para que te asigne uno antes de operar.";
  view.innerHTML =
    '<section class="section" style="margin-top:6px"><span class="eyebrow">Paso 1 · Inicio de turno</span>' +
    '<h1 style="font-size:1.5rem;margin:6px 0 6px">Hola, ' + esc(ctx.profile.nombre.split(" ")[0]) + "</h1>" +
    '<p class="meta-line" style="margin-bottom:16px">' + intro + "</p>" +
    '<div class="tiles">' + (opts || emptyBox("No hay camiones registrados")) + "</div></section>";
  $$("[data-pick]", view).forEach(b => b.onclick = () => confirmTruck(ctx, trucks.find(t => t.id === b.getAttribute("data-pick"))));
  $$("[data-nope]", view).forEach(b => b.onclick = () => toast(b.getAttribute("data-msg") || "Camión no disponible.", "err"));
}

// Ventana de confirmación antes de asignar el camión al turno.
function confirmTruck(ctx, t) {
  if (!t) return;
  openSheet("Confirmar camión del turno",
    '<div class="stat-truck" style="margin-bottom:14px"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div style="flex:1"><div style="font-weight:700;font-family:Barlow Semi Condensed;font-size:1.15rem">' + esc(t.marca + " " + (t.modelo || "")) + "</div>" +
      '<div style="margin-top:4px"><span class="plate">' + esc(t.patente) + "</span></div></div></div>" +
    '<p class="meta-line" style="margin:0 0 16px">¿Confirmas que trabajarás hoy con este camión? Quedará asignado a tu turno y luego deberás registrar el checklist.</p>' +
    '<button class="btn btn-primary" id="ct-ok" style="width:100%">' + I.check + "Sí, confirmar camión</button>" +
    '<button class="btn btn-soft" id="ct-cancel" style="width:100%;margin-top:8px">Elegir otro</button>',
    () => {
      $("#ct-ok").onclick = () => { ctx.setTruck(t.id); closeSheet(); ctx.go("home", { screen: "home", justPicked: 1 }); };
      $("#ct-cancel").onclick = () => closeSheet();
    });
}

async function home(view, ctx, t) {
  const [cks, trips, plans, faenas] = await Promise.all([store.listChecklists(), store.listTrips(), store.listPlans(), store.listFaenas()]);
  const doneToday = cks.some(c => c.truckId === t.id && todayKey(c.ts) === todayKey());
  const abiertos = trips.filter(v => v.truckId === t.id && v.estado !== "cerrado");
  // Planificación del día para este camión.
  const dkHoy = dayKey(Date.now()), wkHoy = weekInfo(Date.now());
  const planHoy = plans.find(p => p.id === wkHoy.key);
  const asigsHoy = (planHoy && planHoy.asignaciones || [])
    .filter(a => a.camionId === t.id && a.fecha === dkHoy && a.faenaId)
    .sort((a, b) => (a.turnoInicio || "").localeCompare(b.turnoInicio || ""));
  const faNombre = id => { const f = faenas.find(x => x.id === id); return f ? f.nombre : "Faena"; };
  const faUnidad = id => { const f = faenas.find(x => x.id === id); return f ? (f.unidad || "") : ""; };
  const planCard = asigsHoy.length
    ? '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:8px">Tu planificación de hoy</span>' +
      asigsHoy.map(a => '<div class="row" style="padding:8px 0"><span class="sev-stripe sev-baja" style="background:var(--accent)"></span><div class="rl">' +
        '<div class="t">' + esc(faNombre(a.faenaId)) + ' <span class="pill neutral">' + (a.viajesObjetivo || 0) + " v.</span></div>" +
        '<div class="m"><span>' + esc((a.turnoInicio || "--") + " ─ " + (a.turnoFin || "--")) + "</span>" +
        (a.volumenObjetivo ? "<span>" + a.volumenObjetivo + " " + esc(faUnidad(a.faenaId)) + "</span>" : "") + "</div></div></div>").join("") +
      '<button class="btn sm btn-soft" id="c-week" style="margin-top:10px">' + I.route + "Ver mi semana</button></div>"
    : '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:6px">Planificación de hoy</span><p class="meta-line" style="margin:0 0 10px">Este camión no tiene faena asignada hoy. Consulta con tu supervisor.</p><button class="btn sm btn-soft" id="c-week">' + I.route + "Ver mi semana</button></div>";
  const ckAlert = !doneToday
    ? '<div class="banner" id="c-ck-alert" style="cursor:pointer;border-left-color:var(--warn);background:var(--warn-soft)">' + I.alert +
      "<div><b>Registra el checklist de inicio de turno.</b> Es el siguiente paso antes de operar el camión.</div></div>"
    : "";
  const alerta = abiertos.length
    ? '<div class="banner" id="c-open-alert" style="cursor:pointer;border-left-color:var(--warn);background:var(--warn-soft)">' + I.alert +
      "<div><b>Tienes " + abiertos.length + " viaje(s) sin terminar.</b> Toca para registrar la llegada o el término.</div></div>"
    : "";
  view.innerHTML =
    '<div class="c-topbar"><button class="backlink" id="c-changetruck" style="margin:0">' + I.back + " Cambiar de camión</button></div>" +
    ckAlert +
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
    planCard +
    '<div class="tiles section">' +
      tile("c-checklist", I.check, doneToday ? "Repetir checklist" : "Checklist de inicio de turno", doneToday ? "Ya registraste uno hoy" : "Revisa el camión antes de salir") +
      tile("c-combustible", I.fuel, "Cargar combustible", "Litros, precio, kilómetros y estación") +
      tile("c-viaje", I.route, "Iniciar viaje (salida)", "Predio de origen, guía y GPS") +
      (abiertos.length ? tile("c-cerrar", I.check, "Viajes en curso (" + abiertos.length + ")", "Registrar llegada o término de entrega") : "") +
      tile("c-bitacora", I.note, "Registrar novedad", "Falla, incidente o kilometraje") +
      tile("c-historial", I.history, "Historial del camión", "Últimos checklists y registros") +
    "</div>";
  $("#c-checklist", view).onclick = () => ctx.go("home", { screen: "checklist" });
  $("#c-combustible", view).onclick = () => ctx.go("home", { screen: "combustible" });
  $("#c-viaje", view).onclick = () => ctx.go("home", { screen: "viaje" });
  const cc = $("#c-cerrar", view); if (cc) cc.onclick = () => ctx.go("home", { screen: "viajesAbiertos" });
  const oa = $("#c-open-alert", view); if (oa) oa.onclick = () => ctx.go("home", { screen: "viajesAbiertos" });
  const ca = $("#c-ck-alert", view); if (ca) ca.onclick = () => ctx.go("home", { screen: "checklist" });
  $("#c-bitacora", view).onclick = () => ctx.go("home", { screen: "bitacora" });
  $("#c-historial", view).onclick = () => ctx.go("home", { screen: "historial" });
  $("#c-changetruck", view).onclick = () => { ctx.setTruck(null); ctx.go("home", { screen: "home" }); };
  const cw = $("#c-week", view); if (cw) cw.onclick = () => openTruckWeek(ctx, t.id, Date.now());

  // Justo después de confirmar el camión, indicar que debe registrar el checklist.
  if (ctx.params.justPicked && !doneToday) {
    ctx.params.justPicked = 0;
    openSheet("Camión confirmado · " + t.num,
      '<p style="margin:0 0 6px;font-weight:600">Ahora registra el checklist de inicio de turno</p>' +
      '<p class="meta-line" style="margin:0 0 16px">Revisa el camión antes de salir. Es el paso obligatorio para dejar el turno en regla.</p>' +
      '<button class="btn btn-primary" id="cp-ck" style="width:100%">' + I.check + "Registrar checklist ahora</button>" +
      '<button class="btn btn-soft" id="cp-later" style="width:100%;margin-top:8px">Más tarde</button>',
      () => {
        $("#cp-ck").onclick = () => { closeSheet(); ctx.go("home", { screen: "checklist" }); };
        $("#cp-later").onclick = () => closeSheet();
      });
  }
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
function fmtWait(ms) { if (!ms || ms < 0) return "-"; const m = Math.round(ms / 60000); const h = Math.floor(m / 60); const mm = m % 60; return h ? (h + " h " + mm + " min") : (mm + " min"); }

async function viajeSalida(view, ctx, t) {
  const [plans, faenas] = await Promise.all([store.listPlans(), store.listFaenas()]);
  const dk = dayKey(Date.now());
  const wk = weekInfo(Date.now());
  const plan = plans.find(p => p.id === wk.key);
  const asigs = (plan && plan.asignaciones || [])
    .filter(a => a.camionId === t.id && a.fecha === dk && a.faenaId)
    .sort((a, b) => (a.turnoInicio || "").localeCompare(b.turnoInicio || ""));

  // Sin planificación para hoy → no se puede iniciar viaje.
  if (!asigs.length) {
    view.innerHTML =
      '<button class="backlink" id="vj-back">' + I.back + " Volver</button>" +
      '<div class="subhead"><h2>Salida del predio</h2><span class="pill neutral">Etapa 1 de 3</span></div>' +
      '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
      '<div class="card pad section" style="border-color:var(--crit)"><div style="display:flex;gap:10px;align-items:flex-start">' + I.alert +
        '<div><b>No tienes planificación para hoy</b><p class="meta-line" style="margin:6px 0 0">Este camión no tiene viajes programados para hoy, por lo que no puedes iniciar un viaje. Avisa a tu supervisor para que te asigne una faena.</p></div></div></div>';
    $("#vj-back", view).onclick = () => ctx.go("home", { screen: "home" });
    return;
  }

  if (!draft.viaje) draft.viaje = { asignacionId: "", predio: "", guia: "", gps: null, gpsState: "idle" };
  const d = draft.viaje;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const inSlot = a => { const i = toMin(a.turnoInicio), f = toMin(a.turnoFin); return i != null && f != null && i <= nowMin && nowMin < f; };
  const faOf = a => faenas.find(f => f.id === a.faenaId) || {};
  // Selección inicial: la faena cuyo horario incluye la hora actual, o la primera.
  if (!d.asignacionId || !asigs.some(a => a.id === d.asignacionId)) {
    const cur = asigs.find(inSlot) || asigs[0];
    d.asignacionId = cur.id;
    d.predio = faOf(cur).ubicacion || faOf(cur).nombre || "";
  }
  const sel = asigs.find(a => a.id === d.asignacionId) || asigs[0];

  const opts = asigs.map(a => {
    const fa = faOf(a); const on = a.id === d.asignacionId; const now = inSlot(a);
    return '<button class="tile' + (on ? " sel" : "") + '" data-asig="' + a.id + '"><span class="tx"><b>' + esc(fa.nombre || "Faena") +
      (now ? ' <span class="pill ok">Ahora</span>' : "") + "</b><span>" + esc((a.turnoInicio || "--") + " ─ " + (a.turnoFin || "--")) + " · " + (a.viajesObjetivo || 0) + " viajes" +
      (fa.destino ? " · → " + esc(fa.destino) : "") + "</span></span>" + (on ? I.check : "") + "</button>";
  }).join("");

  view.innerHTML =
    '<button class="backlink" id="vj-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Salida del predio</h2><span class="pill neutral">Etapa 1 de 3</span></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="section"><span class="eyebrow">Tu planificación de hoy</span>' +
      '<p class="meta-line" style="font-size:.82rem;margin:4px 2px 10px">Elige la faena que vas a realizar según el horario en que estás trabajando.</p>' +
      '<div class="tiles">' + opts + "</div></div>" +
    '<div class="card pad section">' + gpsBox(d) + '<p class="meta-line" style="font-size:.8rem;margin:10px 2px 0">La salida se registra con la fecha, hora y GPS actuales. Si no hay señal, se guarda igual y se sube al recuperarla.</p></div>' +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Predio de origen</span><input class="input" id="vj-predio" placeholder="Predio de carga" value="' + esc(d.predio) + '"></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Guía de despacho</span><input class="input" id="vj-guia" placeholder="N° de guía" value="' + esc(d.guia) + '"></label>' +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="vj-submit">' + I.route + "Registrar salida</button></div>";

  ["predio", "guia"].forEach(k => { const el = $("#vj-" + k, view); if (el) el.oninput = () => { d[k] = el.value; }; });
  $$("[data-asig]", view).forEach(b => b.onclick = () => {
    const el = $("#vj-predio", view); if (el) d.predio = el.value;
    const gl = $("#vj-guia", view); if (gl) d.guia = gl.value;
    const a = asigs.find(x => x.id === b.getAttribute("data-asig"));
    d.asignacionId = a.id; d.predio = faOf(a).ubicacion || faOf(a).nombre || "";
    viajeSalida(view, ctx, t);
  });
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { const el = $("#vj-predio", view); if (el) d.predio = el.value; const gl = $("#vj-guia", view); if (gl) d.guia = gl.value; d.gpsState = "loading"; viajeSalida(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "viaje") viajeSalida(view, ctx, t); }); };
  $("#vj-back", view).onclick = () => { draft.viaje = null; ctx.go("home", { screen: "home" }); };
  $("#vj-submit", view).onclick = async () => {
    const pel = $("#vj-predio", view); if (pel) d.predio = pel.value;
    const gel = $("#vj-guia", view); if (gel) d.guia = gel.value;
    if (!d.asignacionId) { toast("Elige la faena planificada", "err"); return; }
    if (!d.predio.trim()) { toast("Indica el predio de origen", "err"); return; }
    const fa = faOf(sel);
    const now = Date.now(), id = uid("trip");
    const rec = {
      id, truckId: t.id, patente: t.patente, uid: ctx.profile.uid, deviceId: store.deviceId(), driverNombre: ctx.profile.nombre,
      estado: "salida", origen: d.predio.trim(), predio: d.predio.trim(), guiaDespacho: (d.guia || "").trim(),
      planId: plan ? plan.id : null, asignacionId: sel.id, faenaId: sel.faenaId, faena: fa.nombre || "", faenaDestino: fa.destino || "",
      turnoPlan: (sel.turnoInicio || "") + " ─ " + (sel.turnoFin || ""),
      salida: now, salidaGps: d.gps || null, plantaDestino: "", llegada: null, llegadaGps: null, salidaPlanta: null, salidaPlantaGps: null,
      gmm: "", producto: null, volumen: 0, unidad: "", tiempoEspera: null, ts: now, importado: false
    };
    const btn = $("#vj-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try {
      const r = await store.saveTripResilient(id, rec); draft.viaje = null;
      toast(r.synced ? "Salida registrada" : "Salida guardada. Se subirá al tener señal", "ok");
      ctx.go("home", { screen: "home" });
    } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Registrar salida"; }
  };
  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "viaje") viajeSalida(view, ctx, t); }); }
}

// ---------------- VIAJE · viajes en curso ----------------
async function viajesAbiertos(view, ctx, t) {
  const trips = await store.listTrips();
  const abiertos = trips.filter(v => v.truckId === t.id && v.estado !== "cerrado").sort((a, b) => (b.salida || b.ts) - (a.salida || a.ts));
  const stageInfo = v => v.estado === "en_planta"
    ? { label: "En planta", next: "termino", btn: "Registrar término" }
    : { label: "En ruta", next: "llegada", btn: "Registrar llegada" };
  const rows = abiertos.length ? abiertos.map(v => { const si = stageInfo(v);
    return '<div class="row"><span class="sev-stripe sev-media"></span><div class="rl"><div class="t">' + esc(v.predio || v.origen || "") + ' <span class="pill warn">' + si.label + "</span></div>" +
      '<div class="m">' + (v.guiaDespacho ? "<span>Guía " + esc(v.guiaDespacho) + "</span>" : "") + (v.plantaDestino ? "<span>" + esc(v.plantaDestino) + "</span>" : "") + "<span>Salida " + fmtDateTime(v.salida || v.ts) + "</span></div>" +
      '<div style="margin-top:10px"><button class="btn sm btn-primary" data-stage="' + esc(v.id) + "|" + si.next + '">' + I.check + esc(si.btn) + "</button></div></div></div>";
  }).join("") : emptyBox("No tienes viajes en curso");
  view.innerHTML =
    '<button class="backlink" id="va-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Viajes en curso</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(t.num + " · " + t.patente) + "</p>" +
    '<div class="card">' + rows + "</div>";
  $("#va-back", view).onclick = () => ctx.go("home", { screen: "home" });
  $$("[data-stage]", view).forEach(b => b.onclick = () => { const parts = b.getAttribute("data-stage").split("|"); ctx.go("home", { screen: parts[1], tripId: parts[0] }); });
}

// ---------------- VIAJE · ETAPA 2 (llegada) ----------------
async function viajeLlegada(view, ctx, t) {
  const tripId = ctx.params.tripId;
  const trips = await store.listTrips();
  const trip = trips.find(v => v.id === tripId);
  if (!trip) { toast("Viaje no encontrado", "err"); return ctx.go("home", { screen: "viajesAbiertos" }); }
  if (!draft.lleg || draft.lleg.tripId !== tripId) draft.lleg = { tripId, planta: trip.plantaDestino || trip.faenaDestino || "", gps: null, gpsState: "idle" };
  const d = draft.lleg;
  const plants = Array.from(new Set(trips.map(v => v.plantaDestino).filter(Boolean)));
  view.innerHTML =
    '<button class="backlink" id="vl-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Llegada a destino</h2><span class="pill neutral">Etapa 2 de 3</span></div>' +
    '<div class="card pad section" style="margin-bottom:12px"><div class="meta-line" style="font-size:.85rem">Viaje desde <b style="color:var(--ink)">' + esc(trip.predio || trip.origen || "") + "</b>" + (trip.guiaDespacho ? " · Guía " + esc(trip.guiaDespacho) : "") + "<br>Salida: " + fmtDateTime(trip.salida || trip.ts) + "</div></div>" +
    '<div class="card pad section">' + gpsBox(d) + '<p class="meta-line" style="font-size:.8rem;margin:10px 2px 0">La llegada se registra con la fecha, hora y GPS actuales.</p></div>' +
    '<div class="card pad section"><label class="fld" style="margin-bottom:0"><span class="lb">Nombre de la planta</span><input class="input" id="vl-planta" list="vl-plants" placeholder="Planta o aserradero de destino" value="' + esc(d.planta) + '"><datalist id="vl-plants">' + plants.map(p => '<option value="' + esc(p) + '"></option>').join("") + "</datalist></label></div>" +
    '<div class="formbar"><button class="btn btn-primary" id="vl-submit">' + I.check + "Registrar llegada</button></div>";
  const pl = $("#vl-planta", view); if (pl) pl.oninput = () => { d.planta = pl.value; };
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; viajeLlegada(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "llegada") viajeLlegada(view, ctx, t); }); };
  $("#vl-back", view).onclick = () => { draft.lleg = null; ctx.go("home", { screen: "viajesAbiertos" }); };
  $("#vl-submit", view).onclick = async () => {
    if (pl) d.planta = pl.value;
    if (!d.planta.trim()) { toast("Indica la planta de destino", "err"); return; }
    const patch = Object.assign({}, trip, { plantaDestino: d.planta.trim(), llegada: Date.now(), llegadaGps: d.gps || null, estado: "en_planta" });
    const btn = $("#vl-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { const r = await store.saveTripResilient(tripId, patch); draft.lleg = null; toast(r.synced ? "Llegada registrada" : "Llegada guardada. Se subirá al tener señal", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Registrar llegada"; }
  };
  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "llegada") viajeLlegada(view, ctx, t); }); }
}

// ---------------- VIAJE · ETAPA 3 (término de entrega) ----------------
async function viajeTermino(view, ctx, t) {
  const tripId = ctx.params.tripId;
  const trips = await store.listTrips();
  const trip = trips.find(v => v.id === tripId);
  if (!trip) { toast("Viaje no encontrado", "err"); return ctx.go("home", { screen: "viajesAbiertos" }); }
  if (!draft.term || draft.term.tripId !== tripId) draft.term = { tripId, gmm: trip.gmm || "", gps: null, gpsState: "idle" };
  const d = draft.term;
  const esperaAhora = trip.llegada ? fmtWait(Date.now() - trip.llegada) : "-";
  view.innerHTML =
    '<button class="backlink" id="vt-back">' + I.back + " Volver</button>" +
    '<div class="subhead"><h2>Término de entrega</h2><span class="pill neutral">Etapa 3 de 3</span></div>' +
    '<div class="card pad section" style="margin-bottom:12px"><div class="meta-line" style="font-size:.85rem">' + esc(trip.predio || trip.origen || "") + ' &rarr; <b style="color:var(--ink)">' + esc(trip.plantaDestino || "") + "</b><br>Llegada: " + (trip.llegada ? fmtDateTime(trip.llegada) : "-") + ' &middot; Espera hasta ahora: <b style="color:var(--ink)">' + esperaAhora + "</b></div></div>" +
    '<div class="card pad section">' + gpsBox(d) + '<p class="meta-line" style="font-size:.8rem;margin:10px 2px 0">La salida de la planta se registra con la hora actual. El tiempo de espera se calcula desde la llegada.</p></div>' +
    '<div class="card pad section"><label class="fld" style="margin-bottom:0"><span class="lb">GMM de recepción</span><input class="input" id="vt-gmm" placeholder="N° GMM de la recepción" value="' + esc(d.gmm) + '"></label></div>' +
    '<div class="formbar"><button class="btn btn-primary" id="vt-submit">' + I.check + "Terminar entrega</button></div>";
  const gm = $("#vt-gmm", view); if (gm) gm.oninput = () => { d.gmm = gm.value; };
  const gb = $("#gps-btn", view); if (gb) gb.onclick = () => { d.gpsState = "loading"; viajeTermino(view, ctx, t); captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "termino") viajeTermino(view, ctx, t); }); };
  $("#vt-back", view).onclick = () => { draft.term = null; ctx.go("home", { screen: "viajesAbiertos" }); };
  $("#vt-submit", view).onclick = async () => {
    if (gm) d.gmm = gm.value;
    if (!d.gmm.trim()) { toast("Ingresa el GMM de recepción", "err"); return; }
    const now = Date.now(), tiempoEspera = trip.llegada ? (now - trip.llegada) : null;
    const patch = Object.assign({}, trip, { salidaPlanta: now, salidaPlantaGps: d.gps || null, gmm: d.gmm.trim(), estado: "cerrado", tiempoEspera });
    const btn = $("#vt-submit", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { const r = await store.saveTripResilient(tripId, patch); draft.term = null; toast(r.synced ? "Entrega terminada. Viaje cerrado" : "Guardado. Se subirá al tener señal", "ok"); ctx.go("home", { screen: "home" }); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Terminar entrega"; }
  };
  if (d.gpsState === "idle") { d.gpsState = "loading"; captureGPS((g, err) => { d.gps = g; d.gpsState = g ? "ok" : (err || "error"); if (ctx.params.screen === "termino") viajeTermino(view, ctx, t); }); }
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
