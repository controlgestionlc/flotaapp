// Lector de Excel (.xlsx) liviano y sin dependencias.
// Un .xlsx es un ZIP con XML adentro. Usa la descompresión nativa del
// navegador (DecompressionStream). Devuelve las filas de una hoja como
// arreglo de arreglos de texto. Las fechas quedan como número de serie
// de Excel (el importador las convierte).

const U16 = (d, o) => d[o] | (d[o + 1] << 8);
const U32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("Tu navegador no soporta leer Excel aquí. Sube el archivo en formato CSV.");
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

function unzip(ab) {
  const d = new Uint8Array(ab);
  let i = d.length - 22;
  for (; i >= 0; i--) { if (U32(d, i) === 0x06054b50) break; }
  if (i < 0) throw new Error("El archivo no parece un Excel válido.");
  const cdOffset = U32(d, i + 16), cdCount = U16(d, i + 10);
  const files = {}; let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (U32(d, p) !== 0x02014b50) break;
    const method = U16(d, p + 10), compSize = U32(d, p + 20);
    const nameLen = U16(d, p + 28), extraLen = U16(d, p + 30), commentLen = U16(d, p + 32), localOffset = U32(d, p + 42);
    const name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nameLen));
    const lh = localOffset, lNameLen = U16(d, lh + 26), lExtraLen = U16(d, lh + 28);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    files[name] = { method, raw: d.subarray(dataStart, dataStart + compSize) };
    p = p + 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function fileText(files, name) {
  const f = files[name]; if (!f) return null;
  const bytes = f.method === 0 ? f.raw : await inflateRaw(f.raw);
  return new TextDecoder("utf-8").decode(bytes);
}

const decodeXml = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

function parseShared(xml) {
  if (!xml) return [];
  const out = []; let m; const re = /<si>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(xml))) out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join(""));
  return out;
}
function colIdx(ref) { const m = ref.match(/^([A-Z]+)/); let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; }
function parseSheet(xml, shared) {
  const rows = []; let rm; const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  while ((rm = rowRe.exec(xml))) {
    const cells = []; let cm; const cRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1], inner = cm[3] || "";
      const rRef = (attrs.match(/r="([^"]+)"/) || [])[1] || "";
      const t = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
      const idx = rRef ? colIdx(rRef) : cells.length;
      const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
      let val = null;
      if (t === "s") val = vM ? (shared[+vM[1]] || "") : "";
      else if (t === "inlineStr") { const im = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/); val = im ? decodeXml(im[1]) : ""; }
      else val = vM ? decodeXml(vM[1]) : null;
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// Devuelve { sheetNames:[...], rows:[[...]] } de la hoja pedida (o "base", o la primera).
export async function readXlsx(arrayBuffer, sheetName) {
  const files = unzip(arrayBuffer);
  const shared = parseShared(await fileText(files, "xl/sharedStrings.xml"));
  const wb = await fileText(files, "xl/workbook.xml");
  const rels = await fileText(files, "xl/_rels/workbook.xml.rels");
  const relMap = {};
  if (rels) [...rels.matchAll(/<Relationship\b[^>]*>/g)].forEach(t => {
    const id = (t[0].match(/Id="([^"]+)"/) || [])[1], tg = (t[0].match(/Target="([^"]+)"/) || [])[1];
    if (id) relMap[id] = tg;
  });
  const sheets = wb ? [...wb.matchAll(/<sheet\b[^>]*>/g)].map(t => ({
    name: decodeXml((t[0].match(/name="([^"]+)"/) || [])[1] || ""),
    rid: (t[0].match(/r:id="([^"]+)"/) || [])[1]
  })) : [];
  const sheetNames = sheets.map(s => s.name);
  let target = null;
  const want = (sheetName || "base").toLowerCase();
  const chosen = sheets.find(s => s.name.toLowerCase() === want) || sheets[0];
  if (chosen && relMap[chosen.rid]) target = relMap[chosen.rid].replace(/^\//, "").replace(/^xl\//, "");
  const path = target ? "xl/" + target : "xl/worksheets/sheet1.xml";
  const sx = await fileText(files, path) || await fileText(files, "xl/worksheets/sheet1.xml");
  const rows = sx ? parseSheet(sx, shared) : [];
  return { sheetNames, rows };
}

// Número de serie de Excel -> timestamp (epoch 1899-12-30).
export function excelSerialToTs(serial) {
  return Date.UTC(1899, 11, 30) + Math.round(Number(serial) * 86400000);
}
