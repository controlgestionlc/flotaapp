// Lógica de mantención preventiva (por kilómetros o por fecha).

export const UMBRAL_KM = 1000;   // avisar 1.000 km antes del límite
export const UMBRAL_DIAS = 15;   // avisar 15 días antes del límite

// Kilometraje actual del camión = mayor odómetro registrado en cargas de combustible.
export function truckKm(fuel, truckId) {
  let mx = 0;
  fuel.forEach(f => { if (f.truckId === truckId && Number(f.km) > mx) mx = Number(f.km); });
  return mx;
}

function addMonths(ts, months) { const d = new Date(ts); d.setMonth(d.getMonth() + Number(months || 0)); return d.getTime(); }
const nfk = n => Math.abs(Math.round(n)).toLocaleString("es-CL");

// plan: { id, nombre, tipo:'km'|'fecha', intervalo, ultimoKm, ultimaFecha, activo }
export function planStatus(plan, currentKm) {
  if (plan.activo === false) return { k: "off", label: "Inactiva", cls: "neutral", detalle: "" };
  if (plan.tipo === "km") {
    const base = Number(plan.ultimoKm) || 0;
    const proximo = base + (Number(plan.intervalo) || 0);
    const faltan = proximo - (currentKm || 0);
    if (!currentKm) return { k: "sindato", label: "Sin km", cls: "neutral", proximo, detalle: "Próxima a los " + nfk(proximo) + " km" };
    if (faltan <= 0) return { k: "vencida", label: "Vencida", cls: "crit", proximo, detalle: "Excedida por " + nfk(faltan) + " km" };
    if (faltan <= UMBRAL_KM) return { k: "porvencer", label: "Por vencer", cls: "warn", proximo, detalle: "Faltan " + nfk(faltan) + " km" };
    return { k: "vigente", label: "Vigente", cls: "ok", proximo, detalle: "Faltan " + nfk(faltan) + " km" };
  }
  const desde = plan.ultimaFecha || Date.now();
  const proxima = addMonths(desde, plan.intervalo);
  const dias = Math.ceil((proxima - Date.now()) / 86400000);
  if (dias <= 0) return { k: "vencida", label: "Vencida", cls: "crit", proxima, detalle: "Vencida hace " + Math.abs(dias) + " días" };
  if (dias <= UMBRAL_DIAS) return { k: "porvencer", label: "Por vencer", cls: "warn", proxima, detalle: "En " + dias + " días" };
  return { k: "vigente", label: "Vigente", cls: "ok", proxima, detalle: "En " + dias + " días" };
}

// Alertas de mantención de toda la flota (para el panel y la pantalla de alertas).
export function maintenanceAlerts(trucks, fuel) {
  const out = [];
  trucks.forEach(t => {
    const km = truckKm(fuel, t.id);
    (t.mantenciones || []).forEach(pl => {
      const st = planStatus(pl, km);
      if (st.k === "vencida" || st.k === "porvencer")
        out.push({ cls: st.cls, kind: "mant", truckId: t.id, text: t.num + " · " + pl.nombre + " · " + st.detalle });
    });
  });
  return out;
}
