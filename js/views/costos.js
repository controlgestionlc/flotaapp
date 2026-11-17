import { store } from "../store.js";
import { can } from "../permissions.js";
import { I, esc, fmtCLP, fmtDate, iconSpan, emptyBox, toast, $, $$ } from "../ui.js";

// Catálogo de sistemas (mismo que en la orden de taller).
const SIS = [["motor", "Motor"], ["transmision", "Transmisión"], ["frenos", "Frenos"], ["neumaticos", "Neumáticos"],
  ["suspension", "Suspensión"], ["direccion", "Dirección"], ["electrico", "Eléctrico"], ["hidraulico", "Hidráulico"],
  ["refrigeracion", "Refrigeración"], ["estructura", "Estructura / carro"], ["otros", "Otros"]];
const SIS_LABEL = {}; SIS.forEach(x => SIS_LABEL[x[0]] = x[1]);
const sisLabel = k => SIS_LABEL[k] || "Sin clasificar";
const tipoLabel = k => k === "correctiva" ? "Correctiva" : k === "preventiva" ? "Preventiva" : "Sin clasificar";
const nf = (n, d) => (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: d || 0 });
function oTotal(o) { return (o.movimientos || []).reduce((s, m) => s + (Number(m.total) || 0), 0) + (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0) + (Number(o.manoObra) || 0) + (Number(o.otrosGastos) || 0); }
function oCompras(o) { return (o.movimientos || []).reduce((s, m) => s + (Number(m.total) || 0), 0) + (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0); }
function sistemasDe(o) { return (o && o.sistemas && o.sistemas.length) ? o.sistemas : (o && o.sistema ? [o.sistema] : []); }

const PERIODS = [["m", "Este mes"], ["q", "3 meses"], ["y", "12 meses"], ["all", "Todo"]];
let period = "y";
function periodFrom(p) {
  const now = new Date();
  if (p === "all") return 0;
  if (p === "m") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (p === "q") return Date.now() - 90 * 86400000;
  return Date.now() - 365 * 86400000;
}
function kmTruck(fuel, truckId, from) {
  const list = fuel.filter(f => f.truckId === truckId && Number(f.km) > 0 && (!from || (f.fecha || f.ts || 0) >= from)).sort((a, b) => a.km - b.km);
  let km = 0;
  for (let i = 1; i < list.length; i++) { const d = list[i].km - list[i - 1].km; if (d > 0 && d < 200000) km += d; }
  return km;
}
function downtimeDays(o, now) {
  if (!o.fechaEntradaTaller) return 0;
  const end = o.fechaSalidaTaller || (o.estado === "en_taller" ? now : o.fechaEntradaTaller);
  const d = (end - o.fechaEntradaTaller) / 86400000;
  return d > 0 ? d : 0;
}

