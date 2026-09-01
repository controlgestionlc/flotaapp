// =============================================================
//  Planificación de flota · utilidades de semana y disponibilidad
//  Funciones puras (no tocan el store): reciben los datos y
//  devuelven el resultado, igual que maintenance.js.
// =============================================================
import { docStatus } from "./ui.js";
import { DOC_TYPES } from "./checklist.js";
import { planStatus, truckKm } from "./maintenance.js";

export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const DIAS_LARGO = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const DAYMS = 86400000;

// Lunes 00:00 de la semana que contiene ts.
export function mondayOf(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

// Número de semana ISO-8601.
export function isoWeek(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // jueves de la semana
  const week1 = new Date(d.getFullYear(), 0, 4);
  const num = 1 + Math.round(((d - week1) / DAYMS - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { num, year: d.getFullYear() };
}

// Información completa de la semana de ts.
export function weekInfo(ts) {
  const inicio = mondayOf(ts);
  const fin = inicio + 6 * DAYMS;
  const { num, year } = isoWeek(inicio);
  const dias = Array.from({ length: 7 }, (_, i) => inicio + i * DAYMS);
  const key = year + "-W" + String(num).padStart(2, "0");
  return { key, num, year, inicio, fin, dias };
}

// Clave de día estable (para asignaciones): "2026-08-24".
export function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------------------------------------------------------------
//  Reservas de recepción en planta (eslabón de la secretaria)
// ---------------------------------------------------------------
// Cada asignación (camión/día/faena) tiene N viajes objetivo. Por cada vuelta
// la secretaria reserva un horario de recepción y una guía de despacho, además
// de la planta de destino de la asignación.
export function reservaResumen(asig) {
  const n = Number(asig && asig.viajesObjetivo) || 0;
  const r = (asig && asig.reservas) || [];
  const hechas = r.filter(x => x && x.horaRecepcion).length;
  const conPlanta = !!(asig && asig.plantaDestino);
  const completa = n > 0 && conPlanta && hechas >= n;
  return { n, hechas, conPlanta, completa, alguna: hechas > 0 || conPlanta };
}
// Guías reservadas por la secretaria para un camión en un día (Set de strings).
export function reservedGuias(plan, camionId, dk) {
  const set = new Set();
  ((plan && plan.asignaciones) || []).forEach(a => {
    if (a.camionId === camionId && a.fecha === dk) {
      (a.reservas || []).forEach(rv => { if (rv && rv.guia) set.add(String(rv.guia).trim()); });
    }
  });
  return set;
}
// ¿La guía que ingresó el chofer coincide con alguna reservada por la secretaria?
// Devuelve: "ok" si coincide, "dif" si hay reservas y no coincide, null si no hay
// guías reservadas con qué comparar.
export function estadoGuia(reservedSet, guia) {
  const g = String(guia || "").trim();
  if (!reservedSet || reservedSet.size === 0) return null;
  if (!g) return null;
  return reservedSet.has(g) ? "ok" : "dif";
}

// ---------------------------------------------------------------
//  Disponibilidad de recursos
// ---------------------------------------------------------------

// Disponibilidad de un camión: consulta estado, taller, documentación
// y mantención preventiva. Devuelve el mismo estado que el panel:
// k = operativo / observacion / fuera. ok = (k === "operativo").
export function truckAvailability(t, data, dayTs) {
  const orders = (data && data.orders) || [];
  const fuel = (data && data.fuel) || [];
  const fallas = (data && data.fallas) || [];
  const items = [];
  const fs = fallas.filter(f => f.truckId === t.id);
  const openO = orders.filter(o => o.truckId === t.id && o.estado !== "completado" && o.estado !== "descartada");
  const enTaller = openO.find(o => o.estado === "en_taller");
  const agendado = openO.find(o => o.estado === "agendado" || o.estado === "pendiente");
  const fallaAlta = fs.some(f => f.sev === "alta");

  // Estado principal (mismo criterio que el semáforo del panel).
  let k;
  if (t.activo === false) { items.push({ st: "bad", label: "Camión fuera de servicio" }); k = "fuera"; }
  else if (enTaller) { items.push({ st: "bad", label: "En taller" + (enTaller.otNumero ? " (" + enTaller.otNumero + ")" : "") }); k = "fuera"; }
  else if (fallaAlta) { items.push({ st: "bad", label: "Falla de severidad alta reportada" }); k = "fuera"; }
  else if (agendado || fs.length) { items.push({ st: "warn", label: agendado ? "Mantención programada" : (fs.length + " falla(s) reportada(s)") }); k = "observacion"; }
  else items.push({ st: "ok", label: "Camión operativo" });
  if (!k) k = "operativo";
  const ok = (k === "operativo");

  // Documentación
  let docVencido = null, docPorVencer = null;
  (DOC_TYPES || []).forEach(dt => {
    const vence = t.docs && t.docs[dt.k] && t.docs[dt.k].vence;
    const s = docStatus(vence);
    if (s.k === "vencido") docVencido = docVencido || dt.n;
    else if (s.k === "porvencer") docPorVencer = docPorVencer || dt.n;
  });
  (t.docs && t.docs.otros || []).forEach(o => {
    const s = docStatus(o.vence);
    if (s.k === "vencido") docVencido = docVencido || (o.nombre || "Documento");
  });
  // La documentación vencida es una ADVERTENCIA (no bloquea la disponibilidad):
  // el camión sigue asignable y el encargado decide, igual que en el panel.
  if (docVencido) items.push({ st: "warn", label: "Documentación vencida: " + docVencido });
  else if (docPorVencer) items.push({ st: "warn", label: "Documento por vencer: " + docPorVencer });
  else items.push({ st: "ok", label: "Documentación vigente" });

  // Mantención preventiva (aviso, no bloquea)
  const km = truckKm(fuel, t.id);
  let mantVenc = null;
  (t.mantenciones || []).forEach(pl => { const st = planStatus(pl, km); if (st.k === "vencida") mantVenc = mantVenc || pl.nombre; });
  if (mantVenc) items.push({ st: "warn", label: "Mantención preventiva vencida: " + mantVenc });

  return { ok, k, items };
}

// Deriva las fallas abiertas (checklist + bitácora, menos las ligadas a
// órdenes o descartadas). Mismo criterio que el panel, para disponibilidad.
export function deriveFallas(checklists, bitacora, orders, resolved) {
  const linked = new Set(); (orders || []).forEach(o => (o.sources || []).forEach(s => linked.add(s)));
  const res = new Set(resolved || []);
  const out = [];
  (checklists || []).forEach(c => (c.fails || []).forEach(f => {
    const id = "chk:" + c.id + ":" + f.k;
    if (!linked.has(id) && !res.has(id)) out.push({ id, truckId: c.truckId, sev: f.sev || "media", ts: c.ts });
  }));
  (bitacora || []).forEach(b => {
    if (b.tipo === "Falla mecánica" || b.tipo === "Incidente") {
      const id = "bit:" + b.id;
      if (!linked.has(id) && !res.has(id)) out.push({ id, truckId: b.truckId, sev: b.sev || "media", ts: b.ts });
    }
  });
  return out;
}

// "HH:MM" -> minutos. Devuelve null si no es válido.
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ¿Dos rangos de horario se solapan? Sin horario válido => se asume conflicto.
export function rangesOverlap(aIni, aFin, bIni, bFin) {
  const a1 = toMin(aIni), a2 = toMin(aFin), b1 = toMin(bIni), b2 = toMin(bFin);
  if (a1 == null || a2 == null || b1 == null || b2 == null) return true;
  return a1 < b2 && b1 < a2;
}

// ¿El horario del camión choca con otra asignación del mismo día?
export function truckTimeClash(plan, camionId, dTs, ini, fin, exceptAssignId) {
  const dk = dayKey(dTs);
  return (plan && plan.asignaciones || []).find(a =>
    a.camionId === camionId && a.fecha === dk && a.id !== exceptAssignId && a.faenaId &&
    rangesOverlap(ini, fin, a.turnoInicio, a.turnoFin));
}

// Disponibilidad del conductor: no puede estar en dos lugares a la vez.
// Choca si ese día tiene otra asignación cuyo horario se solapa.
export function driverAvailability(conductorId, plan, dTs, exceptAssignId, ini, fin) {
  const dk = dayKey(dTs);
  const items = [];
  let ok = true;
  const clash = (plan && plan.asignaciones || []).find(a =>
    a.conductorId === conductorId && a.fecha === dk && a.id !== exceptAssignId && a.faenaId &&
    rangesOverlap(ini, fin, a.turnoInicio, a.turnoFin));
  if (clash) { items.push({ st: "bad", label: "Conductor con otro viaje en ese horario" }); ok = false; }
  else items.push({ st: "ok", label: "Conductor disponible" });
  return { ok, items };
}

// Estado de acceso de una faena → color.
export function faenaAccess(f) {
  const k = (f && f.estadoAcceso) || "operativa";
  if (k === "cerrada") return { k, cls: "crit", label: "Cerrada" };
  if (k === "condicionada") return { k, cls: "warn", label: "Condicionada" };
  return { k: "operativa", cls: "ok", label: "Operativa" };
}

export const PLAN_ESTADOS = {
  borrador:     { l: "Borrador", c: "neutral" },
  planificado:  { l: "Planificado", c: "steel" },
  en_ejecucion: { l: "En ejecución", c: "warn" },
  modificado:   { l: "Modificado", c: "warn" },
  cerrado:      { l: "Cerrado", c: "ok" }
};

// ---------------------------------------------------------------
//  Clima (parámetros editables + evaluación de riesgo de acceso)
// ---------------------------------------------------------------

// Umbrales por defecto. El clima NUNCA cierra una faena solo:
// levanta un riesgo y el encargado confirma la condición.
export const CLIMA_PARAMS_DEFAULT = { lluvia24Max: 10, vientoMax: 50, probMax: 70 };

// Descripción del código WMO de Open-Meteo (resumido).
export function wmoDesc(code) {
  const c = Number(code);
  if (c === 0) return { t: "Despejado", e: "☀️" };
  if (c === 1 || c === 2) return { t: "Parcial", e: "🌤️" };
  if (c === 3) return { t: "Nublado", e: "☁️" };
  if (c >= 45 && c <= 48) return { t: "Niebla", e: "🌫️" };
  if (c >= 51 && c <= 57) return { t: "Llovizna", e: "🌦️" };
  if (c >= 61 && c <= 67) return { t: "Lluvia", e: "🌧️" };
  if (c >= 71 && c <= 77) return { t: "Nieve", e: "🌨️" };
  if (c >= 80 && c <= 82) return { t: "Chubascos", e: "🌧️" };
  if (c >= 95) return { t: "Tormenta", e: "⛈️" };
  return { t: "—", e: "🌡️" };
}

// Evalúa el riesgo de acceso a partir del clima y los parámetros.
// Devuelve una SUGERENCIA (normal / condicionada); nunca "cerrada".
export function evaluarAccesoClima(reading, params) {
  const p = Object.assign({}, CLIMA_PARAMS_DEFAULT, params || {});
  const motivos = [];
  if (reading) {
    if (reading.precip24 != null && reading.precip24 > p.lluvia24Max) motivos.push("Lluvia " + Math.round(reading.precip24) + " mm/24h (máx " + p.lluvia24Max + ")");
    if (reading.windKmh != null && reading.windKmh > p.vientoMax) motivos.push("Viento " + Math.round(reading.windKmh) + " km/h (máx " + p.vientoMax + ")");
    if (reading.probLluvia != null && reading.probLluvia > p.probMax) motivos.push("Prob. lluvia " + Math.round(reading.probLluvia) + "% (máx " + p.probMax + ")");
  }
  if (motivos.length) return { k: "condicionada", cls: "warn", label: "Condicionado", motivos };
  return { k: "normal", cls: "ok", label: "Normal", motivos: [] };
}

// ---------------------------------------------------------------
//  Motor de asignación automática (configurable)
// ---------------------------------------------------------------

export const AUTO_PARAMS_DEFAULT = { jornadaMin: 600, reservaMin: 1, criterio: "recomendada", capMR: 18, capM3: 20 };

// Capacidad de carga de un camión por viaje según la unidad de la faena.
export function capacidadViaje(unidad, params) {
  const p = Object.assign({}, AUTO_PARAMS_DEFAULT, params || {});
  return String(unidad).toUpperCase() === "MR" ? (Number(p.capMR) || 18) : (Number(p.capM3) || 20);
}

export const CRITERIOS = [
  { k: "recomendada", n: "Planificación recomendada", d: "Equilibra objetivos, reserva y accesibilidad." },
  { k: "produccion", n: "Maximizar producción", d: "Prioriza cumplir el objetivo de cada faena." },
  { k: "tiempos_muertos", n: "Minimizar tiempos muertos", d: "Solo los camiones necesarios; evita esperas." },
  { k: "utilizacion", n: "Maximizar utilización", d: "Usa todos los camiones disponibles." },
  { k: "reserva", n: "Mantener camión de reserva", d: "Deja al menos N camiones de respaldo." },
  { k: "equilibrio", n: "Equilibrar la flota", d: "Reparte la carga entre las faenas." }
];

// Viajes que alcanza un camión en la jornada según el tiempo de ciclo.
export function tripsPerTruck(jornadaMin, cicloMin) {
  const c = Number(cicloMin) || 0;
  if (!c) return 5;
  return Math.max(1, Math.floor((Number(jornadaMin) || 600) / c));
}

// Motor puro. trucks: [{id,num,available}], faenas: [{id,nombre,objetivoDia,tiempoCiclo,accesoK}]
// opts: { jornadaMin, reservaMin, criterio }. Devuelve propuesta + resumen + advertencias.
export function autoAssign(trucks, faenas, opts) {
  const o = Object.assign({}, AUTO_PARAMS_DEFAULT, opts || {});
  const avail = (trucks || []).filter(t => t.available);
  const N = avail.length;
  const usable = (faenas || []).filter(f => f.accesoK !== "cerrada" && Number(f.objetivoDia) > 0);

  const order = usable.slice();
  if (o.criterio === "recomendada") order.sort((a, b) => ((a.accesoK === "condicionada" ? 1 : 0) - (b.accesoK === "condicionada" ? 1 : 0)) || (b.objetivoDia - a.objetivoDia));
  else order.sort((a, b) => b.objetivoDia - a.objetivoDia);

  // Solo el criterio "reserva" retiene camiones antes de cubrir producción;
  // en los demás, primero se cumple el objetivo y lo que sobra queda de reserva.
  const reserveTarget = (o.criterio === "reserva") ? Math.max(0, Number(o.reservaMin) || 0) : 0;
  const cap = Math.max(0, N - reserveTarget);

  // Viajes máximos por camión en la faena: el menor entre lo que permite la
  // jornada/tiempo de ciclo y la capacidad diaria configurada (viajes/día).
  const effTpt = (f) => {
    const t = tripsPerTruck(o.jornadaMin, f.tiempoCiclo);
    const cap = Number(f.capacidadDia) || 0;
    return cap > 0 ? Math.min(t, cap) : t;
  };

  const req = {}, alloc = {};
  order.forEach(f => { req[f.id] = Math.max(1, Math.ceil(f.objetivoDia / effTpt(f))); alloc[f.id] = 0; });

  // Paso 1: cubrir lo requerido por faena (hasta cap).
  let used = 0;
  for (const f of order) { if (used >= cap) break; const need = Math.min(req[f.id], cap - used); alloc[f.id] += need; used += need; }

  // Paso 2: repartir camiones sobrantes (solo para maximizar utilización o equilibrar).
  if (o.criterio === "utilizacion" || o.criterio === "equilibrio") {
    let guard = 0;
    while (used < cap && guard++ < 100) {
      let placed = false;
      for (const f of order) {
        if (used >= cap) break;
        if (o.criterio === "utilizacion" || alloc[f.id] < req[f.id] * 2) { alloc[f.id]++; used++; placed = true; }
      }
      if (!placed) break;
    }
  }

  // Construir propuesta y repartir viajes entre los camiones de cada faena.
  // Cada viaje transporta la capacidad del camión (18 MR / 20 M3 según la faena).
  let ti = 0; const proposal = []; const resumen = [];
  for (const f of order) {
    const tpt = effTpt(f);
    const cap = capacidadViaje(f.unidad, o);
    const k = alloc[f.id]; let obj = f.objetivoDia; let vsum = 0;
    for (let i = 0; i < k && ti < avail.length; i++) {
      const truck = avail[ti++];
      const share = Math.max(0, Math.min(tpt, Math.ceil(obj / (k - i))));
      obj -= share; vsum += share;
      proposal.push({ camionId: truck.id, faenaId: f.id, viajes: share, volumen: share * cap, unidad: f.unidad || "M3", capViaje: cap });
    }
    resumen.push({ faenaId: f.id, nombre: f.nombre, trucks: k, viajes: vsum, volumen: vsum * cap, unidad: f.unidad || "M3", capViaje: cap, objetivo: f.objetivoDia, cumpl: f.objetivoDia ? Math.round(vsum / f.objetivoDia * 100) : 0, accesoK: f.accesoK });
  }
  const reserva = avail.slice(ti).map(t => t.id);

  const warnings = [];
  if (!reserva.length) warnings.push("Sin camión de reserva.");
  resumen.forEach(r => { if (r.cumpl < 100) warnings.push(r.nombre + " no alcanza el objetivo (" + r.cumpl + "%)."); });
  resumen.forEach(r => { if (r.accesoK === "condicionada") warnings.push(r.nombre + " tiene acceso condicionado."); });
  (faenas || []).forEach(f => { if (f.accesoK === "cerrada") warnings.push(f.nombre + " está cerrada: no se asignó."); });

  return { proposal, reserva, resumen, warnings, disponibles: N };
}

export const IMPREVISTO_TIPOS = [
  { k: "clima", n: "Clima" },
  { k: "camino", n: "Camino / acceso" },
  { k: "falla", n: "Falla camión" },
  { k: "ausencia", n: "Ausencia conductor" },
  { k: "faena", n: "Problema faena" },
  { k: "otro", n: "Otro" }
];
