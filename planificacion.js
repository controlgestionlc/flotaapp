import { store } from "./store.js";
import { can } from "./permissions.js";
import {
  I, esc, uid, fmtDate, fmtDateTime, fmtCLP, iconSpan, emptyBox,
  toast, openSheet, closeSheet, captureGPS, $, $$
} from "./ui.js";
import {
  DIAS, DIAS_LARGO, weekInfo, dayKey, truckAvailability, driverAvailability,
  truckTimeClash, toMin, faenaAccess, PLAN_ESTADOS, IMPREVISTO_TIPOS,
  evaluarAccesoClima, CLIMA_PARAMS_DEFAULT, wmoDesc,
  autoAssign, CRITERIOS, AUTO_PARAMS_DEFAULT, tripsPerTruck
} from "./planning.js";
import { fetchClimaFaenas, hasCoords, geocode } from "./clima.js";

// Timestamp dentro de la semana visualizada (se ajusta con la navegación).
let weekTs = null;
// Estado de la última asignación automática generada (opciones + propuesta).
let autoState = null;
function minToHHMM(m) { const h = Math.floor(m / 60) % 24, mm = m % 60; return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); }
// Paleta estable para identificar faenas en la matriz.
const FA_COLORS = ["#2F6F5E", "#B4632A", "#3B5B92", "#7A5B99", "#8A7A2E", "#9A3B4E"];

export async function renderPlanificacion(view, ctx) {
  if (weekTs == null) weekTs = Date.now();
  const r = ctx.route;
  if (r === "faenas") return faenasScreen(view, ctx);
  if (r === "operacion") return operacionDia(view, ctx);
  if (r === "control") return controlScreen(view, ctx);
  if (r === "clima") return climaScreen(view, ctx);
  if (r === "auto") return autoScreen(view, ctx);
  return semanal(view, ctx);
}

// Carga el plan de la semana; si no existe devuelve un borrador en memoria.
async function loadWeek() {
  const wk = weekInfo(weekTs);
  const plans = await store.listPlans();
  let plan = plans.find(p => p.id === wk.key);
  if (!plan) plan = {
    id: wk.key, semana: wk.num, anio: wk.year, inicio: wk.inicio, fin: wk.fin,
    estado: "borrador", objetivoViajes: 0, asignaciones: [], original: null, cambios: [], _nuevo: true
  };
  if (!plan.asignaciones) plan.asignaciones = [];
  return { wk, plan };
}

async function loadRefs() {
  const [trucks, faenas, users, orders, fuel, trips] = await Promise.all([
    store.listTrucks(), store.listFaenas(), store.listUsers(), store.listOrders(), store.listFuel(), store.listTrips()
  ]);
  const conductores = users.filter(u => u.role === "conductor" && u.activo !== false);
  return { trucks, faenas, conductores, orders, fuel, trips };
}

function faColor(faenas, faenaId) {
  const i = faenas.findIndex(f => f.id === faenaId);
  return i >= 0 ? FA_COLORS[i % FA_COLORS.length] : "#6B7280";
}
function faName(faenas, faenaId) { const f = faenas.find(x => x.id === faenaId); return f ? f.nombre : "—"; }

// =============================================================
//  PANTALLA 1 · Planificación semanal (matriz)
// =============================================================
async function semanal(view, ctx) {
  const canEdit = can(ctx.profile, "plan.manage");
  const { wk, plan } = await loadWeek();
  const refs = await loadRefs();
  const { trucks, faenas, conductores, orders, fuel } = refs;
  const activos = trucks.filter(t => t.activo !== false);

  const asigWeek = plan.asignaciones;
  const viajesPlan = asigWeek.reduce((s, a) => s + (Number(a.viajesObjetivo) || 0), 0);
  const volPlan = asigWeek.reduce((s, a) => s + (Number(a.volumenObjetivo) || 0), 0);
  const camionesPlan = new Set(asigWeek.map(a => a.camionId)).size;
  const faenasActivas = new Set(asigWeek.map(a => a.faenaId).filter(Boolean)).size;
  const disp = activos.filter(t => truckAvailability(t, refs, weekTs).ok).length;

  // Alertas: faenas no operativas con asignaciones + camiones no disponibles asignados.
  const alerts = [];
  faenas.forEach(f => {
    const ac = faenaAccess(f);
    if (ac.k !== "operativa" && asigWeek.some(a => a.faenaId === f.id)) {
      const afectados = new Set(asigWeek.filter(a => a.faenaId === f.id).map(a => a.camionId)).size;
      alerts.push({ cls: ac.cls, text: f.nombre + " · acceso " + ac.label.toLowerCase(), sub: (f.restricciones || "Revisar accesibilidad") + " · " + afectados + " camión(es)" });
    }
  });
  activos.forEach(t => {
    const av = truckAvailability(t, refs, weekTs);
    if (!av.ok && asigWeek.some(a => a.camionId === t.id)) {
      const bad = av.items.find(i => i.st === "bad");
      alerts.push({ cls: "crit", text: t.num + " no disponible", sub: (bad ? bad.label : "Recurso no disponible") + " · tiene asignaciones esta semana" });
    }
  });

  const est = PLAN_ESTADOS[plan.estado] || PLAN_ESTADOS.borrador;

  const kpi = (cls, val, lab, sub) => '<div class="kpi ' + cls + '"><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";
  const kpis = '<div class="kpis section">' +
    kpi("a", disp + "/" + activos.length, "Camiones disponibles", "operativos hoy") +
    kpi("w", String(faenasActivas), "Faenas activas", "en el programa") +
    kpi("a", String(viajesPlan), "Viajes planificados", "meta " + (plan.objetivoViajes || viajesPlan)) +
    kpi(alerts.length ? "c" : "g", String(alerts.length), "Alertas", alerts.length ? "requieren revisión" : "sin alertas") +
    "</div>";

  // Matriz
  const head = '<th class="pl-th-fix">Camión</th>' + wk.dias.map((ts, i) =>
    '<th' + (dayKey(ts) === dayKey(Date.now()) ? ' class="pl-today"' : "") + ">" + DIAS[i] + "<span>" + new Date(ts).getDate() + "</span></th>").join("");
  const rows = activos.map(t => {
    const av = truckAvailability(t, refs, weekTs);
    const cells = wk.dias.map(ts => {
      const dk = dayKey(ts);
      const as = asigWeek.filter(x => x.camionId === t.id && x.fecha === dk && x.faenaId);
      if (as.length) {
        const inner = as.map(a => {
          const col = faColor(faenas, a.faenaId);
          return '<span class="pl-fa" style="border-left:3px solid ' + col + '"><b style="color:' + col + '">' + esc(faName(faenas, a.faenaId)) + "</b>" +
            '<span class="num">' + (Number(a.viajesObjetivo) || 0) + " v." + (a.turnoInicio ? " · " + esc(a.turnoInicio) : "") + "</span></span>";
        }).join("");
        return '<td><button class="pl-cell multi" data-cell="' + t.id + "|" + dk + '">' + inner + "</button></td>";
      }
      return '<td><button class="pl-cell empty" data-cell="' + t.id + "|" + dk + '">' + (canEdit ? "Reserva" : "—") + "</button></td>";
    }).join("");
    return '<tr><td class="pl-th-fix"><div class="pl-truck"><span class="trucknum sm">' + esc(t.num) + "</span>" +
      '<span><b>' + esc(t.patente) + "</b><small class='" + (av.ok ? "ok" : "bad") + "'>" + (av.ok ? "Disponible" : "No disponible") + "</small></span></div></td>" + cells + "</tr>";
  }).join("");

  const matriz = '<div class="pl-matrix-wrap section"><table class="pl-matrix"><thead><tr>' + head + "</tr></thead><tbody>" +
    (activos.length ? rows : '<tr><td colspan="8">' + emptyBox("No hay camiones registrados") + "</td></tr>") + "</tbody></table></div>";

  const alertsBlock = alerts.length ? '<div class="section"><span class="eyebrow">Alertas operacionales (' + alerts.length + ')</span><div class="card" style="margin-top:8px">' +
    alerts.map(a => '<div class="row"><span class="sev-stripe ' + (a.cls === "crit" ? "sev-alta" : "sev-media") + '"></span><div class="rl"><div class="t">' + esc(a.text) + '</div><div class="m"><span>' + esc(a.sub) + "</span></div></div></div>").join("") + "</div></div>" : "";

  const objetivo = '<div class="card pad section" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
    '<div><div class="meta-line">Objetivo semanal</div><div class="num" style="font-size:1.5rem;font-weight:700">' + (plan.objetivoViajes || viajesPlan) + ' viajes</div></div>' +
    '<div><div class="meta-line">Planificado</div><div class="num" style="font-size:1.5rem;font-weight:700">' + viajesPlan + ' viajes</div></div>' +
    '<div><div class="meta-line">Metros (MR / M3)</div><div class="num" style="font-size:1.5rem;font-weight:700">' + volPlan.toLocaleString("es-CL") + "</div></div>" +
    (canEdit ? '<button class="btn sm btn-soft" id="pl-obj" style="align-self:center">Editar objetivo</button>' : "") + "</div>";

  const acciones = canEdit ? '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="pl-auto" style="flex:1;min-width:150px">' + I.route + "Asignación automática</button>" +
    (plan.estado === "borrador" || plan._nuevo ? '<button class="btn btn-steel" id="pl-aprobar" style="flex:1;min-width:150px">' + I.check + "Aprobar programa</button>" : "") +
    '<button class="btn btn-steel" id="pl-reprog" style="flex:1;min-width:150px">' + I.wrench + "Reprogramar</button>" +
    "</div>" : "";

  view.innerHTML =
    '<button class="backlink" id="pl-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Planificación de flota</h2><span class="pill ' + est.c + '"><span class="dot"></span>' + est.l + "</span></div>" +
    '<div class="pl-weeknav section"><button class="btn sm btn-soft" id="pl-prev">' + I.back + "Semana</button>" +
      '<div class="pl-weeklabel"><b>Semana ' + wk.num + '</b><span>' + fmtDate(wk.inicio) + " ─ " + fmtDate(wk.fin) + "</span></div>" +
      '<button class="btn sm btn-soft" id="pl-next">Semana' + I.arrow + "</button></div>" +
    '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn sm btn-ghost" id="pl-hoy">HOY</button>' +
      '<button class="btn sm btn-ghost" id="pl-oper">' + I.truck + "Operación de hoy</button>" +
      '<button class="btn sm btn-ghost" id="pl-ctrl">' + I.chart + "Plan vs. real</button>" +
      '<button class="btn sm btn-ghost" id="pl-clima">' + I.alert + "Clima</button>" +
      (can(ctx.profile, "plan.manage") ? '<button class="btn sm btn-ghost" id="pl-faenas">' + I.pin + "Faenas</button>" : "") + "</div>" +
    kpis + acciones + matriz + alertsBlock + objetivo +
    '<p class="meta-line" style="font-size:.78rem;margin:14px 2px 4px">Camión, conductor, documentación y mantención se consultan desde el sistema; aquí solo se distribuyen los recursos.</p>';

  $("#pl-back", view).onclick = () => ctx.go("home", {});
  $("#pl-prev", view).onclick = () => { weekTs -= 7 * 86400000; renderPlanificacion(view, ctx); };
  $("#pl-next", view).onclick = () => { weekTs += 7 * 86400000; renderPlanificacion(view, ctx); };
  $("#pl-hoy", view).onclick = () => { weekTs = Date.now(); renderPlanificacion(view, ctx); };
  $("#pl-oper", view).onclick = () => ctx.go("operacion", {});
  $("#pl-ctrl", view).onclick = () => ctx.go("control", {});
  $("#pl-clima", view).onclick = () => ctx.go("clima", {});
  const bf = $("#pl-faenas", view); if (bf) bf.onclick = () => ctx.go("faenas", {});
  if (canEdit) {
    $$("[data-cell]", view).forEach(b => b.onclick = () => {
      const [camionId, dk] = b.getAttribute("data-cell").split("|");
      openDay(view, ctx, plan, refs, camionId, dk);
    });
    const ob = $("#pl-obj", view); if (ob) ob.onclick = () => editObjetivo(view, ctx, plan);
    const ap = $("#pl-aprobar", view); if (ap) ap.onclick = () => aprobarPlan(view, ctx, plan);
    const rp = $("#pl-reprog", view); if (rp) rp.onclick = () => reprogramar(view, ctx, plan, refs);
    const au = $("#pl-auto", view); if (au) au.onclick = () => ctx.go("auto", {});
  } else {
    $$("[data-cell]", view).forEach(b => b.onclick = () => verDay(ctx, plan, refs, b.getAttribute("data-cell")));
  }
}