export async function renderCostos(view, ctx) {
  if (ctx.params.period) period = ctx.params.period;
  view.innerHTML = '<button class="backlink" id="co-back">' + I.back + ' Panel</button><div class="meta-line" style="padding:18px 2px">Calculando indicadores...</div>';
  $("#co-back", view).onclick = () => ctx.go("home", {});

  const [trucks, orders, fuel] = await Promise.all([
    store.listTrucksAll().catch(() => []), store.listOrders().catch(() => []), store.listFuel().catch(() => [])
  ]);
  const now = Date.now();
  const from = periodFrom(period);
  const periodDays = period === "all"
    ? Math.max(30, (now - (orders.concat(fuel).reduce((m, x) => Math.min(m, x.completedAt || x.createdAt || x.fecha || x.ts || now), now))) / 86400000)
    : Math.max(1, (now - from) / 86400000);
  const esCarro = t => t.tipo === "carro";
  const nombre = t => (t.num || t.patente || "?");

  const done = orders.filter(o => o.estado === "completado" && (o.completedAt || o.createdAt || 0) >= from);
  const enTaller = orders.filter(o => o.estado === "en_taller");
  const gastoTotal = done.reduce((s, o) => s + oTotal(o), 0);

  // Km de flota en el periodo (desde combustible).
  let kmFlota = 0; trucks.forEach(t => { if (!esCarro(t)) kmFlota += kmTruck(fuel, t.id, from); });
  const costoKmFlota = kmFlota > 0 ? gastoTotal / kmFlota : null;

  // Correctivo vs preventivo.
  const porTipo = { correctiva: 0, preventiva: 0, sin: 0 };
  done.forEach(o => { const k = o.tipoMant === "correctiva" ? "correctiva" : o.tipoMant === "preventiva" ? "preventiva" : "sin"; porTipo[k] += oTotal(o); });
  const baseCP = porTipo.correctiva + porTipo.preventiva;
  const pctCorrectivo = baseCP > 0 ? Math.round(porTipo.correctiva / baseCP * 100) : null;

  // Disponibilidad y días fuera de servicio.
  let diasFuera = 0;
  done.concat(enTaller).forEach(o => { if ((o.fechaEntradaTaller || 0) >= from || (o.estado === "en_taller" && o.fechaEntradaTaller)) diasFuera += downtimeDays(o, now); });
  const nEquipos = trucks.filter(t => t.activo !== false).length || 1;
  const disp = Math.max(0, Math.min(100, Math.round((1 - diasFuera / (nEquipos * periodDays)) * 100)));

  // Gasto por sistema.
  // Gasto por sistema: cada movimiento se atribuye a su propio sistema (trazabilidad
  // por factura). El resto (mano de obra, otros, compras sin sistema) va al sistema
  // único de la orden, o a "Sin asignar" si la orden tiene varios.
  const porSis = {};
  done.forEach(o => {
    const sisO = sistemasDe(o); const unico = sisO.length === 1 ? sisO[0] : "sin";
    (o.movimientos || []).forEach(m => { const k = m.sistema || unico; porSis[k] = (porSis[k] || 0) + (Number(m.total) || 0); });
    const resto = (Number(o.manoObra) || 0) + (Number(o.otrosGastos) || 0) + (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0);
    porSis[unico] = (porSis[unico] || 0) + resto;
  });
  const sisRows = Object.entries(porSis).sort((a, b) => b[1] - a[1]);
  const maxSis = sisRows.reduce((m, r) => Math.max(m, r[1]), 0) || 1;

  // Ranking talleres y proveedores.
  const porTaller = {}; done.forEach(o => { const k = (o.taller || "").trim() || "Sin taller"; porTaller[k] = (porTaller[k] || 0) + oTotal(o); });
  const tallerRows = Object.entries(porTaller).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const porProv = {}; done.forEach(o => (o.movimientos || []).forEach(m => { const k = (m.proveedor || "").trim(); if (k) porProv[k] = (porProv[k] || 0) + (Number(m.total) || 0); }));
  const provRows = Object.entries(porProv).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Por equipo (periodo) + acumulado (todo) para antigüedad.
  const yr = new Date().getFullYear();
  const doneAll = orders.filter(o => o.estado === "completado");
  const porEquipo = trucks.map(t => {
    const dP = done.filter(o => o.truckId === t.id);
    const gasto = dP.reduce((s, o) => s + oTotal(o), 0);
    const km = esCarro(t) ? 0 : kmTruck(fuel, t.id, from);
    const dias = done.concat(enTaller).filter(o => o.truckId === t.id).reduce((s, o) => s + ((o.fechaEntradaTaller || 0) >= from || o.estado === "en_taller" ? downtimeDays(o, now) : 0), 0);
    const corr = dP.filter(o => o.tipoMant === "correctiva").reduce((s, o) => s + oTotal(o), 0);
    const baseT = dP.filter(o => o.tipoMant).reduce((s, o) => s + oTotal(o), 0);
    const acum = doneAll.filter(o => o.truckId === t.id).reduce((s, o) => s + oTotal(o), 0);
    const antig = t.anio ? Math.max(0, yr - Number(t.anio)) : null;
    return { t, carro: esCarro(t), gasto, km, costoKm: km > 0 ? gasto / km : null, dias, pctCorr: baseT > 0 ? Math.round(corr / baseT * 100) : null, acum, antig, porAnio: (antig && antig > 0) ? acum / antig : null };
  }).filter(r => r.gasto > 0 || r.acum > 0 || r.dias > 0).sort((a, b) => b.gasto - a.gasto);
  const avgKm = (() => { const v = porEquipo.filter(r => r.costoKm != null).map(r => r.costoKm); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; })();
  const semKm = ck => (avgKm && ck != null) ? (ck > avgKm * 1.6 ? "crit" : ck > avgKm * 1.3 ? "warn" : "ok") : "";

  // Recurrencia: mismo sistema repetido en un equipo (histórico).
  const recMap = {};
  doneAll.forEach(o => { sistemasDe(o).forEach(sis => { const k = o.truckId + "|" + sis; recMap[k] = (recMap[k] || 0) + 1; }); });
  const rec = Object.entries(recMap).filter(([, n]) => n >= 2).map(([k, n]) => { const [tid, sis] = k.split("|"); const t = trucks.find(x => x.id === tid); return { equipo: t ? nombre(t) : "?", sis: sisLabel(sis), n }; }).sort((a, b) => b.n - a.n).slice(0, 8);

  // ---- Render ----
  const periodChips = PERIODS.map(p => '<button class="chip' + (period === p[0] ? " on" : "") + '" data-per="' + p[0] + '">' + p[1] + "</button>").join("");
  const kpi = (cls, val, lab, sub) => '<div class="kpi ' + cls + '"><span class="stripe"></span><div class="val num" style="font-size:1.35rem">' + val + '</div><div class="lab" style="margin-top:4px">' + lab + '</div>' + (sub ? '<div class="meta-line" style="font-size:.76rem;margin-top:4px">' + sub + "</div>" : "") + "</div>";
  const dispCls = disp >= 90 ? "g" : disp >= 75 ? "w" : "c";
  const corrCls = pctCorrectivo == null ? "a" : pctCorrectivo >= 70 ? "c" : pctCorrectivo >= 45 ? "w" : "g";

  const kpis = '<div class="kpis section">' +
    kpi("a", fmtCLP(gastoTotal), "Gasto de mantención", "en el período") +
    kpi(costoKmFlota == null ? "a" : "w", costoKmFlota == null ? "s/d" : fmtCLP(costoKmFlota) + "/km", "Costo por km", kmFlota > 0 ? nf(kmFlota) + " km recorridos" : "sin datos de km") +
    kpi(corrCls, pctCorrectivo == null ? "s/d" : pctCorrectivo + "% correctivo", "Correctivo vs preventivo", pctCorrectivo == null ? "falta clasificar" : (100 - pctCorrectivo) + "% preventivo") +
    kpi(dispCls, disp + "%", "Disponibilidad", nf(diasFuera, 1) + " días fuera de servicio") +
    "</div>";

  const bar = (lab, val, max, extra) => '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.86rem;margin-bottom:3px"><span>' + esc(lab) + (extra ? ' <span class="meta-line" style="font-size:.76rem">' + extra + "</span>" : "") + '</span><b class="num">' + fmtCLP(val) + '</b></div><div style="height:9px;background:var(--surface-2,#eee);border-radius:6px;overflow:hidden"><div style="height:100%;width:' + Math.max(3, Math.round(val / max * 100)) + '%;background:var(--accent);border-radius:6px"></div></div></div>';

  const sisCard = '<div class="section"><span class="eyebrow">Gasto por sistema</span><div class="card pad" style="margin-top:8px">' +
    (sisRows.length ? sisRows.map(([k, v]) => bar(sisLabel(k), v, maxSis)).join("") : emptyBox("Sin órdenes completadas en el período")) + "</div></div>";

  const tallerCard = '<div class="card pad"><span class="eyebrow" style="display:block;margin-bottom:10px">Talleres (mayor gasto)</span>' +
    (tallerRows.length ? tallerRows.map(([k, v]) => '<div class="row" style="padding:7px 0"><div class="rl"><div class="t" style="font-size:.92rem">' + esc(k) + "</div></div><b class='num'>" + fmtCLP(v) + "</b></div>").join("") : '<div class="meta-line" style="font-size:.84rem">Sin datos</div>') + "</div>";
  const provCard = '<div class="card pad"><span class="eyebrow" style="display:block;margin-bottom:10px">Proveedores (mayor gasto)</span>' +
    (provRows.length ? provRows.map(([k, v]) => '<div class="row" style="padding:7px 0"><div class="rl"><div class="t" style="font-size:.92rem">' + esc(k) + "</div></div><b class='num'>" + fmtCLP(v) + "</b></div>").join("") : '<div class="meta-line" style="font-size:.84rem">Registra proveedor en las compras para verlo aquí</div>') + "</div>";

  const eqRows = porEquipo.map(r =>
    "<tr><td><b>" + esc(nombre(r.t)) + "</b>" + (r.carro ? ' <span class="pill neutral" style="font-size:.66rem">carro</span>' : "") + "</td>" +
    '<td class="r">' + (r.antig != null ? r.antig + " a" : "—") + "</td>" +
    '<td class="r">' + (r.km ? nf(r.km) : "—") + "</td>" +
    '<td class="r">' + fmtCLP(r.gasto) + "</td>" +
    '<td class="r">' + (r.costoKm != null ? '<span class="pill ' + (semKm(r.costoKm) || "neutral") + '" style="font-size:.68rem">' + fmtCLP(r.costoKm) + "</span>" : "—") + "</td>" +
    '<td class="r">' + (r.dias ? nf(r.dias, 1) : "—") + "</td>" +
    '<td class="r">' + (r.pctCorr != null ? r.pctCorr + "%" : "—") + "</td>" +
    '<td class="r">' + fmtCLP(r.acum) + "</td>" +
    '<td class="r">' + (r.porAnio != null ? fmtCLP(r.porAnio) : "—") + "</td></tr>").join("");
  const eqCard = '<div class="section"><span class="eyebrow">Por equipo</span>' +
    '<div class="card" style="margin-top:8px;overflow-x:auto"><table class="cost-table" style="min-width:680px;font-size:.86rem"><thead><tr>' +
    '<th>Equipo</th><th class="r">Antig.</th><th class="r">Km</th><th class="r">Gasto</th><th class="r">$/km</th><th class="r">Días taller</th><th class="r">% corr.</th><th class="r">Acum.</th><th class="r">$/año</th></tr></thead><tbody>' +
    (eqRows || '<tr><td colspan="9" style="color:var(--muted);padding:12px">Sin datos de mantención en el período</td></tr>') + "</tbody></table></div>" +
    '<div class="meta-line" style="font-size:.76rem;margin-top:6px">$/km y $/año son señales para comparar equipos y evaluar reemplazo. Km desde las cargas de combustible; días de taller desde que se registran fechas de entrada y salida.</div></div>';

  const recCard = rec.length ? '<div class="section"><span class="eyebrow">Fallas recurrentes (mismo sistema, histórico)</span><div class="card" style="margin-top:8px">' +
    rec.map(r => '<div class="row" style="padding:9px 0"><span class="sev-stripe sev-media"></span><div class="rl"><div class="t" style="font-size:.92rem">' + esc(r.equipo) + " · " + esc(r.sis) + '</div></div><span class="pill warn">' + r.n + " veces</span></div>").join("") + "</div></div>" : "";

  view.innerHTML =
    '<button class="backlink" id="co-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Costos de mantención</h2></div>' +
    '<div class="chips section" id="co-period">' + periodChips + "</div>" +
    kpis + sisCard +
    '<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">' + tallerCard + provCard + "</div></div>" +
    eqCard + recCard +
    '<div class="section"><span class="eyebrow">Exportar para Excel</span>' +
    '<button class="btn btn-soft" id="co-exp-ord" style="margin-top:8px">' + I.doc + "Órdenes del período (CSV)</button>" +
    '<button class="btn btn-soft" id="co-exp-fac" style="margin-top:10px">' + I.doc + "Facturas / compras del período (CSV)</button>" +
    '<div class="meta-line" style="font-size:.76rem;margin-top:8px">Se descargan como CSV (separador punto y coma), listos para abrir y dinamizar en Excel por equipo, mes, sistema o proveedor.</div></div>';

  $("#co-back", view).onclick = () => ctx.go("home", {});
  $$("#co-period [data-per]", view).forEach(b => b.onclick = () => { period = b.getAttribute("data-per"); renderCostos(view, ctx); });
  $("#co-exp-ord", view).onclick = () => exportOrdenes(done, trucks);
  $("#co-exp-fac", view).onclick = () => exportFacturas(done, trucks);
}

