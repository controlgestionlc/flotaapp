// =============================================================
//  Clima · consulta a Open-Meteo (API pública, sin API key).
//  Se ejecuta en el navegador del usuario. Devuelve la lectura
//  actual + resumen diario por coordenadas de la faena.
// =============================================================

const API = "https://api.open-meteo.com/v1/forecast";

export function hasCoords(f) {
  return f && isFinite(Number(f.lat)) && isFinite(Number(f.lng)) && (Number(f.lat) !== 0 || Number(f.lng) !== 0);
}

// Consulta el clima de una faena. Lanza error si no hay coordenadas o falla la red.
export async function fetchFaenaClima(f) {
  if (!hasCoords(f)) throw new Error("La faena no tiene coordenadas");
  const url = API + "?latitude=" + encodeURIComponent(f.lat) + "&longitude=" + encodeURIComponent(f.lng) +
    "&current=temperature_2m,precipitation,wind_speed_10m,weather_code" +
    "&daily=precipitation_sum,precipitation_probability_max" +
    "&timezone=auto&forecast_days=2";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Servicio de clima no disponible (" + res.status + ")");
  const j = await res.json();
  const c = j.current || {}, d = j.daily || {};
  const first = a => (Array.isArray(a) && a.length ? a[0] : null);
  return {
    tempC: c.temperature_2m != null ? Number(c.temperature_2m) : null,
    precipMm: c.precipitation != null ? Number(c.precipitation) : null,
    windKmh: c.wind_speed_10m != null ? Number(c.wind_speed_10m) : null,
    code: c.weather_code != null ? Number(c.weather_code) : null,
    precip24: first(d.precipitation_sum) != null ? Number(first(d.precipitation_sum)) : null,
    probLluvia: first(d.precipitation_probability_max) != null ? Number(first(d.precipitation_probability_max)) : null,
    ts: Date.now()
  };
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