function editObjetivo(view, ctx, plan) {
  openSheet("Objetivo semanal",
    '<label class="fld"><span class="lb">Meta de viajes de la semana</span><input class="input num" id="ob-v" inputmode="numeric" value="' + (plan.objetivoViajes || "") + '"></label>' +
    '<button class="btn btn-primary" id="ob-ok">Guardar objetivo</button>',
    () => {
      $("#ob-ok").onclick = async () => {
        plan.objetivoViajes = Math.max(0, Number($("#ob-v").value) || 0);
        try { await persistPlan(plan); closeSheet(); toast("Objetivo actualizado", "ok"); renderPlanificacion(view, ctx); }
        catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
      };
    });
}

// Guarda el plan; si era nuevo/borrador lo crea. Añade metadatos de autoría.
async function persistPlan(plan) {
  const clean = Object.assign({}, plan); delete clean._nuevo;
  if (!clean.createdAt) { clean.createdAt = Date.now(); clean.createdBy = (store.currentProfile() && store.currentProfile().uid) || ""; }
  await store.savePlan(clean.id, clean);
  plan._nuevo = false;
  return clean;
}

async function aprobarPlan(view, ctx, plan) {
  if (!plan.asignaciones.length) { toast("Agrega asignaciones antes de aprobar", "err"); return; }
  plan.estado = "planificado";
  plan.aprobadoAt = Date.now();
  // Guarda el programa original para comparar después.
  if (!plan.original) plan.original = JSON.parse(JSON.stringify(plan.asignaciones));
  try { await persistPlan(plan); toast("Programa aprobado", "ok"); renderPlanificacion(view, ctx); }
  catch (e) { toast("No se pudo aprobar: " + (e.message || e), "err"); }
}

// -------- Día del camión: lista de viajes/faenas (varios por día) --------
function openDay(view, ctx, plan, refs, camionId, dk) {
  const { trucks, faenas, conductores } = refs;
  const t = trucks.find(x => x.id === camionId) || { num: "?" };
  const dTs = new Date(dk + "T12:00:00").getTime();
  const dia = DIAS_LARGO[new Date(dTs).getDay() === 0 ? 6 : new Date(dTs).getDay() - 1];
  const list = plan.asignaciones.filter(a => a.camionId === camionId && a.fecha === dk && a.faenaId)
    .sort((a, b) => (a.turnoInicio || "").localeCompare(b.turnoInicio || ""));
  const rows = list.length ? list.map(a => {
    const co = conductores.find(c => c.uid === a.conductorId);
    const col = faColor(faenas, a.faenaId);
    return '<div class="row" data-edit="' + a.id + '" style="cursor:pointer"><span class="sev-stripe" style="background:' + col + '"></span>' +
      '<div class="rl"><div class="t">' + esc(faName(faenas, a.faenaId)) + ' <span class="pill neutral">' + (a.viajesObjetivo || 0) + " v.</span></div>" +
      '<div class="m"><span>' + esc((a.turnoInicio || "--") + " ─ " + (a.turnoFin || "--")) + "</span>" + (co ? "<span>" + esc(co.nombre) + "</span>" : "") + "</div></div><span class='arrow'>" + I.arrow + "</span></div>";
  }).join("") : emptyBox("Día en reserva. Agrega el primer viaje.");
  openSheet(t.num + " · " + fmtDate(dTs),
    '<p class="meta-line" style="margin:0 0 10px">' + esc(dia) + ". Un camión puede tener varios viajes/faenas el mismo día, en horarios que no se crucen.</p>" +
    '<div class="card" style="box-shadow:none;margin-bottom:12px">' + rows + "</div>" +
    '<button class="btn btn-primary" id="dy-add" style="width:100%">' + I.plus + "Agregar viaje / faena</button>",
    () => {
      $("#dy-add").onclick = () => { closeSheet(); openAssignment(view, ctx, plan, refs, camionId, dk, null); };
      $$("[data-edit]").forEach(b => b.onclick = () => { const id = b.getAttribute("data-edit"); closeSheet(); openAssignment(view, ctx, plan, refs, camionId, dk, id); });
    });
}

