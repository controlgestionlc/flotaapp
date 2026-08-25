import { store } from "./store.js";
import { I, esc, fmtCLP, fmtDate, fmtDateTime, dInput, iconSpan, emptyBox, toast, openSheet, closeSheet, $, $$ } from "./ui.js";

export async function renderReportes(view, ctx) {
  view.innerHTML = '<button class="backlink" id="rp-back">' + I.back + ' Panel</button><div class="meta-line" style="padding:20px 2px">Cargando indicadores...</div>';
  const b0 = $("#rp-back", view); if (b0) b0.onclick = () => ctx.go("home", {});

  const [trucks, fuel, trips, orders] = await Promise.all([store.listTrucks(), store.listFuel(), store.listTrips(), store.listOrders()]);
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const range = { desde: dInput(firstOfMonth), hasta: dInput(today.getTime()) };

  function inRange(ts) {
    if (!ts) return false;
    const d = new Date(range.desde + "T00:00:00").getTime();
    const h = new Date(range.hasta + "T23:59:59").getTime();
    return ts >= d && ts <= h;
  }

  const normPat = p => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const filter = { truck: "", driver: "" };
  // Opciones de camión: registrados + patentes de viajes importados sin registrar.
  const regTrucks = trucks.slice().sort((a, b) => (a.num || "").localeCompare(b.num || ""));
  const regPats = new Set(trucks.map(t => normPat(t.patente)));
  const extraPats = Array.from(new Set(trips.map(v => normPat(v.patente)).filter(pn => pn && !regPats.has(pn))));
  const drivers = Array.from(new Set([].concat(fuel, trips).map(r => r.driverNombre).filter(Boolean))).sort();

  function truckMatch(rec, isTrip) {
    if (!filter.truck) return true;
    if (filter.truck.indexOf("pat:") === 0) return isTrip && normPat(rec.patente) === filter.truck.slice(4);
    if (rec.truckId === filter.truck) return true;
    if (isTrip) { const tr = trucks.find(x => x.id === filter.truck); if (tr && normPat(rec.patente) === normPat(tr.patente)) return true; }
    return false;
  }
  const driverMatch = rec => !filter.driver || (rec.driverNombre || "") === filter.driver;

  function paint() {
    const fuelR = fuel.filter(f => inRange(f.fecha || f.ts) && truckMatch(f, false) && driverMatch(f));
    const tripsR = trips.filter(v => inRange(v.salida || v.ts) && truckMatch(v, true) && driverMatch(v));

    const litros = fuelR.reduce((s, f) => s + (Number(f.litros) || 0), 0);
    const gasto = fuelR.reduce((s, f) => s + (Number(f.total) || 0), 0);
    const precioProm = litros > 0 ? gasto / litros : 0;
    const statsTrucks = (filter.truck && filter.truck.indexOf("pat:") !== 0) ? trucks.filter(t => t.id === filter.truck) : trucks;
    const stats = statsTrucks.map(t => ({ t, s: truckFuelStats(t.id, fuelR) }));
    const conRend = stats.filter(x => x.s.rend);
    const rendProm = conRend.length ? conRend.reduce((s, x) => s + x.s.rend, 0) / conRend.length : 0;

    const fuelKpis = '<div class="kpis section">' +
      kpi("a", fmtCLP(gasto), "Gasto combustible", "en el período", "gasto") +
      kpi("a", nf(litros) + " L", "Litros", "cargados", "litros") +
      kpi("a", precioProm ? fmtCLP(precioProm) : "-", "Precio promedio", "por litro", "precio") +
      kpi(rendProm ? "g" : "a", rendProm ? nf(rendProm, 2) : "-", "Rendimiento", "promedio km/L", "rend") +
      "</div>";
    const fuelRows = stats.map(({ t, s }) => {
      const al = fuelAlert(s);
      return '<div class="row"><span class="trucknum">' + esc(t.num) + "</span><div class='rl'>" +
        '<div class="t">' + esc(t.marca + " " + (t.modelo || "")) + (al ? ' <span class="pill ' + al.cls + '">' + al.label + "</span>" : "") + "</div>" +
        '<div class="m"><span>Rend: <b class="num" style="color:var(--ink)">' + (s.rend ? nf(s.rend, 2) + " km/L" : "s/d") + "</b></span>" +
        '<span>$/km: <b class="num" style="color:var(--ink)">' + (s.costoKm ? fmtCLP(s.costoKm) : "s/d") + "</b></span></div></div></div>";
    }).join("");
    const fuelList = fuelR.slice().sort((a, b) => (b.fecha || b.ts) - (a.fecha || a.ts)).slice(0, 6).map(f => {
      const t = trucks.find(x => x.id === f.truckId) || { num: "?" };
      return '<div class="row"><div class="rl"><div class="t">' + iconSpan("fuel") + esc(t.num) + " · " + nf(f.litros) + " L · " + fmtCLP(f.total) + "</div>" +
        '<div class="m"><span>' + esc(f.estacion || "") + "</span><span class='num'>" + nf(f.km) + " km</span><span>" + fmtDate(f.fecha || f.ts) + "</span></div></div></div>";
    }).join("");

    const m3 = tripsR.filter(v => v.unidad === "M3").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
    const mr = tripsR.filter(v => v.unidad === "MR").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
    const esperas = tripsR.filter(v => v.tiempoEspera > 0).map(v => v.tiempoEspera);
    const esperaProm = esperas.length ? esperas.reduce((s, x) => s + x, 0) / esperas.length : 0;
    const tripKpis = '<div class="kpis section">' +
      kpi("a", String(tripsR.length), "Viajes", "en el período", "viajes") +
      kpi("a", nf(m3) + " M3", "Volumen M3", "transportado", "m3") +
      kpi("a", nf(mr) + " MR", "Volumen MR", "transportado", "mr") +
      kpi("a", String(new Set(tripsR.map(v => v.plantaDestino).filter(Boolean)).size), "Plantas destino", "distintas", "plantas") +
      kpi(esperaProm ? "w" : "a", esperaProm ? fmtDur(esperaProm) : "-", "Espera prom.", "en planta", "espera") +
      "</div>";
    const tripList = tripsR.slice().sort((a, b) => (b.salida || b.ts) - (a.salida || a.ts)).slice(0, 6).map(v => {
      const t = trucks.find(x => x.id === v.truckId) || { num: v.patente || "?" };
      return '<div class="row"><div class="rl"><div class="t">' + iconSpan("route") + esc(t.num) + " · " + esc(v.predio || v.origen || "") + " → " + esc(v.plantaDestino || "(sin cerrar)") + (v.estado !== "cerrado" ? ' <span class="pill warn">Abierto</span>' : "") + "</div>" +
        '<div class="m"><span class="num">' + nf(v.volumen) + " " + esc(v.unidad || "") + "</span>" + (v.producto ? "<span>" + esc(v.producto.descripcion) + "</span>" : "") + (v.guiaDespacho ? "<span>" + esc(v.guiaDespacho) + "</span>" : "") + "<span>" + fmtDateTime(v.salida || v.ts) + "</span></div></div></div>";
    }).join("");

    const truckOptions = '<option value="">Todos los camiones</option>' +
      regTrucks.map(t => '<option value="' + t.id + '"' + (filter.truck === t.id ? " selected" : "") + ">" + esc(t.num + " · " + t.patente) + "</option>").join("") +
      extraPats.map(pn => '<option value="pat:' + pn + '"' + (filter.truck === "pat:" + pn ? " selected" : "") + ">" + esc(pn) + " (sin registrar)</option>").join("");
    const driverOptions = '<option value="">Todos los conductores</option>' +
      drivers.map(d => "<option" + (filter.driver === d ? " selected" : "") + ' value="' + esc(d) + '">' + esc(d) + "</option>").join("");
    const filtro = '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:8px">Filtros</span>' +
      '<div class="grid2"><label class="fld" style="margin:0"><span class="lb">Desde</span><input class="input" type="date" id="rp-desde" value="' + esc(range.desde) + '"></label>' +
      '<label class="fld" style="margin:0"><span class="lb">Hasta</span><input class="input" type="date" id="rp-hasta" value="' + esc(range.hasta) + '"></label></div>' +
      '<label class="fld" style="margin:12px 0 0"><span class="lb">Camión</span><select class="input" id="rp-truck">' + truckOptions + "</select></label>" +
      (drivers.length > 1 ? '<label class="fld" style="margin:12px 0 0"><span class="lb">Conductor</span><select class="input" id="rp-driver">' + driverOptions + "</select></label>" : "") +
      "</div>";

    const avgArr = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    const byPlanta = {};
    tripsR.forEach(v => { if (!v.plantaDestino) return; const k = v.plantaDestino; (byPlanta[k] = byPlanta[k] || { n: 0, esp: [], vol: 0 }); byPlanta[k].n++; byPlanta[k].vol += Number(v.volumen) || 0; if (v.tiempoEspera > 0) byPlanta[k].esp.push(v.tiempoEspera); });
    const plantaKeys = Object.keys(byPlanta).sort((a, b) => avgArr(byPlanta[b].esp) - avgArr(byPlanta[a].esp));
    const esperaPlantaSection = plantaKeys.length
      ? '<div class="section"><span class="eyebrow" style="display:block;margin:0 2px 8px">Espera por planta</span><div class="card">' +
        plantaKeys.map(name => { const pp = byPlanta[name], ep = avgArr(pp.esp);
          return '<div class="row"><div class="rl"><div class="t">' + esc(name) + '</div><div class="m"><span>' + pp.n + " viaje(s)</span>" + (ep ? '<span>Espera prom: <b style="color:var(--ink)">' + fmtDur(ep) + "</b></span>" : "<span>Sin datos de espera</span>") + "<span class='num'>vol " + nf(pp.vol) + "</span></div></div></div>"; }).join("") +
        "</div></div>"
      : "";

    view.innerHTML =
      '<button class="backlink" id="rp-back">' + I.back + " Panel</button>" +
      '<div class="subhead"><h2>Indicadores</h2></div>' +
      filtro +
      '<div class="section"><div class="subhead"><h2 style="font-size:1.1rem">Combustible</h2><button class="btn sm btn-soft" id="exp-fuel">' + I.download + "CSV</button></div>" +
        fuelKpis +
        '<span class="eyebrow" style="display:block;margin:4px 2px 8px">Rendimiento por camión</span><div class="card">' + (fuelRows || emptyBox("Sin cargas en el período")) + "</div>" +
        (fuelList ? '<span class="eyebrow" style="display:block;margin:16px 2px 8px">Últimas cargas</span><div class="card">' + fuelList + "</div>" : "") +
      "</div>" +
      '<div class="section"><div class="subhead"><h2 style="font-size:1.1rem">Viajes</h2><button class="btn sm btn-soft" id="exp-trips">' + I.download + "CSV</button></div>" +
        tripKpis +
        (tripList ? '<span class="eyebrow" style="display:block;margin:4px 2px 8px">Últimos viajes</span><div class="card">' + tripList + "</div>" : emptyBox("Sin viajes en el período")) +
      "</div>" +
      esperaPlantaSection +
      '<div class="section"><button class="btn btn-ghost" id="rp-reporte">' + I.doc + "Generar reporte del período</button></div>" +
      '<p class="meta-line" style="font-size:.78rem;padding:0 2px">Rendimiento con método de estanque lleno (km entre cargas dividido por los litros de la carga). La alerta marca desviaciones fuertes respecto al promedio del camión.</p>';

    $("#rp-back", view).onclick = () => ctx.go("home", {});
    $("#rp-desde", view).onchange = e => { range.desde = e.target.value; paint(); };
    $("#rp-hasta", view).onchange = e => { range.hasta = e.target.value; paint(); };
    const tf = $("#rp-truck", view); if (tf) tf.onchange = e => { filter.truck = e.target.value; paint(); };
    const df = $("#rp-driver", view); if (df) df.onchange = e => { filter.driver = e.target.value; paint(); };
    $("#exp-fuel", view).onclick = () => exportFuel(fuelR, trucks);
    $("#exp-trips", view).onclick = () => exportTrips(tripsR, trucks);
    const rb = $("#rp-reporte", view); if (rb) rb.onclick = () => generarReporte(ctx, range, fuelR, tripsR, orders, trucks, stats);
    $$("[data-kpi]", view).forEach(b => b.onclick = () => kpiDetailRep(b.getAttribute("data-kpi")));

    function kpiDetailRep(k) {
      const fuelRow = f => { const t = trucks.find(x => x.id === f.truckId) || { num: "?" };
        return '<div class="row"><div class="rl"><div class="t">' + iconSpan("fuel") + esc(t.num) + " · " + nf(f.litros) + " L · " + fmtCLP(f.total) + '</div><div class="m"><span>' + esc(f.estacion || "") + "</span><span>$" + nf(f.precioLitro) + "/L</span><span class='num'>" + nf(f.km) + " km</span><span>" + fmtDate(f.fecha || f.ts) + "</span></div></div></div>"; };
      const tripRow = v => { const t = trucks.find(x => x.id === v.truckId) || { num: v.patente || "?" };
        return '<div class="row"><div class="rl"><div class="t">' + iconSpan("route") + esc(t.num) + " · " + esc(v.predio || v.origen || "") + " → " + esc(v.plantaDestino || "(sin cerrar)") + '</div><div class="m"><span class="num">' + nf(v.volumen) + " " + esc(v.unidad || "") + "</span>" + (v.producto ? "<span>" + esc(v.producto.descripcion) + "</span>" : "") + "<span>" + fmtDateTime(v.salida || v.ts) + "</span></div></div></div>"; };
      const fuelSorted = fuelR.slice().sort((a, b) => (b.fecha || b.ts) - (a.fecha || a.ts));
      const tripSorted = tripsR.slice().sort((a, b) => (b.salida || b.ts) - (a.salida || a.ts));
      let title = "", body = "";
      if (k === "gasto" || k === "litros" || k === "precio") {
        title = k === "gasto" ? "Gasto de combustible" : k === "litros" ? "Litros cargados" : "Precio por litro";
        body = (k === "precio" ? '<p class="meta-line" style="padding:0 2px 10px">Promedio ponderado: gasto total dividido por litros totales del período.</p>' : "") +
          (fuelSorted.length ? fuelSorted.map(fuelRow).join("") : '<div class="empty">' + I.fuel + "<div>Sin cargas en el período</div></div>");
      } else if (k === "rend") {
        title = "Rendimiento por camión";
        body = stats.map(({ t, s }) => '<div class="row"><span class="trucknum">' + esc(t.num) + '</span><div class="rl"><div class="t">' + esc(t.marca + " " + (t.modelo || "")) + '</div><div class="m"><span>Rend: ' + (s.rend ? nf(s.rend, 2) + " km/L" : "s/d") + "</span><span>$/km: " + (s.costoKm ? fmtCLP(s.costoKm) : "s/d") + "</span></div></div></div>").join("");
      } else if (k === "viajes") {
        title = "Viajes del período";
        body = tripSorted.length ? tripSorted.map(tripRow).join("") : '<div class="empty">' + I.route + "<div>Sin viajes</div></div>";
      } else if (k === "m3" || k === "mr") {
        const u = k.toUpperCase(); title = "Viajes en " + u;
        const list = tripSorted.filter(v => v.unidad === u);
        body = list.length ? list.map(tripRow).join("") : '<div class="empty">' + I.route + "<div>Sin viajes en " + u + "</div></div>";
      } else if (k === "plantas") {
        title = "Plantas destino";
        const map = {}; tripsR.forEach(v => { if (v.plantaDestino) { map[v.plantaDestino] = map[v.plantaDestino] || { n: 0, vol: 0 }; map[v.plantaDestino].n++; map[v.plantaDestino].vol += Number(v.volumen) || 0; } });
        const keys = Object.keys(map).sort((a, b) => map[b].n - map[a].n);
        body = keys.length ? keys.map(name => '<div class="row"><div class="rl"><div class="t">' + esc(name) + '</div><div class="m"><span>' + map[name].n + " viaje(s)</span><span class='num'>vol " + nf(map[name].vol) + "</span></div></div></div>").join("") : '<div class="empty">Sin destinos</div>';
      } else if (k === "espera") {
        title = "Tiempo de espera en planta";
        const list = tripSorted.filter(v => v.tiempoEspera > 0);
        body = list.length ? list.map(v => { const t = trucks.find(x => x.id === v.truckId) || { num: v.patente || "?" };
          return '<div class="row"><div class="rl"><div class="t">' + iconSpan("route") + esc(t.num) + " · " + esc(v.plantaDestino || "") + '</div><div class="m"><span>Espera: <b style="color:var(--ink)">' + fmtDur(v.tiempoEspera) + "</b></span><span>" + fmtDateTime(v.llegada || v.salida || v.ts) + "</span></div></div></div>"; }).join("")
          : '<div class="empty">' + I.route + "<div>Sin tiempos de espera registrados</div></div>";
      }
      openSheet(title, '<div class="card" style="box-shadow:none;border:0">' + body + "</div>");
    }
  }
  paint();
}

