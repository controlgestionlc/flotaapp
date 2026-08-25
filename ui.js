// Utilidades de interfaz compartidas: iconos, formato, toast, GPS, sheets.

export const $  = (s, e = document) => e.querySelector(s);
export const $$ = (s, e = document) => Array.from(e.querySelectorAll(s));

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function uid(p) {
  return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function fmtCLP(n) {
  n = Math.round(Number(n) || 0);
  return "$" + n.toLocaleString("es-CL");
}
export function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) + ", " +
         d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}
export function todayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
export function monthKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + "-" + (d.getMonth() + 1);
}
export function dInput(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Días de antelación para avisar documentos por vencer (configurable por empresa).
let DOC_DIAS = 30;
export function setDocDias(n) { const v = Number(n); if (v > 0) DOC_DIAS = v; }
export function getDocDias() { return DOC_DIAS; }

// Estado de vencimiento de un documento a partir de su fecha (yyyy-mm-dd o ts).
export function docStatus(vence) {
  if (!vence) return { k: "none", label: "Sin fecha", cls: "neutral", days: null };
  const t = typeof vence === "number" ? vence : new Date(vence + "T12:00:00").getTime();
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0)         return { k: "vencido",   label: "Vencido",    cls: "crit",    days };
  if (days <= DOC_DIAS) return { k: "porvencer", label: "Por vencer", cls: "warn",    days };
  return { k: "vigente", label: "Vigente", cls: "ok", days };
}

// ---- iconos (inline SVG) ----
export const I = {
  truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4l3 3v4h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  note:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  history:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  wrench:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2.1 2.1 0 0 1-3-3L16.7 8.3a4 4 0 0 1-2-2z"/></svg>',
  arrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2 2M17.8 17.8l2 2M1.5 12h3M19.5 12h3M4.2 19.8l2-2M17.8 6.2l2-2"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>',
  cash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  fuel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M6 8h6"/><path d="M15 9l3 3v6a2 2 0 0 0 4 0V8l-4-4"/></svg>',
  route:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8.4 19H14a3.4 3.4 0 0 0 0-6.8h-4A3.4 3.4 0 0 1 10 5.4h5.6"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9m0 0l-4 4m4-4l4 4M5 3h14"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.6a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1.5H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5.9z"/></svg>'
};

export function iconSpan(k, color) {
  return '<span style="display:inline-flex;width:15px;height:15px;color:' + (color || "var(--muted)") + '">' + I[k] + "</span>";
}

// ---- toast ----
let toastT;
export function toast(msg, kind) {
  const old = $(".toast"); if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.innerHTML = (kind === "ok" ? I.check : kind === "err" ? I.alert : "") + "<span>" + esc(msg) + "</span>";
  document.body.appendChild(el);
  clearTimeout(toastT);
  toastT = setTimeout(() => el.remove(), 3200);
}

// ---- bottom sheet ----
export function openSheet(title, bodyHTML, after) {
  closeSheet();
  const sc = document.createElement("div");
  sc.className = "scrim"; sc.id = "sheet-scrim";
  sc.innerHTML =
    '<div class="sheet"><div class="grab"></div><div class="sheet-h"><h3>' + esc(title) +
    '</h3><button class="iconbtn" id="sheet-x" style="border-color:var(--line);background:var(--surface-2);color:var(--ink)">' +
    I.x + '</button></div><div class="sheet-b">' + bodyHTML + "</div></div>";
  document.body.appendChild(sc);
  sc.onclick = e => { if (e.target === sc) closeSheet(); };
  $("#sheet-x").onclick = closeSheet;
  if (after) after();
}
export function closeSheet() {
  const s = $("#sheet-scrim"); if (s) s.remove();
}

// ---- GPS ----
export function captureGPS(cb) {
  if (!navigator.geolocation) { cb(null, "no-soportado"); return; }
  navigator.geolocation.getCurrentPosition(
    p => cb({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy), ts: Date.now() }),
    e => cb(null, e.code === 1 ? "denegado" : "error"),
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 }
  );
}
export function gpsText(g) { return g ? g.lat + ", " + g.lng + " (±" + g.acc + " m)" : ""; }
export function gpsLink(g) { return g ? "https://www.google.com/maps?q=" + g.lat + "," + g.lng : "#"; }

// ---- tema ----
export function applyTheme() {
  let t = null;
  try { t = localStorage.getItem("bf_theme"); } catch (e) {}
  if (t) document.documentElement.setAttribute("data-theme", t);
}
export function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = cur ? (cur === "dark" ? "light" : "dark") : (sysDark ? "light" : "dark");
  try { localStorage.setItem("bf_theme", next); } catch (e) {}
  document.documentElement.setAttribute("data-theme", next);
}

export function emptyBox(t) {
  return '<div class="empty">' + I.inbox + "<div>" + esc(t) + "</div></div>";
}