// -------- Ficha de asignación (crear / editar un viaje) --------
function openAssignment(view, ctx, plan, refs, camionId, dk, assignId) {
  const { trucks, faenas, conductores } = refs;
  const t = trucks.find(x => x.id === camionId) || { num: "?" };
  const dTs = new Date(dk + "T12:00:00").getTime();
  const existing = assignId ? plan.asignaciones.find(a => a.id === assignId) : null;
  // Sugerencia de horario: si ya hay viajes ese día, parte al terminar el último.
  const others = plan.asignaciones.filter(a => a.camionId === camionId && a.fecha === dk && a.faenaId && (!existing || a.id !== existing.id));
  let defIni = "07:00", defFin = "17:00";
  if (!existing && others.length) { const last = others.map(a => a.turnoFin).filter(Boolean).sort().pop(); if (last) { defIni = last; defFin = ""; } }
  const d = existing
    ? Object.assign({}, existing)
    : { id: uid("as"), camionId, fecha: dk, conductorId: "", faenaId: "", turnoInicio: defIni, turnoFin: defFin, viajesObjetivo: "", volumenObjetivo: "", estado: "planificado" };

  const av = truckAvailability(t, refs, dTs);
  const dia = DIAS_LARGO[new Date(dTs).getDay() === 0 ? 6 : new Date(dTs).getDay() - 1];

  function checkRow(it) { const cls = it.st === "bad" ? "crit" : it.st === "warn" ? "warn" : "ok"; const dot = it.st === "bad" ? "🔴" : it.st === "warn" ? "🟡" : "🟢"; return '<div style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:.86rem"><span>' + dot + '</span><span style="color:var(--' + cls + ')">' + esc(it.label) + "</span></div>"; }

  const faOpts = '<option value="">— Selecciona faena —</option>' + faenas.filter(f => f.activa !== false).map(f => '<option value="' + f.id + '"' + (d.faenaId === f.id ? " selected" : "") + ">" + esc(f.nombre) + (faenaAccess(f).k !== "operativa" ? " (" + faenaAccess(f).label.toLowerCase() + ")" : "") + "</option>").join("");
  const coOpts = '<option value="">— Selecciona conductor —</option>' + conductores.map(c => '<option value="' + c.uid + '"' + (d.conductorId === c.uid ? " selected" : "") + ">" + esc(c.nombre) + "</option>").join("");

  const body =
    '<div class="meta-line" style="margin:0 0 12px">' + esc(dia + " " + fmtDate(dTs)) + " · Camión " + esc(t.num) + " (" + esc(t.patente || "") + ")</div>" +
    '<div class="card pad" style="box-shadow:none;border-color:var(--line);margin-bottom:12px"><span class="eyebrow" style="display:block;margin-bottom:6px">Disponibilidad del camión</span><div id="as-checks">' + av.items.map(checkRow).join("") + '<div id="as-driver"></div></div></div>' +
    '<label class="fld"><span class="lb">Faena</span><select class="input" id="as-faena">' + faOpts + "</select></label>" +
    '<label class="fld"><span class="lb">Conductor</span><select class="input" id="as-cond">' + coOpts + "</select></label>" +
    '<div class="grid2"><label class="fld"><span class="lb">Viajes objetivo</span><input class="input num" id="as-viajes" inputmode="numeric" value="' + esc(d.viajesObjetivo) + '"></label>' +
    '<label class="fld"><span class="lb">MR / M3 (Objetivo)</span><input class="input num" id="as-vol" inputmode="numeric" value="' + esc(d.volumenObjetivo) + '"></label></div>' +
    '<div class="grid2"><label class="fld"><span class="lb">Turno inicio</span><input class="input" type="time" id="as-ini" value="' + esc(d.turnoInicio) + '"></label>' +
    '<label class="fld"><span class="lb">Turno término</span><input class="input" type="time" id="as-fin" value="' + esc(d.turnoFin) + '"></label></div>' +
    '<button class="btn btn-primary" id="as-ok" style="width:100%">' + I.check + "Guardar asignación</button>" +
    (existing ? '<button class="btn btn-soft" id="as-del" style="width:100%;margin-top:8px;color:var(--crit)">Quitar asignación (dejar reserva)</button>' : "");

  openSheet(existing ? "Editar viaje" : "Nuevo viaje / faena", body, () => {
    const refreshDriver = () => {
      const cid = $("#as-cond").value;
      const el = $("#as-driver"); if (!el) return;
      if (!cid) { el.innerHTML = ""; return; }
      const da = driverAvailability(cid, plan, dTs, d.id, $("#as-ini").value, $("#as-fin").value);
      el.innerHTML = da.items.map(checkRow).join("");
    };
    $("#as-cond").onchange = refreshDriver;
    $("#as-ini").onchange = refreshDriver; $("#as-fin").onchange = refreshDriver;
    refreshDriver();
    $("#as-ok").onclick = async () => {
      d.faenaId = $("#as-faena").value;
      d.conductorId = $("#as-cond").value;
      d.viajesObjetivo = Number($("#as-viajes").value) || 0;
      d.volumenObjetivo = Number($("#as-vol").value) || 0;
      d.turnoInicio = $("#as-ini").value; d.turnoFin = $("#as-fin").value;
      if (!d.faenaId) { toast("Selecciona una faena", "err"); return; }
      const fa = faenas.find(f => f.id === d.faenaId);
      if (fa && faenaAccess(fa).k === "cerrada") { toast("La faena está cerrada. Cambia el estado de acceso primero.", "err"); return; }
      if (toMin(d.turnoInicio) == null || toMin(d.turnoFin) == null) { toast("Indica el horario de inicio y término", "err"); return; }
      if (toMin(d.turnoFin) <= toMin(d.turnoInicio)) { toast("El término debe ser posterior al inicio", "err"); return; }
      // Restricción: no se pueden cruzar dos viajes del mismo camión el mismo día.
      if (truckTimeClash(plan, camionId, dTs, d.turnoInicio, d.turnoFin, d.id)) { toast("Este camión ya tiene un viaje en ese horario", "err"); return; }
      if (d.conductorId && !driverAvailability(d.conductorId, plan, dTs, d.id, d.turnoInicio, d.turnoFin).ok) { toast("Ese conductor ya tiene un viaje en ese horario", "err"); return; }
      // upsert
      const idx = plan.asignaciones.findIndex(a => a.id === d.id);
      if (idx >= 0) plan.asignaciones[idx] = d; else plan.asignaciones.push(d);
      if (plan.estado === "planificado") plan.estado = "modificado";
      try { await persistPlan(plan); closeSheet(); toast("Viaje guardado", "ok"); renderPlanificacion(view, ctx); }
      catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
    };
    const del = $("#as-del"); if (del) del.onclick = async () => {
      plan.asignaciones = plan.asignaciones.filter(a => a.id !== d.id);
      if (plan.estado === "planificado") plan.estado = "modificado";
      try { await persistPlan(plan); closeSheet(); toast("Viaje quitado", "ok"); renderPlanificacion(view, ctx); }
      catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
    };
  });
}

// Solo lectura (gerente): lista los viajes del día.
function verDay(ctx, plan, refs, cellKey) {
  const [camionId, dk] = cellKey.split("|");
  const { trucks, faenas, conductores } = refs;
  const t = trucks.find(x => x.id === camionId) || { num: "?" };
  const list = plan.asignaciones.filter(a => a.camionId === camionId && a.fecha === dk && a.faenaId)
    .sort((a, b) => (a.turnoInicio || "").localeCompare(b.turnoInicio || ""));
  if (!list.length) { toast("Día en reserva (sin asignación)", "ok"); return; }
  const body = list.map(a => { const co = conductores.find(c => c.uid === a.conductorId);
    return '<div class="card pad" style="box-shadow:none;border-color:var(--line);margin-bottom:10px">' +
      row2("Faena", faName(faenas, a.faenaId)) + row2("Conductor", co ? co.nombre : "Sin asignar") +
      row2("Viajes objetivo", String(a.viajesObjetivo || 0)) + row2("MR / M3 (Objetivo)", String(a.volumenObjetivo || 0)) +
      row2("Turno", (a.turnoInicio || "") + " ─ " + (a.turnoFin || "")) + "</div>"; }).join("");
  openSheet(t.num + " · " + fmtDate(new Date(dk + "T12:00:00").getTime()), body, () => {});
}
function row2(k, v) {
  return '<div style="display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line)"><span class="meta-line">' + esc(k) + '</span><b style="text-align:right;font-weight:600">' + esc(v) + "</b></div>";
}

// -------- Reprogramación --------
function reprogramar(view, ctx, plan, refs) {
  const { trucks, faenas } = refs;
  const activos = trucks.filter(t => t.activo !== false);
  // Camiones con asignaciones que hoy no están disponibles (candidatos a reprogramar).
  const conflictivos = activos.filter(t => plan.asignaciones.some(a => a.camionId === t.id) && !truckAvailability(t, refs, weekTs).ok);
  const opciones = (conflictivos.length ? conflictivos : activos.filter(t => plan.asignaciones.some(a => a.camionId === t.id)));
  const body =
    '<p class="meta-line" style="margin:0 0 12px">Selecciona el camión afectado (avería, ausencia, etc.). Se conserva el programa original.</p>' +
    '<div class="card" style="box-shadow:none">' + (opciones.length ? opciones.map(t => {
      const n = plan.asignaciones.filter(a => a.camionId === t.id && a.faenaId).length;
      const av = truckAvailability(t, refs, weekTs);
      return '<div class="row" data-rp="' + t.id + '" style="cursor:pointer"><span class="trucknum sm">' + esc(t.num) + '</span><div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + '</div><div class="m"><span>' + n + ' asignación(es)</span><span class="' + (av.ok ? "" : "") + '">' + (av.ok ? "Disponible" : "No disponible") + '</span></div></div><span class="arrow">' + I.arrow + "</span></div>";
    }).join("") : emptyBox("No hay camiones con asignaciones")) + "</div>";
  openSheet("Reprogramar", body, () => {
    $$("[data-rp]").forEach(b => b.onclick = () => { const id = b.getAttribute("data-rp"); closeSheet(); reprogTruck(view, ctx, plan, refs, id); });
  });
}