// ---- Exportación CSV (delimitador ; y BOM para Excel es-CL) ----
function toCSV(rows) {
  return "﻿" + rows.map(r => r.map(c => { const s = String(c == null ? "" : c); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\r\n");
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
const mesKey = ts => { const d = new Date(ts || Date.now()); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const sd = ts => ts ? new Date(ts).toLocaleDateString("es-CL") : "";
const oTot = oTotal, oComp = oCompras;

function exportOrdenes(done, trucks) {
  const tm = id => (trucks.find(x => x.id === id) || {});
  const rows = [["Mes", "Fecha cierre", "OT", "Equipo", "Patente", "Tipo mantencion", "Sistema", "Taller", "Entrada taller", "Salida taller", "Dias taller", "Odometro km", "Compras y servicios", "Mano de obra", "Otros gastos", "Total"]];
  done.slice().sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0)).forEach(o => {
    const t = tm(o.truckId);
    const dias = (o.fechaEntradaTaller && o.fechaSalidaTaller) ? Math.round((o.fechaSalidaTaller - o.fechaEntradaTaller) / 86400000) : "";
    rows.push([mesKey(o.completedAt), sd(o.completedAt), o.otNumero || "", t.num || "", t.patente || "", tipoLabel(o.tipoMant), sistemasDe(o).map(sisLabel).join(" / "), o.taller || "",
      sd(o.fechaEntradaTaller), sd(o.fechaSalidaTaller), dias, o.odometro || "", oComp(o), Number(o.manoObra) || 0, Number(o.otrosGastos) || 0, oTot(o)]);
  });
  download("costos_mantencion_ordenes.csv", toCSV(rows));
}
function exportFacturas(done, trucks) {
  const tm = id => (trucks.find(x => x.id === id) || {});
  const rows = [["Mes", "Equipo", "Patente", "OT", "Sistema", "Proveedor", "Documento", "Tipo", "Descripcion", "Detalle", "Cantidad", "Precio unitario", "Total", "Fecha documento"]];
  done.forEach(o => { const t = tm(o.truckId); (o.movimientos || []).forEach(m => {
    rows.push([mesKey(o.completedAt), t.num || "", t.patente || "", o.otNumero || "", m.sistema ? sisLabel(m.sistema) : sistemasDe(o).map(sisLabel).join(" / "), m.proveedor || "", m.docto || "", m.tipo || "", m.descripcion || "", m.detalle || "", Number(m.cantidad) || 0, Number(m.precioUnit) || 0, Number(m.total) || 0, sd(m.fecha)]);
  }); });
  if (rows.length === 1) { toast("No hay compras con factura en el período", "err"); return; }
  download("costos_mantencion_facturas.csv", toCSV(rows));
}