function kpi(cls, val, lab, sub, key) {
  return '<div class="kpi ' + cls + '"' + (key ? ' data-kpi="' + key + '" style="cursor:pointer"' : "") + '><span class="stripe"></span><div class="lab">' + esc(lab) + '</div><div class="val num" style="font-size:1.5rem">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div></div>";
}
function nf(n, dec) { return (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: dec || 0 }); }
function fmtDur(ms) { if (!ms || ms < 0) return "-"; const m = Math.round(ms / 60000); const h = Math.floor(m / 60); const mm = m % 60; return h ? (h + " h " + mm + " min") : (mm + " min"); }

function truckFuelStats(truckId, fuel) {
  const list = fuel.filter(f => f.truckId === truckId && f.km > 0).sort((a, b) => a.km - b.km);
  const out = { rend: null, costoKm: null, kmRec: 0, litros: 0, gasto: 0, rends: [], last: list[list.length - 1] || null };
  if (list.length < 2) return out;
  for (let i = 1; i < list.length; i++) {
    const dk = list[i].km - list[i - 1].km, lt = Number(list[i].litros) || 0;
    if (dk > 0 && lt > 0) { out.rends.push({ rend: dk / lt }); out.kmRec += dk; out.litros += lt; }
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
  fuel.slice().sort((a, b) => (a.fecha || a.ts) - (b.fecha || b.ts)).forEach(f => { const t = tm(f.truckId); rows.push([csvDate(f.fecha || f.ts), t.num || "", t.patente || "", f.driverNombre || "", f.km || "", f.litros || "", f.precioLitro || "", f.total || "", f.estacion || ""]); });
  download("combustible.csv", toCSV(rows)); toast("Exportado combustible.csv", "ok");
}
function exportTrips(trips, trucks) {
  const tm = id => (trucks.find(x => x.id === id) || {});
  const rows = [["Salida", "Llegada", "Estado", "Camion", "Patente", "Conductor", "Origen", "Predio", "Producto", "Especie", "PlantaDestino", "Volumen", "Unidad", "GuiaDespacho", "GMM"]];
  trips.slice().sort((a, b) => (a.salida || a.ts) - (b.salida || b.ts)).forEach(v => {
    const t = tm(v.truckId), pr = v.producto || {};
    rows.push([csvDate(v.salida), csvDate(v.llegada), v.estado === "cerrado" ? "Cerrado" : "Abierto", t.num || v.patente || "", t.patente || v.patente || "", v.driverNombre || "", v.origen || "", v.predio || "", (pr.codigo ? pr.codigo + " " : "") + (pr.descripcion || ""), pr.especie || "", v.plantaDestino || "", v.volumen || "", v.unidad || "", v.guiaDespacho || "", v.gmm || ""]);
  });
  download("viajes.csv", toCSV(rows)); toast("Exportado viajes.csv", "ok");
}

// Reporte consolidado del período, imprimible / guardable como PDF.
function generarReporte(ctx, range, fuelR, tripsR, orders, trucks, stats) {
  const co = ctx.company ? ctx.company() : { nombre: "", app: "Bitácora de Camiones" };
  const oTotal = o => (o.repuestos || []).reduce((s, x) => s + (Number(x.costo) || 0), 0) + (Number(o.manoObra) || 0);
  const dLo = new Date(range.desde + "T00:00:00").getTime(), dHi = new Date(range.hasta + "T23:59:59").getTime();
  const litros = fuelR.reduce((s, f) => s + (Number(f.litros) || 0), 0);
  const gasto = fuelR.reduce((s, f) => s + (Number(f.total) || 0), 0);
  const rends = stats.filter(x => x.s.rend); const rendProm = rends.length ? rends.reduce((s, x) => s + x.s.rend, 0) / rends.length : 0;
  const m3 = tripsR.filter(v => v.unidad === "M3").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const mr = tripsR.filter(v => v.unidad === "MR").reduce((s, v) => s + (Number(v.volumen) || 0), 0);
  const esp = tripsR.filter(v => v.tiempoEspera > 0).map(v => v.tiempoEspera); const espProm = esp.length ? esp.reduce((s, x) => s + x, 0) / esp.length : 0;
  const done = orders.filter(o => o.estado === "completado" && o.completedAt >= dLo && o.completedAt <= dHi);
  const tallerTotal = done.reduce((s, o) => s + oTotal(o), 0);
  const rendRows = stats.filter(x => x.s.rend).map(x => "<tr><td>" + esc(x.t.num) + "</td><td>" + esc(x.t.marca + " " + (x.t.modelo || "")) + '</td><td class="r">' + nf(x.s.rend, 2) + ' km/L</td><td class="r">' + fmtCLP(x.s.costoKm || 0) + "</td></tr>").join("");
  const bp = {}; tripsR.forEach(v => { if (!v.plantaDestino) return; const k = v.plantaDestino; (bp[k] = bp[k] || { n: 0, e: [] }); bp[k].n++; if (v.tiempoEspera > 0) bp[k].e.push(v.tiempoEspera); });
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const plantaRows = Object.keys(bp).sort((a, b) => avg(bp[b].e) - avg(bp[a].e)).map(n => "<tr><td>" + esc(n) + '</td><td class="r">' + bp[n].n + '</td><td class="r">' + (avg(bp[n].e) ? fmtDur(avg(bp[n].e)) : "-") + "</td></tr>").join("");
  const tallerRows = done.map(o => { const t = trucks.find(x => x.id === o.truckId) || { num: o.patente || "?" }; return "<tr><td>" + esc(t.num) + "</td><td>" + esc(o.titulo) + "</td><td>" + esc(o.taller || "") + '</td><td class="r">' + fmtCLP(oTotal(o)) + "</td></tr>"; }).join("");
  const kc = (l, v) => '<div class="k"><div class="kl">' + esc(l) + '</div><div class="kv">' + esc(v) + "</div></div>";
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte ' + esc(co.nombre || "") + "</title>" +
    "<style>*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#1b1a17;margin:0;padding:24px;background:#fff}h1{margin:0 0 2px;font-size:22px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#7a776e;margin:22px 0 6px;border-bottom:1px solid #e3e1da;padding-bottom:4px}.sub{color:#7a776e;margin:0 0 14px;font-size:13px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.k{border:1px solid #e3e1da;border-radius:8px;padding:10px}.kl{font-size:11px;text-transform:uppercase;color:#7a776e}.kv{font-size:17px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}th{color:#7a776e;font-size:11px;text-transform:uppercase}td.r,th.r{text-align:right}.tot{font-weight:700}.noprint{margin-bottom:16px}@media print{.noprint{display:none}}button{background:#e3700b;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}</style></head><body>" +
    '<div class="noprint"><button onclick="window.print()">Imprimir o guardar PDF</button></div>' +
    "<h1>" + esc(co.app || "Bitácora de Camiones") + "</h1>" +
    '<p class="sub">' + esc(co.nombre || "") + " &middot; Reporte del período " + fmtDate(dLo) + " al " + fmtDate(dHi) + "</p>" +
    '<h2>Costos</h2><div class="kpis">' + kc("Combustible", fmtCLP(gasto)) + kc("Taller", fmtCLP(tallerTotal)) + kc("Costo total", fmtCLP(gasto + tallerTotal)) + kc("Litros", nf(litros) + " L") + "</div>" +
    '<h2>Operación</h2><div class="kpis">' + kc("Viajes", String(tripsR.length)) + kc("Volumen", nf(m3) + " M3 / " + nf(mr) + " MR") + kc("Rendimiento", rendProm ? nf(rendProm, 2) + " km/L" : "-") + kc("Espera prom.", espProm ? fmtDur(espProm) : "-") + "</div>" +
    (rendRows ? '<h2>Rendimiento por camión</h2><table><tr><th>Camión</th><th>Modelo</th><th class="r">Rendimiento</th><th class="r">Costo/km</th></tr>' + rendRows + "</table>" : "") +
    (plantaRows ? '<h2>Espera por planta</h2><table><tr><th>Planta</th><th class="r">Viajes</th><th class="r">Espera prom.</th></tr>' + plantaRows + "</table>" : "") +
    (tallerRows ? '<h2>Órdenes de taller completadas</h2><table><tr><th>Camión</th><th>Trabajo</th><th>Taller</th><th class="r">Costo</th></tr>' + tallerRows + '<tr><td colspan="3" class="r tot">Total taller</td><td class="r tot">' + fmtCLP(tallerTotal) + "</td></tr></table>" : "") +
    '<p class="sub" style="margin-top:22px;font-size:11px">Generado el ' + fmtDate(Date.now()) + "</p></body></html>";
  const w = window.open("", "_blank");
  if (!w) { toast("Permite las ventanas emergentes para ver el reporte", "err"); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