function reprogTruck(view, ctx, plan, refs, truckId) {
  const { trucks, faenas } = refs;
  const t = trucks.find(x => x.id === truckId) || { num: "?" };
  const afectadas = plan.asignaciones.filter(a => a.camionId === truckId && a.faenaId);
  // Camiones disponibles para recibir (excluye el afectado).
  const dispo = trucks.filter(x => x.activo !== false && x.id !== truckId && truckAvailability(x, refs, weekTs).ok);
  const dispoOpts = '<option value="">— Elegir camión —</option>' + dispo.map(x => '<option value="' + x.id + '">' + esc(x.num + " · " + x.patente) + "</option>").join("") + '<option value="__pend">Dejar pendiente</option>';
  const body =
    '<div class="meta-line" style="margin:0 0 10px"><b style="color:var(--ink)">' + esc(t.num) + '</b> · ' + afectadas.length + ' asignación(es) afectada(s)</div>' +
    '<label class="fld"><span class="lb">Motivo del cambio</span><input class="input" id="rt-motivo" placeholder="Ej: avería, fuera de servicio"></label>' +
    '<div class="card" style="box-shadow:none">' + (afectadas.length ? afectadas.sort((a, b) => a.fecha < b.fecha ? -1 : 1).map(a =>
      '<div class="row"><div class="rl"><div class="t">' + esc(fmtDate(new Date(a.fecha + "T12:00:00").getTime()).replace(/,.*/, "")) + " · " + esc(faName(faenas, a.faenaId)) + ' <span class="pill neutral">' + (a.viajesObjetivo || 0) + ' v.</span></div>' +
      '<div class="m" style="margin-top:6px"><select class="input" data-reasg="' + a.id + '">' + dispoOpts + "</select></div></div></div>").join("") : emptyBox("Sin asignaciones")) + "</div>" +
    '<button class="btn btn-primary" id="rt-ok" style="width:100%">' + I.check + "Aplicar reprogramación</button>";
  openSheet("Reprogramar · " + t.num, body, () => {
    $("#rt-ok").onclick = async () => {
      const motivo = ($("#rt-motivo").value || "").trim();
      if (!motivo) { toast("Indica el motivo del cambio", "err"); return; }
      if (!plan.original) plan.original = JSON.parse(JSON.stringify(plan.asignaciones));
      const por = (store.currentProfile() && store.currentProfile().nombre) || "";
      const ts = Date.now();
      let cambios = 0;
      $$("[data-reasg]").forEach(sel => {
        const aid = sel.getAttribute("data-reasg"); const destino = sel.value;
        if (!destino) return;
        const a = plan.asignaciones.find(x => x.id === aid); if (!a) return;
        const antes = JSON.parse(JSON.stringify(a));
        if (destino === "__pend") { a.estado = "pendiente"; a.reprogramado = true; }
        else {
          // ¿el destino ya tiene asignación ese día? entonces creamos una nueva y dejamos la original pendiente
          const ocupado = plan.asignaciones.find(x => x.camionId === destino && x.fecha === a.fecha && x.faenaId);
          if (ocupado) { toast("El camión destino ya tiene faena ese día", "err"); return; }
          a.camionId = destino; a.reprogramado = true; a.estado = "planificado";
        }
        plan.cambios = plan.cambios || [];
        plan.cambios.push({ asignacionOriginal: antes, asignacionNueva: JSON.parse(JSON.stringify(a)), motivo, usuario: por, ts });
        cambios++;
      });
      if (!cambios) { toast("Elige al menos un destino", "err"); return; }
      plan.estado = "modificado";
      try { await persistPlan(plan); closeSheet(); toast(cambios + " asignación(es) reprogramada(s)", "ok"); renderPlanificacion(view, ctx); }
      catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
    };
  });
}

// =============================================================
//  PANTALLA 2 · Operación del día (móvil)
// =============================================================
async function operacionDia(view, ctx) {
  const hoy = Date.now();
  const dk = dayKey(hoy);
  const wk = weekInfo(hoy);
  const plans = await store.listPlans();
  const plan = plans.find(p => p.id === wk.key) || { asignaciones: [] };
  const refs = await loadRefs();
  const { trucks, faenas, conductores, trips } = refs;
  const hoyAsig = (plan.asignaciones || []).filter(a => a.fecha === dk && a.faenaId);

  const cards = hoyAsig.length ? hoyAsig.map(a => {
    const t = trucks.find(x => x.id === a.camionId) || { num: "?" };
    const co = conductores.find(c => c.uid === a.conductorId);
    const fa = faenas.find(f => f.id === a.faenaId);
    const acc = fa ? faenaAccess(fa) : { k: "operativa", cls: "ok", label: "Operativa" };
    const realizados = trips.filter(v => v.truckId === a.camionId && dayKey(v.salida || v.ts) === dk).length;
    let estado;
    if (a.estado === "pendiente") estado = '<span class="pill neutral"><span class="dot"></span>Pendiente</span>';
    else if (acc.k === "cerrada") estado = '<span class="pill crit"><span class="dot"></span>Faena inaccesible</span>';
    else if (acc.k === "condicionada") estado = '<span class="pill warn"><span class="dot"></span>Acceso condicionado</span>';
    else if (realizados > 0) estado = '<span class="pill ok"><span class="dot"></span>Operando</span>';
    else estado = '<span class="pill warn"><span class="dot"></span>Sin iniciar</span>';
    return '<div class="card pad section"><div class="stat-truck" style="margin-bottom:8px"><span class="trucknum">' + esc(t.num) + "</span>" +
      '<div style="flex:1"><div style="font-weight:700;font-family:Barlow Semi Condensed;font-size:1.05rem">' + esc(co ? co.nombre : "Sin conductor") + "</div>" +
      '<div class="meta-line" style="margin-top:2px">' + esc(faName(faenas, a.faenaId)) + " · " + esc(t.patente || "") + "</div></div>" + estado + "</div>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><span class="pill neutral">Objetivo: ' + (a.viajesObjetivo || 0) + " v.</span>" +
      '<span class="pill ' + (realizados >= (a.viajesObjetivo || 0) && (a.viajesObjetivo || 0) > 0 ? "ok" : "steel") + '">Realizados: ' + realizados + "</span></div></div>";
  }).join("") : '<div class="card pad section">' + emptyBox("No hay asignaciones para hoy") + "</div>";

  const canEdit = can(ctx.profile, "plan.manage");
  view.innerHTML =
    '<button class="backlink" id="op-back">' + I.back + " Planificación</button>" +
    '<div class="subhead"><h2>Operación de hoy</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + esc(DIAS_LARGO[new Date(hoy).getDay() === 0 ? 6 : new Date(hoy).getDay() - 1] + " " + fmtDate(hoy)) + "</p>" +
    cards +
    '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" id="op-imprev" style="flex:1;min-width:150px">' + I.alert + "Reportar imprevisto</button>" +
    '<button class="btn btn-soft" id="op-clima" style="flex:1;min-width:150px">' + I.alert + "Clima</button>" +
    (canEdit ? '<button class="btn btn-steel" id="op-reprog" style="flex:1;min-width:150px">' + I.wrench + "Reprogramar</button>" : "") + "</div>";

  $("#op-back", view).onclick = () => ctx.go("planificacion", {});
  $("#op-imprev", view).onclick = () => reportarImprevisto(view, ctx, refs);
  $("#op-clima", view).onclick = () => ctx.go("clima", {});
  const rp = $("#op-reprog", view); if (rp) rp.onclick = () => { weekTs = Date.now(); loadWeek().then(({ plan }) => reprogramar(view, ctx, plan, refs)); };
}

