import { store } from "./store.js";
import { truckKm, planStatus } from "./maintenance.js";
import { I, esc, uid, fmtDate, dInput, emptyBox, toast, openSheet, closeSheet, $, $$ } from "./ui.js";

export async function renderMantencion(view, ctx) {
  const id = ctx.params.id;
  const [truck, fuel] = await Promise.all([store.getTruck(id), store.listFuel()]);
  if (!truck) return ctx.go("camiones", {});
  const km = truckKm(fuel, id);
  let planes = (truck.mantenciones || []).map(p => Object.assign({}, p));

  function paint() {
    const rows = planes.length ? planes.map(pl => {
      const st = planStatus(pl, km);
      const meta = pl.tipo === "km"
        ? "Cada " + Number(pl.intervalo).toLocaleString("es-CL") + " km · última a los " + (Number(pl.ultimoKm) || 0).toLocaleString("es-CL") + " km"
        : "Cada " + pl.intervalo + " mes(es) · última " + (pl.ultimaFecha ? fmtDate(pl.ultimaFecha) : "sin registro");
      return '<div class="row"><span class="sev-stripe ' + (st.cls === "crit" ? "sev-alta" : st.cls === "warn" ? "sev-media" : "sev-baja") + '"></span><div class="rl">' +
        '<div class="t">' + esc(pl.nombre) + ' <span class="pill ' + st.cls + '">' + st.label + "</span></div>" +
        '<div class="m"><span>' + esc(meta) + "</span>" + (st.detalle ? "<span>" + esc(st.detalle) + "</span>" : "") + "</div>" +
        '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm btn-steel" data-done="' + esc(pl.id) + '">' + I.check + "Registrar realizada</button>" +
        '<button class="btn sm btn-soft" data-edit="' + esc(pl.id) + '">Editar</button>' +
        '<button class="btn sm btn-soft" data-del="' + esc(pl.id) + '" style="color:var(--crit)">Quitar</button></div>' +
        "</div></div>";
    }).join("") : emptyBox("Este camión no tiene pautas de mantención");

    view.innerHTML =
      '<button class="backlink" id="mt-back">' + I.back + " Camión</button>" +
      '<div class="subhead"><h2>Mantención preventiva</h2></div>' +
      '<div class="card pad section"><div class="stat-truck"><span class="trucknum">' + esc(truck.num) + "</span>" +
      '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.1rem">' + esc(truck.marca + " " + (truck.modelo || "")) + "</div>" +
      '<div class="meta-line" style="margin-top:3px">' + esc(truck.patente) + " · Kilometraje actual: <b style='color:var(--ink)'>" + km.toLocaleString("es-CL") + " km</b></div></div></div>" +
      (km ? "" : '<p class="meta-line" style="font-size:.78rem;margin:10px 2px 0">El kilometraje se toma de la última carga de combustible. Registra cargas para calcular las pautas por km.</p>') + "</div>" +
      '<button class="btn btn-primary section" id="mt-new">' + I.plus + "Nueva pauta</button>" +
      '<div class="card">' + rows + "</div>";

    $("#mt-back", view).onclick = () => ctx.go("truckDetail", { id });
    $("#mt-new", view).onclick = () => openForm(null);
    $$("[data-edit]", view).forEach(b => b.onclick = () => openForm(planes.find(x => x.id === b.getAttribute("data-edit"))));
    $$("[data-done]", view).forEach(b => b.onclick = () => marcarRealizada(b.getAttribute("data-done")));
    $$("[data-del]", view).forEach(b => b.onclick = () => { if (confirm("¿Quitar esta pauta?")) { planes = planes.filter(x => x.id !== b.getAttribute("data-del")); persist(); } });
  }

  async function persist() {
    try { await store.saveTruck(id, Object.assign({}, truck, { mantenciones: planes })); truck.mantenciones = planes; paint(); }
    catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); }
  }
  async function marcarRealizada(pid) {
    const pl = planes.find(x => x.id === pid); if (!pl) return;
    if (pl.tipo === "km") { if (!km) { toast("No hay kilometraje registrado aún", "err"); return; } pl.ultimoKm = km; }
    else pl.ultimaFecha = Date.now();
    await persist(); toast("Mantención registrada como realizada", "ok");
  }

  function openForm(pl) {
    const editing = !!pl;
    const d = pl ? Object.assign({}, pl) : { id: uid("mant"), nombre: "", tipo: "km", intervalo: "", ultimoKm: km || "", ultimaFecha: Date.now(), activo: true };
    const body = () =>
      '<label class="fld"><span class="lb">Nombre</span><input class="input" id="mf-nombre" placeholder="Ej: Cambio de aceite y filtros" value="' + esc(d.nombre) + '"></label>' +
      '<label class="fld"><span class="lb">Tipo de intervalo</span><div class="chips" id="mf-tipo">' +
        [["km", "Por kilómetros"], ["fecha", "Por fecha"]].map(x => '<button type="button" class="chip' + (d.tipo === x[0] ? " on" : "") + '" data-tipo="' + x[0] + '">' + x[1] + "</button>").join("") + "</div></label>" +
      (d.tipo === "km"
        ? '<label class="fld"><span class="lb">Cada cuántos km</span><input class="input num" id="mf-int" inputmode="numeric" placeholder="Ej: 15000" value="' + esc(d.intervalo) + '"></label>' +
          '<label class="fld" style="margin-bottom:0"><span class="lb">Km de la última mantención</span><input class="input num" id="mf-ultkm" inputmode="numeric" placeholder="' + (km || 0) + '" value="' + esc(d.ultimoKm) + '"></label>'
        : '<label class="fld"><span class="lb">Cada cuántos meses</span><input class="input num" id="mf-int" inputmode="numeric" placeholder="Ej: 6" value="' + esc(d.intervalo) + '"></label>' +
          '<label class="fld" style="margin-bottom:0"><span class="lb">Fecha de la última mantención</span><input class="input" type="date" id="mf-ultfecha" value="' + esc(d.ultimaFecha ? dInput(d.ultimaFecha) : dInput(Date.now())) + '"></label>');
    openSheet(editing ? "Editar pauta" : "Nueva pauta", '<div id="mf-body">' + body() + '</div><button class="btn btn-primary" id="mf-save" style="margin-top:14px">Guardar pauta</button>', () => {
      const rebind = () => {
        $$("#mf-tipo [data-tipo]").forEach(bt => bt.onclick = () => { syncForm(); d.tipo = bt.getAttribute("data-tipo"); $("#mf-body").innerHTML = body(); rebind(); });
      };
      function syncForm() {
        const n = $("#mf-nombre"); if (n) d.nombre = n.value;
        const it = $("#mf-int"); if (it) d.intervalo = it.value;
        const uk = $("#mf-ultkm"); if (uk) d.ultimoKm = uk.value;
        const uf = $("#mf-ultfecha"); if (uf) d.ultimaFecha = uf.value ? new Date(uf.value + "T12:00:00").getTime() : d.ultimaFecha;
      }
      rebind();
      $("#mf-save").onclick = async () => {
        syncForm();
        if (!d.nombre.trim() || !Number(d.intervalo)) { toast("Completa el nombre y el intervalo", "err"); return; }
        const plan = { id: d.id, nombre: d.nombre.trim(), tipo: d.tipo, intervalo: Number(d.intervalo), activo: true,
          ultimoKm: d.tipo === "km" ? (Number(d.ultimoKm) || 0) : null, ultimaFecha: d.tipo === "fecha" ? (d.ultimaFecha || Date.now()) : null };
        const idx = planes.findIndex(x => x.id === plan.id);
        if (idx >= 0) planes[idx] = plan; else planes.push(plan);
        closeSheet(); await persist(); toast("Pauta guardada", "ok");
      };
    });
  }

  paint();
}
