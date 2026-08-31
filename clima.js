// =============================================================
//  Clima · consulta a Open-Meteo (API pública, sin API key).
//  Se ejecuta en el navegador del usuario. Devuelve la lectura
//  actual + resumen diario por coordenadas de la faena.
// =============================================================

const API = "https://api.open-meteo.com/v1/forecast";

export function hasCoords(f) {
  return f && isFinite(Number(f.lat)) && isFinite(Number(f.lng)) && (Number(f.lat) !== 0 || Number(f.lng) !== 0);
}

// Consulta el clima de una faena: condición actual + pronóstico diario
// para 7 días (para evaluar la semana). Lanza error si no hay coordenadas.
export async function fetchFaenaClima(f) {
  if (!hasCoords(f)) throw new Error("La faena no tiene coordenadas");
  const url = API + "?latitude=" + encodeURIComponent(f.lat) + "&longitude=" + encodeURIComponent(f.lng) +
    "&current=temperature_2m,precipitation,wind_speed_10m,weather_code" +
    "&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max" +
    "&timezone=auto&forecast_days=7";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Servicio de clima no disponible (" + res.status + ")");
  const j = await res.json();
  const c = j.current || {}, d = j.daily || {};
  const n = (a, i) => (Array.isArray(a) && a[i] != null ? Number(a[i]) : null);
  const dias = (d.time || []).map((fecha, i) => ({
    fecha: fecha,
    code: n(d.weather_code, i),
    tmax: n(d.temperature_2m_max, i),
    precip24: n(d.precipitation_sum, i),
    probLluvia: n(d.precipitation_probability_max, i),
    windKmh: n(d.wind_speed_10m_max, i)
  }));
  const hoy = dias[0] || {};
  return {
    tempC: c.temperature_2m != null ? Number(c.temperature_2m) : null,
    precipMm: c.precipitation != null ? Number(c.precipitation) : null,
    windKmh: c.wind_speed_10m != null ? Number(c.wind_speed_10m) : null,
    code: c.weather_code != null ? Number(c.weather_code) : null,
    // Compat: "hoy" para el resumen y la evaluación puntual.
    precip24: hoy.precip24 != null ? hoy.precip24 : null,
    probLluvia: hoy.probLluvia != null ? hoy.probLluvia : null,
    dias: dias,
    ts: Date.now()
  };
}

// Fecha de inicio del histórico solicitado por el negocio.
export const HIST_START = "2026-08-01";

// Devuelve "YYYY-MM-DD" a partir de un Date.
function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
// Inicio efectivo: la API de pronóstico solo permite ~92 días hacia atrás.
export function histStart() {
  const min = new Date(Date.now() - 92 * 86400000);
  const minISO = iso(min);
  return HIST_START > minISO ? HIST_START : minISO;
}
export function histEnd() { return iso(new Date()); }

// Histórico diario de una faena (precipitación acumulada, viento, temperaturas)
// usando la misma fuente Open-Meteo. Rango [startISO, endISO].
export async function fetchFaenaHistorial(f, startISO, endISO) {
  if (!hasCoords(f)) throw new Error("La faena no tiene coordenadas");
  const url = API + "?latitude=" + encodeURIComponent(f.lat) + "&longitude=" + encodeURIComponent(f.lng) +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max" +
    "&timezone=auto&start_date=" + startISO + "&end_date=" + endISO;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Servicio de clima no disponible (" + res.status + ")");
  const j = await res.json();
  const d = j.daily || {};
  const n = (a, i) => (Array.isArray(a) && a[i] != null ? Number(a[i]) : null);
  return (d.time || []).map((fecha, i) => ({
    fecha,
    code: n(d.weather_code, i),
    tmax: n(d.temperature_2m_max, i),
    tmin: n(d.temperature_2m_min, i),
    precip24: n(d.precipitation_sum, i),
    probLluvia: n(d.precipitation_probability_max, i),
    windKmh: n(d.wind_speed_10m_max, i)
  }));
}

// Geocodificación por nombre de lugar (comuna/localidad) vía Open-Meteo.
// Devuelve { lat, lng, nombre } o null si no hay resultados.
export async function geocode(nombre) {
  const q = String(nombre || "").trim();
  if (!q) throw new Error("Indica una comuna o localidad");
  const url = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=5&language=es&format=json";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Servicio de búsqueda no disponible (" + res.status + ")");
  const j = await res.json();
  const rs = (j && j.results) || [];
  if (!rs.length) return null;
  // Prefiere un resultado en Chile si existe.
  const cl = rs.find(r => r.country_code === "CL") || rs[0];
  return { lat: cl.latitude, lng: cl.longitude, nombre: [cl.name, cl.admin1, cl.country].filter(Boolean).join(", ") };
}

// Consulta varias faenas; devuelve { id: {ok, reading|error} }.
export async function fetchClimaFaenas(faenas) {
  const out = {};
  await Promise.all((faenas || []).map(async f => {
    if (!hasCoords(f)) { out[f.id] = { ok: false, error: "Sin coordenadas" }; return; }
    try { out[f.id] = { ok: true, reading: await fetchFaenaClima(f) }; }
    catch (e) { out[f.id] = { ok: false, error: (e && e.message) || "Error" }; }
  }));
  return out;
}