function reportarImprevisto(view, ctx, refs) {
  const { trucks, faenas } = refs;
  const tipos = IMPREVISTO_TIPOS.map(t => '<button class="chip" data-it="' + t.k + '">' + esc(t.n) + "</button>").join("");
  const trkOpts = '<option value="">Camión (opcional)</option>' + trucks.map(t => '<option value="' + t.id + '">' + esc(t.num) + "</option>").join("");
  const faOpts = '<option value="">Faena (opcional)</option>' + faenas.map(f => '<option value="' + f.id + '">' + esc(f.nombre) + "</option>").join("");
  const st = { tipo: "" };
  openSheet("Reportar imprevisto",
    '<label class="fld"><span class="lb">Tipo</span><div class="chips" id="im-tipos">' + tipos + "</div></label>" +
    '<div class="grid2"><label class="fld"><span class="lb">Camión</span><select class="input" id="im-truck">' + trkOpts + "</select></label>" +
    '<label class="fld"><span class="lb">Faena</span><select class="input" id="im-faena">' + faOpts + "</select></label></div>" +
    '<label class="fld"><span class="lb">Descripción</span><textarea class="input" id="im-desc" placeholder="Qué ocurrió..."></textarea></label>' +
    '<button class="btn btn-primary" id="im-ok" style="width:100%">' + I.check + "Registrar imprevisto</button>",
    () => {
      $$("#im-tipos [data-it]").forEach(b => b.onclick = () => { st.tipo = b.getAttribute("data-it"); $$("#im-tipos [data-it]").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
      $("#im-ok").onclick = async () => {
        const desc = ($("#im-desc").value || "").trim();
        if (!st.tipo) { toast("Elige el tipo de imprevisto", "err"); return; }
        if (!desc) { toast("Describe el imprevisto", "err"); return; }
        const p = store.currentProfile() || {};
        try {
          await store.addImprevisto({
            tipo: st.tipo, camionId: $("#im-truck").value || null, faenaId: $("#im-faena").value || null,
            conductorId: p.uid || null, descripcion: desc, reportadoPor: p.nombre || "", estado: "abierto"
          });
          closeSheet(); toast("Imprevisto registrado", "ok"); renderPlanificacion(view, ctx);
        } catch (e) { toast("No se pudo registrar: " + (e.message || e), "err"); }
      };
    });
}

// =============================================================
//  PANTALLA 3 · Control planificado vs. real
// =============================================================
async function controlScreen(view, ctx) {
  const { wk, plan } = await loadWeek();
  const refs = await loadRefs();
  const { trucks, faenas, trips } = refs;
  const asig = plan.asignaciones || [];

  // Viajes reales de la semana por camión (viajes cerrados dentro del rango).
  const inWeek = v => { const ts = v.salida || v.ts; return ts >= wk.inicio && ts < wk.fin + 86400000; };
  const realTrips = trips.filter(inWeek);

  const camIds = Array.from(new Set(asig.map(a => a.camionId)));
  const filas = camIds.map(cid => {
    const t = trucks.find(x => x.id === cid) || { num: "?" };
    const plan_v = asig.filter(a => a.camionId === cid).reduce((s, a) => s + (Number(a.viajesObjetivo) || 0), 0);
    const plan_m = asig.filter(a => a.camionId === cid).reduce((s, a) => s + (Number(a.volumenObjetivo) || 0), 0);
    const real_v = realTrips.filter(v => v.truckId === cid && v.estado === "cerrado").length;
    const real_m = realTrips.filter(v => v.truckId === cid).reduce((s, v) => s + (Number(v.volumen) || 0), 0);
    const dif = real_v - plan_v;
    return { t, plan_v, plan_m, real_v, real_m, dif };
  });

  const totPlanV = filas.reduce((s, f) => s + f.plan_v, 0);
  const totRealV = filas.reduce((s, f) => s + f.real_v, 0);
  const totPlanM = filas.reduce((s, f) => s + f.plan_m, 0);
  const totRealM = filas.reduce((s, f) => s + f.real_m, 0);
  const cumpl = totPlanV ? Math.round(totRealV / totPlanV * 100) : 0;

  const kpi = (cls, val, lab, sub) => '<div class="kpi ' + cls + '"><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";

  const rows = filas.length ? filas.map(f =>
    '<tr><td class="pl-th-fix"><b>' + esc(f.t.num) + "</b></td><td class='num'>" + f.plan_v + "</td><td class='num'>" + f.real_v + "</td>" +
    "<td class='num' style='color:var(--" + (f.dif < 0 ? "crit" : "ok") + ")'>" + (f.dif > 0 ? "+" : "") + f.dif + "</td>" +
    "<td class='num'>" + f.plan_m.toLocaleString("es-CL") + "</td><td class='num'>" + f.real_m.toLocaleString("es-CL") + "</td></tr>"
  ).join("") : '<tr><td colspan="6">' + emptyBox("Sin asignaciones esta semana") + "</td></tr>";

  view.innerHTML =
    '<button class="backlink" id="ct-back">' + I.back + " Planificación</button>" +
    '<div class="subhead"><h2>Planificado vs. real</h2><span class="pill steel">Semana ' + wk.num + "</span></div>" +
    '<p class="meta-line" style="margin:-4px 2px 14px">' + fmtDate(wk.inicio) + " ─ " + fmtDate(wk.fin) + "</p>" +
    '<div class="kpis section">' +
      kpi("a", totPlanV + " / " + totRealV, "Viajes plan/real", cumpl + "% cumplido") +
      kpi(totRealV - totPlanV < 0 ? "c" : "g", (totRealV - totPlanV > 0 ? "+" : "") + (totRealV - totPlanV), "Diferencia", "viajes") +
      kpi("a", totPlanM.toLocaleString("es-CL"), "Metros plan. (MR / M3)", "capacidad") +
      kpi("a", totRealM.toLocaleString("es-CL"), "Metros reales (MR / M3)", "ejecutado") +
    "</div>" +
    '<div class="pl-matrix-wrap section"><table class="pl-matrix ctrl"><thead><tr><th class="pl-th-fix">Camión</th><th>Plan v.</th><th>Real v.</th><th>Dif.</th><th>Plan MR/M3</th><th>Real MR/M3</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    (plan.cambios && plan.cambios.length ? '<div class="section"><span class="eyebrow">Cambios al programa (' + plan.cambios.length + ')</span><div class="card" style="margin-top:8px">' +
      plan.cambios.slice(0, 8).map(c => '<div class="row"><span class="sev-stripe sev-media"></span><div class="rl"><div class="t">' + esc(c.motivo) + '</div><div class="m"><span>' + esc(c.usuario || "") + "</span><span>" + fmtDateTime(c.ts) + "</span></div></div></div>").join("") + "</div></div>" : "") +
    '<p class="meta-line" style="font-size:.78rem;margin:14px 2px 4px">El plan responde “qué queremos hacer”; la bitácora “qué ocurrió realmente”. Aquí se comparan.</p>';

  $("#ct-back", view).onclick = () => ctx.go("planificacion", {});
}

// =============================================================
//  CLIMA · consulta por georreferencia (Open-Meteo) + parámetros
// =============================================================
async function climaScreen(view, ctx) {
  const canEdit = can(ctx.profile, "plan.manage");
  const [faenas, pc] = await Promise.all([store.listFaenas(), store.getPlanConfig("clima")]);
  const params = Object.assign({}, CLIMA_PARAMS_DEFAULT, pc || {});
  const activas = faenas.filter(f => f.activa !== false);

  const num = (v, u) => v == null ? "s/d" : (Math.round(v * 10) / 10) + (u || "");
  const cards = activas.length ? activas.map(f => {
    const r = f.clima || null;
    const ac = faenaAccess(f);            // condición operacional actual (manual)
    const sug = evaluarAccesoClima(r, params); // sugerencia según clima
    const w = r && r.code != null ? wmoDesc(r.code) : { t: "Sin datos", e: "🌡️" };
    const body = r
      ? '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 6px">' +
          '<div><div class="meta-line" style="font-size:.74rem">Estado</div><div style="font-weight:600">' + w.e + " " + esc(w.t) + "</div></div>" +
          '<div><div class="meta-line" style="font-size:.74rem">Temp.</div><div class="num" style="font-weight:600">' + num(r.tempC, " °C") + "</div></div>" +
          '<div><div class="meta-line" style="font-size:.74rem">Lluvia 24h</div><div class="num" style="font-weight:600">' + num(r.precip24, " mm") + "</div></div>" +
          '<div><div class="meta-line" style="font-size:.74rem">Viento</div><div class="num" style="font-weight:600">' + num(r.windKmh, " km/h") + "</div></div>" +
          '<div><div class="meta-line" style="font-size:.74rem">Prob. lluvia</div><div class="num" style="font-weight:600">' + num(r.probLluvia, "%") + "</div></div>" +
        "</div>" +
        '<div class="meta-line" style="font-size:.76rem">Actualizado ' + fmtDateTime(r.ts) + "</div>"
      : '<p class="meta-line" style="margin:8px 0">' + (hasCoords(f) ? "Sin datos aún. Pulsa Actualizar clima." : "Falta cargar las coordenadas de esta faena.") + "</p>";
    const motivos = sug.motivos.length ? '<div class="meta-line" style="font-size:.78rem;margin-top:4px">' + esc(sug.motivos.join(" · ")) + "</div>" : "";
    const sugEstado = sug.k === "normal" ? "operativa" : sug.k;
    const aplicar = (canEdit && r && sugEstado !== ac.k) ? '<button class="btn sm btn-soft" data-aplicar="' + f.id + "|" + sug.k + '" style="margin-top:10px">Aplicar “' + esc(sug.label) + '” a la faena</button>' : "";
    const fixCoord = (canEdit && !hasCoords(f)) ? '<button class="btn sm btn-soft" data-coord="' + f.id + '" style="margin-top:10px">' + I.pin + "Cargar coordenadas</button>" : "";
    return '<div class="card pad section"><div class="subhead" style="margin:0"><h2 style="font-size:1.05rem">' + esc(f.nombre) + "</h2>" +
      '<span class="pill ' + ac.cls + '"><span class="dot"></span>' + ac.label + "</span></div>" +
      '<div class="meta-line" style="font-size:.8rem">' + esc([f.ubicacion, f.comuna].filter(Boolean).join(", ")) + (hasCoords(f) ? "" : " · sin coordenadas") + "</div>" +
      body +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="meta-line" style="font-size:.78rem">Acceso estimado por clima:</span><span class="pill ' + sug.cls + '"><span class="dot"></span>' + sug.label + "</span></div>" +
      motivos + aplicar + fixCoord + "</div>";
  }).join("") : '<div class="card pad section">' + emptyBox("No hay faenas registradas") + "</div>";

  view.innerHTML =
    '<button class="backlink" id="cl-back">' + I.back + " Planificación</button>" +
    '<div class="subhead"><h2>Condiciones meteorológicas</h2></div>' +
    '<p class="meta-line" style="margin:-4px 2px 12px;font-size:.82rem">El clima es una señal de riesgo: sugiere el acceso, pero la condición de la faena la confirma el encargado.</p>' +
    '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" id="cl-update" style="flex:1;min-width:160px">' + I.download + "Actualizar clima</button>" +
    (canEdit ? '<button class="btn btn-soft" id="cl-params" style="flex:1;min-width:140px">' + I.gear + "Parámetros</button>" : "") + "</div>" +
    '<div class="meta-line" style="font-size:.76rem;margin:0 2px 8px">Umbrales: lluvia > ' + params.lluvia24Max + " mm/24h · viento > " + params.vientoMax + " km/h · prob. lluvia > " + params.probMax + "%</div>" +
    cards;

  $("#cl-back", view).onclick = () => ctx.go("planificacion", {});
  const up = $("#cl-update", view);
  up.onclick = async () => {
    up.disabled = true; up.textContent = "Consultando...";
    try {
      // 1) Faenas sin coordenadas: intenta obtenerlas por su comuna/ubicación.
      let geocoded = 0;
      for (const f of activas) {
        if (hasCoords(f)) continue;
        const q = (f.comuna || "").trim() || (f.ubicacion || "").trim();
        if (!q) continue;
        try { const r = await geocode(q); if (r) { f.lat = r.lat; f.lng = r.lng; await store.patchFaena(f.id, { lat: r.lat, lng: r.lng }); geocoded++; } } catch (e) {}
      }
      const conCoords = activas.filter(hasCoords);
      if (!conCoords.length) {
        toast("No se pudieron obtener coordenadas. Revisa la comuna o cárgalas a mano en Faenas.", "err");
        up.disabled = false; up.textContent = "Actualizar clima"; return;
      }
      // 2) Consulta el clima de las faenas con coordenadas.
      const res = await fetchClimaFaenas(conCoords);
      let okN = 0;
      for (const f of conCoords) { const r = res[f.id]; if (r && r.ok) { await store.saveFaenaClima(f.id, r.reading); okN++; } }
      const sinCoord = activas.length - conCoords.length;
      const extra = sinCoord ? " · " + sinCoord + " sin ubicar" : "";
      toast(okN ? "Clima actualizado (" + okN + " faena" + (okN > 1 ? "s" : "") + ")" + extra
                : "No se pudo consultar el clima. Revisa la conexión.", okN ? "ok" : "err");
      climaScreen(view, ctx);
    } catch (e) { toast("No se pudo actualizar: " + (e.message || e), "err"); up.disabled = false; up.textContent = "Actualizar clima"; }
  };
  const pb = $("#cl-params", view); if (pb) pb.onclick = () => climaParams(view, ctx, params);
  $$("[data-aplicar]", view).forEach(b => b.onclick = () => {
    const [fid, k] = b.getAttribute("data-aplicar").split("|");
    aplicarAcceso(view, ctx, fid, k);
  });
  $$("[data-coord]", view).forEach(b => b.onclick = () => ctx.go("faenas", { faenaId: b.getAttribute("data-coord") }));
}

function climaParams(view, ctx, params) {
  openSheet("Parámetros de clima",
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Umbrales que levantan una alerta de acceso condicionado. No cierran la faena; solo la sugieren.</p>' +
    '<label class="fld"><span class="lb">Lluvia máxima (mm en 24h)</span><input class="input num" id="cp-lluvia" inputmode="decimal" value="' + esc(params.lluvia24Max) + '"></label>' +
    '<label class="fld"><span class="lb">Viento máximo (km/h)</span><input class="input num" id="cp-viento" inputmode="decimal" value="' + esc(params.vientoMax) + '"></label>' +
    '<label class="fld"><span class="lb">Probabilidad de lluvia máxima (%)</span><input class="input num" id="cp-prob" inputmode="numeric" value="' + esc(params.probMax) + '"></label>' +
    '<button class="btn btn-primary" id="cp-ok" style="width:100%">' + I.check + "Guardar parámetros</button>",
    () => {
      $("#cp-ok").onclick = async () => {
        const p = {
          lluvia24Max: Number($("#cp-lluvia").value) || 0,
          vientoMax: Number($("#cp-viento").value) || 0,
          probMax: Number($("#cp-prob").value) || 0
        };
        try { await store.savePlanConfig("clima", p); closeSheet(); toast("Parámetros guardados", "ok"); climaScreen(view, ctx); }
        catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
      };
    });
}

// Aplica (con confirmación manual) la condición sugerida a la faena.
function aplicarAcceso(view, ctx, faenaId, k) {
  const label = k === "cerrada" ? "Cerrada" : k === "condicionada" ? "Condicionada" : "Operativa";
  openSheet("Confirmar condición",
    '<p class="meta-line" style="margin:0 0 14px">Vas a fijar el acceso de la faena en <b style="color:var(--ink)">' + esc(label) + "</b>. Esta es una decisión operacional; el clima es solo una referencia.</p>" +
    '<button class="btn btn-primary" id="ap-ok" style="width:100%">' + I.check + "Confirmar " + esc(label) + "</button>",
    () => {
      $("#ap-ok").onclick = async () => {
        try {
          const f = await store.getFaena(faenaId); if (!f) return;
          f.estadoAcceso = k === "normal" ? "operativa" : k;
          await store.saveFaena(faenaId, f);
          closeSheet(); toast("Condición de la faena actualizada", "ok"); climaScreen(view, ctx);
        } catch (e) { toast("No se pudo aplicar: " + (e.message || e), "err"); }
      };
    });
}

// =============================================================
//  ASIGNACIÓN AUTOMÁTICA (motor configurable + propuesta)
// =============================================================
async function autoScreen(view, ctx) {
  if (!can(ctx.profile, "plan.manage")) return semanal(view, ctx);
  const { wk, plan } = await loadWeek();
  const refs = await loadRefs();
  const { trucks, faenas, conductores } = refs;
  const activos = trucks.filter(t => t.activo !== false);
  const activas = faenas.filter(f => f.activa !== false);
  const pc = await store.getPlanConfig("auto");
  const params = Object.assign({}, AUTO_PARAMS_DEFAULT, pc || {});

  // Estado de opciones (persistente entre generar/aprobar).
  if (!autoState || autoState.week !== wk.key) {
    autoState = { week: wk.key, criterio: params.criterio, reservaMin: params.reservaMin, jornadaMin: params.jornadaMin,
      capMR: params.capMR, capM3: params.capM3, dias: wk.dias.slice(0, 5).map(dayKey), proposal: null };
  }
  const st = autoState;

  const critOpts = CRITERIOS.map(c => '<button class="tile' + (st.criterio === c.k ? " sel" : "") + '" data-crit="' + c.k + '"><span class="tx"><b>' + esc(c.n) + "</b><span>" + esc(c.d) + "</span></span>" + (st.criterio === c.k ? I.check : "") + "</button>").join("");
  const diaChips = wk.dias.slice(0, 5).map((ts, i) => { const dk = dayKey(ts); const on = st.dias.indexOf(dk) >= 0;
    return '<button class="chip' + (on ? " on" : "") + '" data-dia="' + dk + '">' + DIAS[i] + " " + new Date(ts).getDate() + "</button>"; }).join("");

  let proposalBlock = "";
  if (st.proposal) {
    const pr = st.proposal;
    const faName2 = id => { const f = faenas.find(x => x.id === id); return f ? f.nombre : "—"; };
    const truckNum = id => { const t = trucks.find(x => x.id === id); return t ? t.num : "?"; };
    const resumen = pr.resumen.map(r => '<div class="row"><span class="sev-stripe ' + (r.cumpl >= 100 ? "sev-baja" : "sev-media") + '"></span><div class="rl"><div class="t">' + esc(r.nombre) +
      ' <span class="pill ' + (r.cumpl >= 100 ? "ok" : "warn") + '">' + r.cumpl + "%</span></div><div class='m'><span>" + r.trucks + " camión(es)</span><span>" + r.viajes + " / " + r.objetivo + " viajes</span><span>" + (r.volumen || 0) + " " + esc(r.unidad || "M3") + "</span></div></div></div>").join("");
    const detalle = pr.proposal.map(p => '<div class="row"><span class="trucknum sm">' + esc(truckNum(p.camionId)) + '</span><div class="rl"><div class="t">' + esc(faName2(p.faenaId)) +
      ' <span class="pill neutral">' + p.viajes + " v. · " + (p.volumen || 0) + " " + esc(p.unidad || "M3") + '</span></div><div class="m"><span>' + esc(p.conductorId ? (conductores.find(c => c.uid === p.conductorId) || {}).nombre || "" : "Sin conductor") + "</span></div></div></div>").join("");
    const reservaTxt = pr.reserva.length ? pr.reserva.map(truckNum).join(", ") : "Ninguno";
    const warns = pr.warnings.length ? '<div class="card pad section" style="border-color:var(--warn)"><span class="eyebrow" style="display:block;margin-bottom:6px">Advertencias</span>' +
      pr.warnings.map(w => '<div style="display:flex;gap:8px;padding:2px 0;font-size:.86rem">⚠️ <span>' + esc(w) + "</span></div>").join("") + "</div>" : "";
    proposalBlock =
      '<div class="section"><span class="eyebrow">Propuesta</span>' +
      '<div class="card" style="margin-top:8px">' + resumen +
        '<div class="row"><span class="sev-stripe sev-baja" style="background:var(--steel)"></span><div class="rl"><div class="t">Reserva</div><div class="m"><span>' + esc(reservaTxt) + "</span></div></div></div></div></div>" +
      '<div class="section"><span class="eyebrow">Detalle por camión</span><div class="card" style="margin-top:8px">' + detalle + "</div></div>" +
      warns +
      '<div class="formbar"><button class="btn btn-primary" id="au-aprobar">' + I.check + "Aprobar y aplicar a " + st.dias.length + " día(s)</button></div>";
  }

  view.innerHTML =
    '<button class="backlink" id="au-back">' + I.back + " Planificación</button>" +
    '<div class="subhead"><h2>Asignación automática</h2><span class="pill steel">Semana ' + wk.num + "</span></div>" +
    '<p class="meta-line" style="margin:-4px 2px 12px;font-size:.82rem">El sistema propone la distribución; tú la revisas y apruebas. Considera disponibilidad, objetivos, tiempos de ciclo y acceso de cada faena.</p>' +
    '<div class="section"><span class="eyebrow">Tipo de planificación</span><div class="tiles" style="margin-top:8px">' + critOpts + "</div></div>" +
    '<div class="card pad section"><div class="grid2"><label class="fld" style="margin:0"><span class="lb">Camiones de reserva</span><input class="input num" id="au-reserva" inputmode="numeric" value="' + esc(st.reservaMin) + '"></label>' +
      '<label class="fld" style="margin:0"><span class="lb">Jornada (horas)</span><input class="input num" id="au-jornada" inputmode="decimal" value="' + esc(Math.round(st.jornadaMin / 60 * 10) / 10) + '"></label></div>' +
      '<div class="grid2" style="margin-top:12px"><label class="fld" style="margin:0"><span class="lb">Capacidad por viaje · M3</span><input class="input num" id="au-capm3" inputmode="numeric" value="' + esc(st.capM3) + '"></label>' +
      '<label class="fld" style="margin:0"><span class="lb">Capacidad por viaje · MR</span><input class="input num" id="au-capmr" inputmode="numeric" value="' + esc(st.capMR) + '"></label></div>' +
      '<label class="fld" style="margin:14px 0 0"><span class="lb">Días a programar</span><div class="chips" id="au-dias">' + diaChips + "</div></label></div>" +
    '<div class="section"><button class="btn btn-steel" id="au-gen" style="width:100%">' + I.route + "Generar propuesta</button></div>" +
    proposalBlock;

  $("#au-back", view).onclick = () => { autoState = null; ctx.go("planificacion", {}); };
  $$("[data-crit]", view).forEach(b => b.onclick = () => { st.criterio = b.getAttribute("data-crit"); st.proposal = null; autoScreen(view, ctx); });
  $$("[data-dia]", view).forEach(b => b.onclick = () => { const dk = b.getAttribute("data-dia"); const i = st.dias.indexOf(dk); if (i >= 0) st.dias.splice(i, 1); else st.dias.push(dk); autoScreen(view, ctx); });
  const rv = $("#au-reserva", view); if (rv) rv.oninput = () => { st.reservaMin = Math.max(0, Number(rv.value) || 0); };
  const jr = $("#au-jornada", view); if (jr) jr.oninput = () => { st.jornadaMin = Math.max(60, Math.round((Number(jr.value) || 10) * 60)); };
  const cm3 = $("#au-capm3", view); if (cm3) cm3.oninput = () => { st.capM3 = Math.max(1, Number(cm3.value) || 20); };
  const cmr = $("#au-capmr", view); if (cmr) cmr.oninput = () => { st.capMR = Math.max(1, Number(cmr.value) || 18); };

  $("#au-gen", view).onclick = async () => {
    if (!st.dias.length) { toast("Elige al menos un día", "err"); return; }
    // Guarda los parámetros para la próxima vez.
    try { await store.savePlanConfig("auto", { criterio: st.criterio, reservaMin: st.reservaMin, jornadaMin: st.jornadaMin, capMR: st.capMR, capM3: st.capM3 }); } catch (e) {}
    const truckInputs = activos.map(t => ({ id: t.id, num: t.num, available: truckAvailability(t, refs, weekTs).ok }));
    const faenaInputs = activas.map(f => ({ id: f.id, nombre: f.nombre, objetivoDia: Number(f.objetivoDia) || 0, tiempoCiclo: Number(f.tiempoCiclo) || 0, unidad: f.unidad || "M3", accesoK: faenaAccess(f).k }));
    const res = autoAssign(truckInputs, faenaInputs, { jornadaMin: st.jornadaMin, reservaMin: st.reservaMin, criterio: st.criterio, capMR: st.capMR, capM3: st.capM3 });
    // Asigna conductores distintos (round-robin sin repetir el mismo día).
    res.proposal.forEach((p, i) => { p.conductorId = conductores[i] ? conductores[i].uid : ""; });
    if (res.proposal.some(p => !p.conductorId)) res.warnings.push("Faltan conductores para todos los camiones.");
    if (!faenaInputs.some(f => f.objetivoDia > 0)) { toast("Define el objetivo diario de las faenas primero", "err"); return; }
    st.proposal = res;
    autoScreen(view, ctx);
  };

  const ap = $("#au-aprobar", view);
  if (ap) ap.onclick = async () => {
    const pr = st.proposal; if (!pr) return;
    if (plan.estado === "planificado" && !plan.original) plan.original = JSON.parse(JSON.stringify(plan.asignaciones));
    const ini = "07:00", fin = minToHHMM(7 * 60 + st.jornadaMin);
    // Reemplaza las asignaciones de los días elegidos por la propuesta.
    plan.asignaciones = (plan.asignaciones || []).filter(a => st.dias.indexOf(a.fecha) < 0);
    st.dias.forEach(dk => {
      pr.proposal.forEach(p => {
        plan.asignaciones.push({ id: uid("as"), camionId: p.camionId, fecha: dk, conductorId: p.conductorId || "",
          faenaId: p.faenaId, turnoInicio: ini, turnoFin: fin, viajesObjetivo: p.viajes, volumenObjetivo: p.volumen || 0,
          estado: "planificado", auto: true });
      });
    });
    plan.estado = plan.estado === "borrador" || plan._nuevo ? "borrador" : "modificado";
    const btn = $("#au-aprobar", view); btn.disabled = true; btn.textContent = "Aplicando...";
    try {
      await persistPlan(plan);
      autoState = null;
      toast("Programa generado y aplicado", "ok");
      ctx.go("planificacion", {});
    } catch (e) { toast("No se pudo aplicar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Aprobar y aplicar"; }
  };
}

// =============================================================
//  Catálogo de FAENAS
// =============================================================
async function faenasScreen(view, ctx) {
  const editing = ctx.params.faenaId;
  if (editing !== undefined) return faenaForm(view, ctx, editing);
  const faenas = await store.listFaenas();
  const rows = faenas.length ? faenas.map(f => {
    const ac = faenaAccess(f);
    return '<div class="row" data-fa="' + f.id + '" style="cursor:pointer"><span class="sev-stripe ' + (ac.cls === "crit" ? "sev-alta" : ac.cls === "warn" ? "sev-media" : "sev-baja") + '"></span>' +
      '<div class="rl"><div class="t">' + esc(f.nombre) + ' <span class="pill ' + ac.cls + '"><span class="dot"></span>' + ac.label + "</span></div>" +
      '<div class="m"><span>' + esc([f.ubicacion, f.comuna].filter(Boolean).join(", ")) + "</span>" + (f.destino ? "<span>→ " + esc(f.destino) + "</span>" : "") + (f.capacidadDia ? "<span>" + f.capacidadDia + " v./día</span>" : "") + "</div></div><span class='arrow'>" + I.arrow + "</span></div>";
  }).join("") : emptyBox("No hay faenas registradas");
  view.innerHTML =
    '<button class="backlink" id="fa-back">' + I.back + " Planificación</button>" +
    '<div class="subhead"><h2>Faenas</h2><button class="btn sm btn-primary" id="fa-new">' + I.plus + "Nueva</button></div>" +
    '<div class="card section">' + rows + "</div>";
  $("#fa-back", view).onclick = () => ctx.go("planificacion", {});
  $("#fa-new", view).onclick = () => ctx.go("faenas", { faenaId: "" });
  $$("[data-fa]", view).forEach(b => b.onclick = () => ctx.go("faenas", { faenaId: b.getAttribute("data-fa") }));
}

async function faenaForm(view, ctx, id) {
  const f = id ? (await store.getFaena(id)) || {} : {};
  const d = {
    nombre: f.nombre || "", ubicacion: f.ubicacion || "", comuna: f.comuna || "", lat: f.lat != null ? f.lat : "", lng: f.lng != null ? f.lng : "",
    tipoMadera: f.tipoMadera || "", unidad: f.unidad || "M3", destino: f.destino || "",
    distancia: f.distancia || "", tiempoCiclo: f.tiempoCiclo || "", capacidadDia: f.capacidadDia || "", objetivoDia: f.objetivoDia || "",
    estadoAcceso: f.estadoAcceso || "operativa", restricciones: f.restricciones || "", activa: f.activa !== false
  };
  const accChip = (k, l, cls) => '<button class="chip ' + (d.estadoAcceso === k ? "on" : "") + '" data-acc="' + k + '">' + l + "</button>";
  view.innerHTML =
    '<button class="backlink" id="ff-back">' + I.back + " Faenas</button>" +
    '<div class="subhead"><h2>' + (id ? "Editar faena" : "Nueva faena") + "</h2></div>" +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Nombre</span><input class="input" id="ff-nombre" value="' + esc(d.nombre) + '"></label>' +
      '<div class="grid2"><label class="fld"><span class="lb">Ubicación</span><input class="input" id="ff-ubi" value="' + esc(d.ubicacion) + '"></label>' +
      '<label class="fld"><span class="lb">Comuna</span><input class="input" id="ff-comuna" value="' + esc(d.comuna) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Latitud</span><input class="input num" id="ff-lat" inputmode="decimal" placeholder="Ej: -37.80" value="' + esc(d.lat) + '"></label>' +
      '<label class="fld"><span class="lb">Longitud</span><input class="input num" id="ff-lng" inputmode="decimal" placeholder="Ej: -72.70" value="' + esc(d.lng) + '"></label></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 6px"><button type="button" class="btn sm btn-soft" id="ff-geo">' + I.pin + "Buscar por comuna</button>" +
      '<button type="button" class="btn sm btn-soft" id="ff-gps">' + I.pin + "Usar mi ubicación</button></div>" +
      '<p class="meta-line" style="font-size:.76rem;margin:0 2px 12px">Coordenadas para consultar el clima. Búscalas por comuna, usa tu GPS en terreno, o cópialas desde Google Maps (clic derecho sobre el punto).</p>' +
      '<div class="grid2"><label class="fld"><span class="lb">Tipo de madera</span><input class="input" id="ff-mad" value="' + esc(d.tipoMadera) + '"></label>' +
      '<label class="fld"><span class="lb">Destino</span><input class="input" id="ff-dest" value="' + esc(d.destino) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Distancia (km)</span><input class="input num" id="ff-dist" inputmode="numeric" value="' + esc(d.distancia) + '"></label>' +
      '<label class="fld"><span class="lb">Tiempo ciclo (min)</span><input class="input num" id="ff-ciclo" inputmode="numeric" value="' + esc(d.tiempoCiclo) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Objetivo diario (viajes)</span><input class="input num" id="ff-obj" inputmode="numeric" value="' + esc(d.objetivoDia) + '"></label>' +
      '<label class="fld"><span class="lb">Unidad de carga</span><select class="input" id="ff-unidad"><option value="M3"' + (d.unidad === "M3" ? " selected" : "") + '>M3 (20 por viaje)</option><option value="MR"' + (d.unidad === "MR" ? " selected" : "") + ">MR (18 por viaje)</option></select></label></div>" +
      '<label class="fld"><span class="lb">Capacidad (viajes/día)</span><input class="input num" id="ff-cap" inputmode="numeric" value="' + esc(d.capacidadDia) + '"></label>' +
      '<label class="fld"><span class="lb">Estado de acceso</span><div class="chips" id="ff-acc">' + accChip("operativa", "Operativa") + accChip("condicionada", "Condicionada") + accChip("cerrada", "Cerrada") + "</div></label>" +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Restricciones / observación</span><textarea class="input" id="ff-restr" placeholder="Ej: camino de tierra, intransitable con lluvia">' + esc(d.restricciones) + "</textarea></label>" +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="ff-save">' + I.check + "Guardar faena</button></div>";
  $("#ff-back", view).onclick = () => ctx.go("faenas", {});
  $$("#ff-acc [data-acc]", view).forEach(b => b.onclick = () => { d.estadoAcceso = b.getAttribute("data-acc"); $$("#ff-acc [data-acc]", view).forEach(x => x.classList.remove("on")); b.classList.add("on"); });
  const geoBtn = $("#ff-geo", view);
  if (geoBtn) geoBtn.onclick = async () => {
    const q = ($("#ff-comuna", view).value || "").trim() || ($("#ff-ubi", view).value || "").trim() || ($("#ff-nombre", view).value || "").trim();
    if (!q) { toast("Escribe la comuna primero", "err"); return; }
    geoBtn.disabled = true; geoBtn.textContent = "Buscando...";
    try {
      const r = await geocode(q);
      if (!r) { toast("Sin resultados para “" + q + "”", "err"); }
      else { $("#ff-lat", view).value = Math.round(r.lat * 1e6) / 1e6; $("#ff-lng", view).value = Math.round(r.lng * 1e6) / 1e6; toast("Coordenadas de " + r.nombre, "ok"); }
    } catch (e) { toast("No se pudo buscar: " + (e.message || e), "err"); }
    geoBtn.disabled = false; geoBtn.innerHTML = I.pin + "Buscar por comuna";
  };
  const gpsBtn = $("#ff-gps", view);
  if (gpsBtn) gpsBtn.onclick = () => {
    gpsBtn.disabled = true; gpsBtn.textContent = "Ubicando...";
    captureGPS((g, err) => {
      if (g) { $("#ff-lat", view).value = Math.round(g.lat * 1e6) / 1e6; $("#ff-lng", view).value = Math.round(g.lng * 1e6) / 1e6; toast("Ubicación capturada", "ok"); }
      else { toast(err === "denegado" ? "Permiso de ubicación denegado" : "No se pudo obtener el GPS", "err"); }
      gpsBtn.disabled = false; gpsBtn.innerHTML = I.pin + "Usar mi ubicación";
    });
  };
  $("#ff-save", view).onclick = async () => {
    const g = i => { const el = $(i, view); return el ? el.value : ""; };
    const parseCoord = v => { const n = Number(String(v).trim()); return isFinite(n) && String(v).trim() !== "" ? n : null; };
    const rec = {
      nombre: g("#ff-nombre").trim(), ubicacion: g("#ff-ubi").trim(), comuna: g("#ff-comuna").trim(),
      lat: parseCoord(g("#ff-lat")), lng: parseCoord(g("#ff-lng")),
      tipoMadera: g("#ff-mad").trim(), unidad: g("#ff-unidad") || "M3", destino: g("#ff-dest").trim(),
      distancia: Number(g("#ff-dist")) || 0, tiempoCiclo: Number(g("#ff-ciclo")) || 0, capacidadDia: Number(g("#ff-cap")) || 0, objetivoDia: Number(g("#ff-obj")) || 0,
      estadoAcceso: d.estadoAcceso, restricciones: g("#ff-restr").trim(), activa: true,
      clima: f.clima || null, createdAt: f.createdAt || Date.now()
    };
    if (!rec.nombre) { toast("Indica el nombre de la faena", "err"); return; }
    const btn = $("#ff-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.saveFaena(id || null, rec); toast("Faena guardada", "ok"); ctx.go("faenas", {}); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar faena"; }
  };
}
