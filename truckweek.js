// Vista de la semana completa de un camión (usada desde el panel y el
// conductor). Muestra la faena asignada cada día, con navegación de semanas.
import { store } from "./store.js";
import { I, esc, fmtDate, openSheet, closeSheet, $, $$ } from "./ui.js";
import { weekInfo, dayKey, DIAS_LARGO } from "./planning.js";

export async function openTruckWeek(ctx, truckId, weekTs) {
  const ts = weekTs || Date.now();
  const wk = weekInfo(ts);
  let plans = [], faenas = [], users = [], trucks = [];
  try { [plans, faenas, trucks] = await Promise.all([store.listPlans(), store.listFaenas(), store.listTrucks()]); } catch (e) {}
  try { users = await store.listUsers(); } catch (e) { users = []; } // el conductor no lee usuarios
  const t = trucks.find(x => x.id === truckId) || { num: "?" };
  const plan = plans.find(p => p.id === wk.key);
  const asigs = (plan && plan.asignaciones || []).filter(a => a.camionId === truckId && a.faenaId);
  const faN = id => { const f = faenas.find(z => z.id === id); return f ? f.nombre : "Faena"; };
  const faU = id => { const f = faenas.find(z => z.id === id); return f ? (f.unidad || "") : ""; };
  const coN = uid => { const u = users.find(z => z.uid === uid); return u ? u.nombre : ""; };
  const hoy = dayKey(Date.now());

  const dias = wk.dias.map((dts, i) => {
    const dk = dayKey(dts);
    const list = asigs.filter(a => a.fecha === dk).sort((a, b) => (a.turnoInicio || "").localeCompare(b.turnoInicio || ""));
    const head = '<div class="tw-day' + (dk === hoy ? " hoy" : "") + '"><span class="tw-dl">' + DIAS_LARGO[i] + " " + new Date(dts).getDate() + (dk === hoy ? " · hoy" : "") + "</span></div>";
    const body = list.length
      ? list.map(a => '<div class="row" style="padding:7px 0"><span class="sev-stripe sev-baja" style="background:var(--accent)"></span><div class="rl">' +
          '<div class="t">' + esc(faN(a.faenaId)) + ' <span class="pill neutral">' + (a.viajesObjetivo || 0) + " v.</span></div>" +
          '<div class="m"><span>' + esc((a.turnoInicio || "--") + " ─ " + (a.turnoFin || "--")) + "</span>" +
          (coN(a.conductorId) ? "<span>" + esc(coN(a.conductorId)) + "</span>" : "") +
          (a.volumenObjetivo ? "<span>" + a.volumenObjetivo + " " + esc(faU(a.faenaId)) + "</span>" : "") + "</div></div></div>").join("")
      : '<div class="meta-line" style="padding:6px 2px;font-size:.82rem">Reserva / sin asignación</div>';
    return head + body;
  }).join("");

  const nav =
    '<div class="tw-nav"><button class="btn sm btn-soft" id="tw-prev">' + I.back + "Semana</button>" +
    '<div class="tw-lbl"><b>Semana ' + wk.num + '</b><span>' + fmtDate(wk.inicio) + " ─ " + fmtDate(wk.fin) + "</span></div>" +
    '<button class="btn sm btn-soft" id="tw-next">Semana' + I.arrow + "</button></div>" +
    '<div style="text-align:center;margin:0 0 10px"><button class="btn sm btn-ghost" id="tw-hoy">Semana actual</button></div>';

  openSheet("Planificación · " + t.num, nav + '<div class="card" style="box-shadow:none">' + dias + "</div>", () => {
    $("#tw-prev").onclick = () => { closeSheet(); openTruckWeek(ctx, truckId, ts - 7 * 86400000); };
    $("#tw-next").onclick = () => { closeSheet(); openTruckWeek(ctx, truckId, ts + 7 * 86400000); };
    $("#tw-hoy").onclick = () => { closeSheet(); openTruckWeek(ctx, truckId, Date.now()); };
  });
}
