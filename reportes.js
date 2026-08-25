import { store } from "./store.js";
import { I, esc, fmtCLP, fmtDate, fmtDateTime, monthKey, iconSpan, emptyBox, toast, $, $$ } from "./ui.js";

export async function renderReportes(view, ctx) {
  view.innerHTML = '<button class="backlink" id="rp-back">' + I.back + ' Panel</button><div class="meta-line" style="padding:20px 2px">Cargando indicadores...</div>';
  const back = $("#rp-back", view); if (back) back.onclick = () => ctx.go("home", {});

  const [trucks, fuel, trips] = await Promise.all([store.listTrucks(), store.listFuel(), store.listTrips()]);
  const mk = monthKey();

  // ---- combustible ----
  const fuelMes = fuel.filter(f => monthKey(f.fecha || f.ts) === mk);
  const litrosMes = fuelMes.reduce((s, f) => s + (Number(f.litros) || 0), 0);
  const gastoMes = fuelMes.reduce((s, f) => s + (Number(f.total) || 0), 0);
  const precioProm = litrosMes > 0 ? gastoMes / litrosMes : 0;
  const stats = trucks.map(t => ({ t, s: truckFuelStats(t.id, fuel) }));
  const conRend = stats.filter(x => x.s.rend);
  const rendProm = conRend.length ? conRend.reduce((s, x) => s + x.s.rend, 0) / conRend.length : 0;

  const fuelKpis = '<div class="kpis section">' +
    kpi("a", fmtCLP(gastoMes), "Gasto combustible", "mes en curso") +
    kpi("a", nf(litrosMes) + " L", "Litros del mes", "cargados") +
    kpi("a", precioProm ? fmtCLP(precioProm) : "-", "Precio promedio", "por litro (mes)") +
    kpi(rendProm ? "g" : "a", rendProm ? nf(rendProm, 2) : "-", "Rendimiento", "promedio km/L") +
    "</div>";

  const fuelRows = stats.map(({ t, s }) => {
    const al = fuelAlert(s);
    return '<div class="row"><span class="trucknum">' + esc(t.num) + "</span><div class='rl'>" +
      '<div class="t">' + esc(t.marca + " " + (t.modelo || "")) + (al ? ' <span class="pill ' + al.cls + '">' + al.label + "</span>" : "") + "</div>" +
      '<div class="m"><span>Rend: <b class="num" style="color:var(--ink)">' + (s.rend ? nf(s.rend, 2) + " km/L" : "s/d") + "</b></span>" +
      '<span>$/km: <b class="num" style="color:var(--ink)">' + (s.costoKm ? fmtCLP(s.costoKm) : "s/d") + "</b></span>" +
      "</div></div></div>";
  }).join("");
  const fuelList = fuel.slice(0, 6).map(f => {
    const t = trucks.find(x => x.id === f.truckId) || { num: "?" };
    return '<div class="row"><div class="rl"><div class="t">' + iconSpan("fuel") + esc(t.num) + " · " + nf(f.litros) + " L · " + fmtCLP(f.total) + "</div>" +
      '<div class="m"><span>' + esc(f.estacion || "") + "</span><span class='num'>" + nf(f.km) + " km</span><span>" + fmtDate(f.fecha || f.ts) + "</span></div></div></div>";
  }).join("");

  // ---- viajes ----
  const tripsMes = trips.filter(v => monthKey(v.salida || v.ts) === mk);
  const m3Mes = tripsMes.filter(v => v.unidad === "M3").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const mrMes = tripsMes.filter(v => v.unidad === "MR").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const tripKpis = '<div class="kpis section">' +
    kpi("a", String(tripsMes.length), "Viajes del mes", "registrados") +
    kpi("a", nf(m3Mes) + " M3", "Volumen M3", "transportado (mes)") +
    kpi("a", nf(mrMes) + " MR", "Volumen MR", "transportado (mes)") +
    kpi("a", String(new Set(tripsMes.map(v => v.plantaDestino).filter(Boolean)).size), "Plantas destino", "distintas (mes)") +
    "</div>";
  const tripList = trips.slice(0, 6).map(v => {
    const t = trucks.find(x => x.id === v.truckId) || { num: "?" };
    return '<div class="row"><div class="rl"><div class="t">' + iconSpan("route") + esc(t.num) + " · " + esc(v.predio || v.origen || "") + " → " + esc(v.plantaDestino || "") + "</div>" +
      '<div class="m"><span class="num">' + nf(v.volumen) + " " + esc(v.unidad || "") + "</span>" + (v.guiaDespacho ? "<span>" + esc(v.guiaDespacho) + "</span>" : "") + "<span>" + fmtDateTime(v.salida || v.ts) + "</span></div></div></div>";
  }).join("");

  view.innerHTML =
    '<button class="backlink" id="rp-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Indicadores</h2><span class="meta-line">' + mesNombre() + "</span></div>" +

    '<div class="section"><div class="subhead"><h2 style="font-size:1.1rem">Combustible</h2>' +
      '<button class="btn sm btn-soft" id="exp-fuel">' + I.download + "CSV</button></div>" +
      fuelKpis +
      '<span class="eyebrow" style="display:block;margin:4px 2px 8px">Rendimiento por camión</span>' +
      '<div class="card">' + (fuelRows || emptyBox("Sin cargas registradas")) + "</div>" +
      (fuelList ? '<span class="eyebrow" style="display:block;margin:16px 2px 8px">Últimas cargas</span><div class="card">' + fuelList + "</div>" : "") +
    "</div>" +

    '<div class="section"><div class="subhead"><h2 style="font-size:1.1rem">Viajes</h2>' +
      '<button class="btn sm btn-soft" id="exp-trips">' + I.download + "CSV</button></div>" +
      tripKpis +
      (tripList ? '<span class="eyebrow" style="display:block;margin:4px 2px 8px">Últimos viajes</span><div class="card">' + tripList + "</div>" : emptyBox("Sin viajes registrados")) +
    "</div>" +
    '<p class="meta-line" style="font-size:.78rem;padding:0 2px">El rendimiento se calcula con el método de estanque lleno (km entre cargas dividido por los litros de la carga). La alerta marca desviaciones fuertes respecto al promedio del camión.</p>';

  $("#rp-back", view).onclick = () => ctx.go("home", {});
  $("#exp-fuel", view).onclick = () => exportFuel(fuel, trucks);
  $("#exp-trips", view).onclick = () => exportTrips(trips, trucks);
}

