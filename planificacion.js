import { store } from "./store.js";
import { can } from "./permissions.js";
import {
  I, esc, uid, fmtDate, fmtDateTime, fmtCLP, iconSpan, emptyBox,
  toast, openSheet, closeSheet, $, $$
} from "./ui.js";
import {
  DIAS, DIAS_LARGO, weekInfo, dayKey, truckAvailability, driverAvailability,
  faenaAccess, PLAN_ESTADOS, IMPREVISTO_TIPOS
} from "./planning.js";

// Timestamp dentro de la semana visualizada (se ajusta con la navegación).
let weekTs = null;
// Paleta estable para identificar faenas en la matriz.
const FA_COLORS = ["#2F6F5E", "#B4632A", "#3B5B92", "#7A5B99", "#8A7A2E", "#9A3B4E"];

export async function renderPlanificacion(view, ctx) {
  if (weekTs == null) weekTs = Date.now();
  const r = ctx.route;
  if (r === "faenas") return faenasScreen(view, ctx);
  if (r === "operacion") return operacionDia(view, ctx);
  if (r === "control") return controlScreen(view, ctx);
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
      const a = asigWeek.find(x => x.camionId === t.id && x.fecha === dk);
      if (a && a.faenaId) {
        const col = faColor(faenas, a.faenaId);
        return '<td><button class="pl-cell" data-cell="' + t.id + "|" + dk + '" style="border-left:3px solid ' + col + '">' +
          '<b style="color:' + col + '">' + esc(faName(faenas, a.faenaId)) + "</b>" +
          '<span class="num">' + (Number(a.viajesObjetivo) || 0) + " v.</span></button></td>";
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
    (plan.estado === "borrador" || plan._nuevo ? '<button class="btn btn-primary" id="pl-aprobar" style="flex:1;min-width:150px">' + I.check + "Aprobar programa</button>" : "") +
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
      (can(ctx.profile, "plan.manage") ? '<button class="btn sm btn-ghost" id="pl-faenas">' + I.pin + "Faenas</button>" : "") + "</div>" +
    kpis + acciones + matriz + alertsBlock + objetivo +
    '<p class="meta-line" style="font-size:.78rem;margin:14px 2px 4px">Camión, conductor, documentación y mantención se consultan desde el sistema; aquí solo se distribuyen los recursos.</p>';

  $("#pl-back", view).onclick = () => ctx.go("home", {});
  $("#pl-prev", view).onclick = () => { weekTs -= 7 * 86400000; renderPlanificacion(view, ctx); };
  $("#pl-next", view).onclick = () => { weekTs += 7 * 86400000; renderPlanificacion(view, ctx); };
  $("#pl-hoy", view).onclick = () => { weekTs = Date.now(); renderPlanificacion(view, ctx); };
  $("#pl-oper", view).onclick = () => ctx.go("operacion", {});
  $("#pl-ctrl", view).onclick = () => ctx.go("control", {});
  const bf = $("#pl-faenas", view); if (bf) bf.onclick = () => ctx.go("faenas", {});
  if (canEdit) {
    $$("[data-cell]", view).forEach(b => b.onclick = () => {
      const [camionId, dk] = b.getAttribute("data-cell").split("|");
      openAssignment(view, ctx, plan, refs, camionId, dk);
    });
    const ob = $("#pl-obj", view); if (ob) ob.onclick = () => editObjetivo(view, ctx, plan);
    const ap = $("#pl-aprobar", view); if (ap) ap.onclick = () => aprobarPlan(view, ctx, plan);
    const rp = $("#pl-reprog", view); if (rp) rp.onclick = () => reprogramar(view, ctx, plan, refs);
  } else {
    $$("[data-cell]", view).forEach(b => b.onclick = () => verAssignment(ctx, plan, refs, b.getAttribute("data-cell")));
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

// -------- Ficha de asignación (crear / editar) --------
function openAssignment(view, ctx, plan, refs, camionId, dk) {
  const { trucks, faenas, conductores } = refs;
  const t = trucks.find(x => x.id === camionId) || { num: "?" };
  const dTs = new Date(dk + "T12:00:00").getTime();
  const existing = plan.asignaciones.find(a => a.camionId === camionId && a.fecha === dk);
  const d = existing
    ? Object.assign({}, existing)
    : { id: uid("as"), camionId, fecha: dk, conductorId: "", faenaId: "", turnoInicio: "07:00", turnoFin: "17:00", viajesObjetivo: "", volumenObjetivo: "", estado: "planificado" };

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

  openSheet(existing ? "Editar asignación" : "Nueva asignación", body, () => {
    const refreshDriver = () => {
      const cid = $("#as-cond").value;
      const el = $("#as-driver"); if (!el) return;
      if (!cid) { el.innerHTML = ""; return; }
      const da = driverAvailability(cid, plan, dTs, d.id);
      el.innerHTML = da.items.map(checkRow).join("");
    };
    $("#as-cond").onchange = refreshDriver;
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
      if (d.conductorId && !driverAvailability(d.conductorId, plan, dTs, d.id).ok) { toast("Ese conductor ya está asignado ese día", "err"); return; }
      // upsert
      const idx = plan.asignaciones.findIndex(a => a.id === d.id);
      if (idx >= 0) plan.asignaciones[idx] = d; else plan.asignaciones.push(d);
      if (plan.estado === "planificado") plan.estado = "modificado";
      try { await persistPlan(plan); closeSheet(); toast("Asignación guardada", "ok"); renderPlanificacion(view, ctx); }
      catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
    };
    const del = $("#as-del"); if (del) del.onclick = async () => {
      plan.asignaciones = plan.asignaciones.filter(a => a.id !== d.id);
      if (plan.estado === "planificado") plan.estado = "modificado";
      try { await persistPlan(plan); closeSheet(); toast("Asignación quitada", "ok"); renderPlanificacion(view, ctx); }
      catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
    };
  });
}

// Solo lectura (gerente).
function verAssignment(ctx, plan, refs, cellKey) {
  const [camionId, dk] = cellKey.split("|");
  const a = plan.asignaciones.find(x => x.camionId === camionId && x.fecha === dk);
  const { trucks, faenas, conductores } = refs;
  const t = trucks.find(x => x.id === camionId) || { num: "?" };
  if (!a || !a.faenaId) { toast("Día en reserva (sin asignación)", "ok"); return; }
  const co = conductores.find(c => c.uid === a.conductorId);
  openSheet("Asignación · " + t.num,
    '<div class="card pad" style="box-shadow:none;border-color:var(--line)">' +
    row2("Fecha", fmtDate(new Date(dk + "T12:00:00").getTime())) +
    row2("Camión", t.num + " · " + (t.patente || "")) +
    row2("Conductor", co ? co.nombre : "Sin asignar") +
    row2("Faena", faName(faenas, a.faenaId)) +
    row2("Viajes objetivo", String(a.viajesObjetivo || 0)) +
    row2("m³ objetivo", String(a.volumenObjetivo || 0)) +
    row2("Turno", (a.turnoInicio || "") + " ─ " + (a.turnoFin || "")) + "</div>", () => {});
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
    (canEdit ? '<button class="btn btn-steel" id="op-reprog" style="flex:1;min-width:150px">' + I.wrench + "Reprogramar</button>" : "") + "</div>";

  $("#op-back", view).onclick = () => ctx.go("planificacion", {});
  $("#op-imprev", view).onclick = () => reportarImprevisto(view, ctx, refs);
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
    nombre: f.nombre || "", ubicacion: f.ubicacion || "", comuna: f.comuna || "", tipoMadera: f.tipoMadera || "", destino: f.destino || "",
    distancia: f.distancia || "", tiempoCiclo: f.tiempoCiclo || "", capacidadDia: f.capacidadDia || "",
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
      '<div class="grid2"><label class="fld"><span class="lb">Tipo de madera</span><input class="input" id="ff-mad" value="' + esc(d.tipoMadera) + '"></label>' +
      '<label class="fld"><span class="lb">Destino</span><input class="input" id="ff-dest" value="' + esc(d.destino) + '"></label></div>' +
      '<div class="grid2"><label class="fld"><span class="lb">Distancia (km)</span><input class="input num" id="ff-dist" inputmode="numeric" value="' + esc(d.distancia) + '"></label>' +
      '<label class="fld"><span class="lb">Tiempo ciclo (min)</span><input class="input num" id="ff-ciclo" inputmode="numeric" value="' + esc(d.tiempoCiclo) + '"></label></div>' +
      '<label class="fld"><span class="lb">Capacidad (viajes/día)</span><input class="input num" id="ff-cap" inputmode="numeric" value="' + esc(d.capacidadDia) + '"></label>' +
      '<label class="fld"><span class="lb">Estado de acceso</span><div class="chips" id="ff-acc">' + accChip("operativa", "Operativa") + accChip("condicionada", "Condicionada") + accChip("cerrada", "Cerrada") + "</div></label>" +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Restricciones / observación</span><textarea class="input" id="ff-restr" placeholder="Ej: camino de tierra, intransitable con lluvia">' + esc(d.restricciones) + "</textarea></label>" +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="ff-save">' + I.check + "Guardar faena</button></div>";
  $("#ff-back", view).onclick = () => ctx.go("faenas", {});
  $$("#ff-acc [data-acc]", view).forEach(b => b.onclick = () => { d.estadoAcceso = b.getAttribute("data-acc"); $$("#ff-acc [data-acc]", view).forEach(x => x.classList.remove("on")); b.classList.add("on"); });
  $("#ff-save", view).onclick = async () => {
    const g = i => { const el = $(i, view); return el ? el.value : ""; };
    const rec = {
      nombre: g("#ff-nombre").trim(), ubicacion: g("#ff-ubi").trim(), comuna: g("#ff-comuna").trim(), tipoMadera: g("#ff-mad").trim(), destino: g("#ff-dest").trim(),
      distancia: Number(g("#ff-dist")) || 0, tiempoCiclo: Number(g("#ff-ciclo")) || 0, capacidadDia: Number(g("#ff-cap")) || 0,
      estadoAcceso: d.estadoAcceso, restricciones: g("#ff-restr").trim(), activa: true,
      createdAt: f.createdAt || Date.now()
    };
    if (!rec.nombre) { toast("Indica el nombre de la faena", "err"); return; }
    const btn = $("#ff-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try { await store.saveFaena(id || null, rec); toast("Faena guardada", "ok"); ctx.go("faenas", {}); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar faena"; }
  };
}
