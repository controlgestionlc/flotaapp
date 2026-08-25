import { store } from "./store.js";
import { I, esc, fmtDate, toast, $ } from "./ui.js";
import { readXlsx, excelSerialToTs } from "./xlsx-lite.js";

const normPat = p => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normCode = c => String(c || "").trim().toUpperCase();

function parseNum(v) {
  if (v == null) return 0;
  let s = String(v).trim(); if (!s) return 0;
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s); return isNaN(n) ? 0 : n;
}
function toTs(v) {
  if (v == null || v === "") return Date.now();
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return (n > 60 && n < 600000) ? excelSerialToTs(n) : n; }
  const d = new Date(s); return isNaN(d.getTime()) ? Date.now() : d.getTime();
}
function inferEspecie(d) { d = (d || "").toUpperCase(); if (/EUCA|NITENS|GLOB|EUGL|EUNI/.test(d)) return "EUCALYPTUS"; if (/PINO/.test(d)) return "PINO"; return ""; }
function inferUM(d) { d = (d || "").toUpperCase().trim(); if (d.indexOf("M3") === 0) return "M3"; if (d.indexOf("MR") === 0) return "MR"; if (/TROZO/.test(d)) return "M3"; return "MR"; }

function parseCSV(text) {
  text = text.replace(/^\ufeff/, "");
  const first = text.split("\n")[0] || "";
  const delim = ((first.match(/;/g) || []).length >= (first.match(/,/g) || []).length) ? ";" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function findCols(header) {
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const H = header.map(norm);
  const find = (...keys) => { for (let i = 0; i < H.length; i++) if (keys.some(k => H[i].includes(k))) return i; return -1; };
  return {
    gmm: find("gmm"), fecha: find("fecha"), guia: find("guia"), patente: find("patente"),
    codigo: find("codigo"), cantidad: find("cantidad", "cant"), comuna: find("comuna"),
    destino: find("destino"), rol: find("rolpredio") >= 0 ? find("rolpredio") : find("rol"),
    origen: find("predioorigen", "origen"), descrip: find("descrip")
  };
}

export async function renderImportar(view, ctx) {
  view.innerHTML = '<button class="backlink" id="im-back">' + I.back + " Panel</button><div class='meta-line' style='padding:20px 2px'>Cargando...</div>";
  const b0 = $("#im-back", view); if (b0) b0.onclick = () => ctx.go("home", {});

  const [trucks, products, existing] = await Promise.all([store.listTrucks(), store.listProducts(), store.listTrips()]);
  const existingGmm = new Set(existing.map(t => String(t.gmm || "")).filter(Boolean));
  const truckByPat = {}; trucks.forEach(t => { truckByPat[normPat(t.patente)] = t; });
  const prodByCode = {}; products.forEach(p => { prodByCode[normCode(p.codigo)] = p; });

  let parsed = null; // { trips, total, dup, unmatched:[], sheetNames }

  function build(rows) {
    const nonEmpty = rows.filter(r => r && r.some(c => c != null && String(c).trim() !== ""));
    if (!nonEmpty.length) { parsed = { trips: [], total: 0, dup: 0, unmatched: [], error: "El archivo está vacío." }; return; }
    const header = nonEmpty[0], cols = findCols(header);
    if (cols.gmm < 0 || cols.patente < 0 || cols.codigo < 0) { parsed = { trips: [], total: 0, dup: 0, unmatched: [], error: "No se reconocen las columnas. Debe tener al menos NºGMM, Patente y Código." }; return; }
    const trips = []; const seen = new Set(); const unmatched = new Set(); let dup = 0;
    for (let i = 1; i < nonEmpty.length; i++) {
      const r = nonEmpty[i];
      const gmm = String(r[cols.gmm] == null ? "" : r[cols.gmm]).trim();
      if (!gmm) continue;
      if (existingGmm.has(gmm) || seen.has(gmm)) { dup++; continue; }
      seen.add(gmm);
      const pat = r[cols.patente], nP = normPat(pat), truck = truckByPat[nP];
      if (!truck && pat) unmatched.add(String(pat).trim());
      const code = String(cols.codigo >= 0 ? (r[cols.codigo] == null ? "" : r[cols.codigo]) : "").trim();
      const desc = String(cols.descrip >= 0 ? (r[cols.descrip] == null ? "" : r[cols.descrip]) : "").trim();
      const match = prodByCode[normCode(code)];
      const producto = match
        ? { codigo: match.codigo, descripcion: match.descripcion, especie: match.especie || "", um: match.um || "" }
        : { codigo: code, descripcion: desc, especie: inferEspecie(desc), um: inferUM(desc) };
      const unidad = producto.um || inferUM(desc);
      const fechaTs = toTs(cols.fecha >= 0 ? r[cols.fecha] : null);
      const predio = String(cols.origen >= 0 ? (r[cols.origen] || "") : "").trim();
      trips.push({
        truckId: truck ? truck.id : "", patente: String(pat || "").trim(),
        uid: ctx.profile.uid, driverNombre: "", deviceId: "import", estado: "cerrado",
        origen: predio, predio: predio,
        rolPredio: String(cols.rol >= 0 ? (r[cols.rol] || "") : "").trim(),
        comuna: String(cols.comuna >= 0 ? (r[cols.comuna] || "") : "").trim(),
        producto, volumen: parseNum(cols.cantidad >= 0 ? r[cols.cantidad] : 0), unidad,
        guiaDespacho: String(cols.guia >= 0 ? (r[cols.guia] || "") : "").trim(), gmm,
        salida: fechaTs, salidaGps: null, plantaDestino: String(cols.destino >= 0 ? (r[cols.destino] || "") : "").trim(),
        llegada: fechaTs, llegadaGps: null, ts: fechaTs, importado: true
      });
    }
    parsed = { trips, total: nonEmpty.length - 1, dup, unmatched: Array.from(unmatched) };
  }

  async function onFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const st = $("#im-status", view); if (st) st.textContent = "Leyendo " + f.name + "...";
    try {
      let rows;
      if (/\.csv$/i.test(f.name)) rows = parseCSV(await f.text());
      else rows = (await readXlsx(await f.arrayBuffer(), "base")).rows;
      build(rows); paint();
    } catch (err) { parsed = { trips: [], total: 0, dup: 0, unmatched: [], error: err.message || String(err) }; paint(); }
  }

  async function doImport() {
    if (!parsed || !parsed.trips.length) return;
    const btn = $("#im-do", view); btn.disabled = true; btn.textContent = "Importando " + parsed.trips.length + "...";
    try {
      await store.addTripsBulk(parsed.trips);
      parsed.trips.forEach(t => existingGmm.add(t.gmm));
      toast(parsed.trips.length + " viaje(s) importados", "ok");
      ctx.go("home", {});
    } catch (e) { toast("No se pudo importar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Reintentar importación"; }
  }

  function summary() {
    if (!parsed) return "Ningún archivo cargado todavía.";
    if (parsed.error) return "No se pudo leer: " + esc(parsed.error);
    let s = "Filas leídas: <b>" + parsed.total + "</b>. Nuevos a importar: <b style='color:var(--ok)'>" + parsed.trips.length + "</b>. Duplicados omitidos (mismo GMM): <b>" + parsed.dup + "</b>.";
    if (parsed.unmatched.length) s += "<br><span style='color:var(--warn)'>Patentes sin camión registrado (se guardan igual, sin vincular): " + esc(parsed.unmatched.join(", ")) + "</span>";
    return s;
  }
  function preview() {
    const rows = parsed.trips.slice(0, 5).map(t => {
      const truck = trucks.find(x => x.id === t.truckId);
      return '<div class="row"><div class="rl"><div class="t">' + esc((truck ? truck.num : t.patente) + " · " + t.producto.descripcion) + '</div>' +
        '<div class="m"><span class="num">' + t.volumen + " " + esc(t.unidad) + "</span><span>" + esc(t.plantaDestino || "") + "</span><span>GMM " + esc(t.gmm) + "</span><span>" + fmtDate(t.salida) + "</span></div></div></div>";
    }).join("");
    return '<div class="card section"><div class="eyebrow" style="padding:12px 14px 4px">Vista previa (primeros 5)</div>' + rows + "</div>";
  }

  function paint() {
    view.innerHTML =
      '<button class="backlink" id="im-back">' + I.back + " Panel</button>" +
      '<div class="subhead"><h2>Importar viajes históricos</h2></div>' +
      '<div class="banner">' + I.alert + "<div>Solo administrador. Sube el Excel con la hoja <b>base</b> (o su versión CSV). No se duplican viajes: se omiten los que ya tengan el mismo N° GMM.</div></div>" +
      '<div class="card pad section"><input type="file" id="im-file" accept=".xlsx,.csv" style="display:none">' +
        '<button class="btn btn-primary" id="im-pick">' + I.upload + "Elegir archivo (.xlsx o .csv)</button>" +
        '<div id="im-status" class="meta-line" style="margin-top:12px;line-height:1.5">' + summary() + "</div></div>" +
      (parsed && parsed.trips.length ? preview() : "") +
      (parsed && parsed.trips.length ? '<div class="formbar"><button class="btn btn-primary" id="im-do">' + I.upload + "Importar " + parsed.trips.length + " viaje(s)</button></div>" : "");
    $("#im-back", view).onclick = () => ctx.go("home", {});
    const pk = $("#im-pick", view); if (pk) pk.onclick = () => $("#im-file", view).click();
    const fi = $("#im-file", view); if (fi) fi.onchange = onFile;
    const dob = $("#im-do", view); if (dob) dob.onclick = doImport;
  }
  paint();
}