function kpi(cls, val, lab, sub) {
  return '<div class="kpi ' + cls + '"><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num" style="font-size:1.5rem">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";
}
function nf(n, dec) { return (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: dec || 0, minimumFractionDigits: dec ? dec : 0 }); }
function mesNombre() { const d = new Date(); return d.toLocaleDateString("es-CL", { month: "long", year: "numeric" }); }

// Rendimiento y costo por km, método estanque lleno.
function truckFuelStats(truckId, fuel) {
  const list = fuel.filter(f => f.truckId === truckId && f.km > 0).sort((a, b) => a.km - b.km);
  const out = { rend: null, costoKm: null, kmRec: 0, litros: 0, gasto: 0, rends: [], last: list[list.length - 1] || null };
  if (list.length < 2) return out;
  for (let i = 1; i < list.length; i++) {
    const dk = list[i].km - list[i - 1].km, lt = Number(list[i].litros) || 0;
    if (dk > 0 && lt > 0) { out.rends.push({ km: list[i].km, rend: dk / lt, fecha: list[i].fecha }); out.kmRec += dk; out.litros += lt; }
  }
  list.forEach(f => out.gasto += Number(f.total) || 0);
  out.rend = out.litros > 0 ? out.kmRec / out.litros : null;
  out.costoKm = out.kmRec > 0 ? out.gasto / out.kmRec : null;
  return out;
}
function fuelAlert(s) {
  if (!s.rends || s.rends.length < 2 || !s.rend) return null;
  const last = s.rends[s.rends.length - 1].rend;
  if (last < s.rend * 0.75) return { cls: "crit", label: "Consumo alto" };
  if (last > s.rend * 1.25) return { cls: "warn", label: "Revisar dato" };
  return null;
}

// ---- exportación CSV (delimitador ; y BOM para Excel es-CL) ----
function toCSV(rows) {
  return "﻿" + rows.map(r => r.map(c => {
    const s = String(c == null ? "" : c);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(";")).join("\r\n");
}
function download(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
  } catch (e) { toast("No se pudo exportar en este dispositivo", "err"); }
}
function csvDate(ts) { return ts ? new Date(ts).toLocaleString("es-CL") : ""; }
function exportFuel(fuel, trucks) {
  const tm = id => (trucks.find(x => x.id === id) || {});
  const rows = [["Fecha", "Camion", "Patente", "Conductor", "Km", "Litros", "PrecioLitro", "Total", "Estacion"]];
  fuel.forEach(f => { const t = tm(f.truckId); rows.push([csvDate(f.fecha || f.ts), t.num || "", t.patente || "", f.driverNombre || "", f.km || "", f.litros || "", f.precioLitro || "", f.total || "", f.estacion || ""]); });
  download("combustible.csv", toCSV(rows));
  toast("Exportado combustible.csv", "ok");
}
function exportTrips(trips, trucks) {
  const tm = id => (trucks.find(x => x.id === id) || {});
  const rows = [["Salida", "Llegada", "Camion", "Patente", "Conductor", "Origen", "Predio", "PlantaDestino", "Volumen", "Unidad", "GuiaDespacho", "GMM"]];
  trips.forEach(v => { const t = tm(v.truckId); rows.push([csvDate(v.salida), csvDate(v.llegada), t.num || "", t.patente || "", v.driverNombre || "", v.origen || "", v.predio || "", v.plantaDestino || "", v.volumen || "", v.unidad || "", v.guiaDespacho || "", v.gmm || ""]); });
  download("viajes.csv", toCSV(rows));
  toast("Exportado viajes.csv", "ok");
}
