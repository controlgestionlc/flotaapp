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
//  Disponibilidad de recursos
// ---------------------------------------------------------------

// Disponibilidad de un camión: consulta estado, taller, documentación
// y mantención preventiva. NO decide por el usuario, solo informa.
export function truckAvailability(t, data, dayTs) {
  const orders = (data && data.orders) || [];
  const fuel = (data && data.fuel) || [];
  const items = [];
  let ok = true;

  if (t.activo === false) { items.push({ st: "bad", label: "Camión fuera de servicio" }); ok = false; }
  else items.push({ st: "ok", label: "Camión operativo" });

  const openO = orders.filter(o => o.truckId === t.id && o.estado !== "completado" && o.estado !== "descartada");
  const enTaller = openO.find(o => o.estado === "en_taller");
  const agendado = openO.find(o => o.estado === "agendado" || o.estado === "pendiente");
  if (enTaller) { items.push({ st: "bad", label: "En taller" + (enTaller.otNumero ? " (" + enTaller.otNumero + ")" : "") }); ok = false; }
  else if (agendado) items.push({ st: "warn", label: "Mantención programada" + (agendado.fechaAgendada ? " " + dayKey(agendado.fechaAgendada) : "") });
  else items.push({ st: "ok", label: "Sin mantención en taller" });

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
  if (docVencido) { items.push({ st: "bad", label: "Documentación vencida: " + docVencido }); ok = false; }
  else if (docPorVencer) items.push({ st: "warn", label: "Documento por vencer: " + docPorVencer });
  else items.push({ st: "ok", label: "Documentación vigente" });

  // Mantención preventiva (aviso, no bloquea)
  const km = truckKm(fuel, t.id);
  let mantVenc = null;
  (t.mantenciones || []).forEach(pl => { const st = planStatus(pl, km); if (st.k === "vencida") mantVenc = mantVenc || pl.nombre; });
  if (mantVenc) items.push({ st: "warn", label: "Mantención preventiva vencida: " + mantVenc });

  return { ok, items };
}

// Disponibilidad de un conductor: ¿ya está asignado ese día a otro camión?
export function driverAvailability(conductorId, plan, dTs, exceptAssignId) {
  const dk = dayKey(dTs);
  const items = [];
  let ok = true;
  const clash = (plan && plan.asignaciones || []).find(a =>
    a.conductorId === conductorId && a.fecha === dk && a.id !== exceptAssignId && a.faenaId);
  if (clash) { items.push({ st: "bad", label: "Conductor ya asignado ese día a otro camión" }); ok = false; }
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

export const IMPREVISTO_TIPOS = [
  { k: "clima", n: "Clima" },
  { k: "camino", n: "Camino / acceso" },
  { k: "falla", n: "Falla camión" },
  { k: "ausencia", n: "Ausencia conductor" },
  { k: "faena", n: "Problema faena" },
  { k: "otro", n: "Otro" }
];
