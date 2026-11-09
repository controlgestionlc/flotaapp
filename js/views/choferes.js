import { store } from "../store.js";
import { can } from "../permissions.js";
import { I, esc, toast, emptyBox, openSheet, closeSheet, $, $$ } from "../ui.js";

// Documentos del chofer: cada uno es un flag "al día" (sí/no).
const DOCS = [["licencia", "Licencia de conductor"], ["cedula", "Cédula de identidad"], ["antecedentes", "Certificado de antecedentes"], ["otros", "Otros"]];
const nombreCompleto = c => ((c.nombre || "") + " " + (c.apellidos || "")).trim();

// Estado documental: los tres documentos principales deben estar al día.
function docEstado(c) {
  const d = c.docs || {};
  const faltan = ["licencia", "cedula", "antecedentes"].filter(k => !d[k]);
  if (!faltan.length) return { cls: "ok", label: "Documentos al día", faltan };
  return { cls: "crit", label: "Documentos pendientes", faltan };
}

let cfForm = null;

export async function renderChoferes(view, ctx) {
  if (ctx.route === "choferForm") return choferForm(view, ctx);
  if (ctx.route === "choferDetail") return choferDetail(view, ctx);
  return list(view, ctx);
}

async function list(view, ctx) {
  const [choferes, trucks] = await Promise.all([store.listChoferes().catch(() => []), store.listTrucks().catch(() => [])]);
  const manage = can(ctx.profile, "truck.manage");
  const truckNum = id => { const t = trucks.find(x => x.id === id); return t ? t.num + " · " + t.patente : null; };
  const rows = choferes.length ? choferes.map(c => {
    const de = docEstado(c);
    const cam = truckNum(c.camionId);
    const initials = ((c.nombre || "?").charAt(0) + (c.apellidos || "").charAt(0)).toUpperCase();
    return '<div class="row" data-chofer="' + esc(c.id) + '" style="cursor:pointer"><span class="trucknum" style="background:var(--accent)">' + esc(initials || "CH") + "</span>" +
      '<div class="rl"><div class="t">' + esc(nombreCompleto(c) || "Sin nombre") + (c.usuarioUid ? ' <span class="pill neutral" style="font-size:.7rem">con usuario</span>' : "") + "</div>" +
      '<div class="m"><span>' + (cam ? I.truck + " " + esc(cam) : "Sin camión asignado") + "</span>" +
      (c.activo === false ? '<span style="color:var(--muted)">Inactivo</span>' : "") + "</div></div>" +
      '<span class="pill ' + de.cls + '"><span class="dot"></span>' + de.label + "</span></div>";
  }).join("") : emptyBox("No hay choferes registrados");

  view.innerHTML =
    '<button class="backlink" id="ch-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Choferes</h2><span class="meta-line num">' + choferes.length + "</span></div>" +
    '<p class="meta-line" style="margin:-6px 2px 12px;font-size:.82rem">Registro de choferes para asignar a los camiones. No requieren cuenta de usuario; puedes vincular una después.</p>' +
    (manage ? '<button class="btn btn-primary section" id="ch-new">' + I.plus + "Registrar chofer</button>" : "") +
    '<div class="card">' + rows + "</div>";

  $("#ch-back", view).onclick = () => ctx.go("home", {});
  const nb = $("#ch-new", view); if (nb) nb.onclick = () => { cfForm = null; ctx.go("choferForm", {}); };
  $$("[data-chofer]", view).forEach(b => b.onclick = () => ctx.go("choferDetail", { id: b.getAttribute("data-chofer") }));
}

// Reconcilia la vinculación chofer-camión (uno a uno) y la refleja en el camión
// (choferId + conductorUid/Nombre), para que el login del conductor funcione
// cuando el chofer está vinculado a un usuario.
async function applyChoferTruck(chofer) {
  const fullName = nombreCompleto(chofer);
  const nxt = chofer.camionId || "";
  const [choferes, trucks] = await Promise.all([store.listChoferes(), store.listTrucksAll()]);
  if (nxt) {
    for (const c of choferes) {
      if (c.id !== chofer.id && (c.camionId || "") === nxt) await store.saveChofer(c.id, Object.assign({}, c, { camionId: null }));
    }
  }
  for (const t of trucks) {
    if (t.choferId === chofer.id && t.id !== nxt) await store.saveTruck(t.id, Object.assign({}, t, { choferId: null, conductorUid: null, conductorNombre: null }));
  }
  if (nxt) {
    const t = trucks.find(x => x.id === nxt);
    if (t) await store.saveTruck(t.id, Object.assign({}, t, { choferId: chofer.id, conductorUid: chofer.usuarioUid || null, conductorNombre: fullName }));
  }
}

async function choferForm(view, ctx) {
  const editing = !!ctx.params.id;
  const c = editing ? await store.getChofer(ctx.params.id) : null;
  const [trucks, users] = await Promise.all([store.listTrucks().catch(() => []), store.listUsers().catch(() => [])]);
  const conductores = users.filter(u => u.role === "conductor");
  if (!cfForm) {
    cfForm = c ? {
      nombre: c.nombre || "", apellidos: c.apellidos || "", activo: c.activo !== false,
      usuarioUid: c.usuarioUid || "", camionId: c.camionId || "",
      docs: Object.assign({ licencia: false, cedula: false, antecedentes: false, otros: false }, c.docs)
    } : { nombre: "", apellidos: "", activo: true, usuarioUid: "", camionId: "", docs: { licencia: false, cedula: false, antecedentes: false, otros: false } };
  }
  const f = cfForm;
  const docChips = DOCS.map(([k, n]) => '<button class="chip' + (f.docs[k] ? " on" : "") + '" data-docflag="' + k + '">' + (f.docs[k] ? I.check : "") + esc(n) + "</button>").join("");
  const userOpts = '<option value="">Sin vincular (crear usuario luego)</option>' + conductores.map(u =>
    '<option value="' + esc(u.uid) + '"' + (f.usuarioUid === u.uid ? " selected" : "") + ">" + esc(u.nombre || u.email) + "</option>").join("");
  const camOpts = '<option value="">Sin camión asignado</option>' + trucks.map(t =>
    '<option value="' + esc(t.id) + '"' + (f.camionId === t.id ? " selected" : "") + ">" + esc(t.num + " · " + t.patente) + "</option>").join("");

  view.innerHTML =
    '<button class="backlink" id="cff-back">' + I.back + " Cancelar</button>" +
    '<div class="subhead"><h2>' + (editing ? "Editar chofer" : "Registrar chofer") + "</h2></div>" +
    '<div class="card pad section">' +
      '<div class="grid2"><label class="fld"><span class="lb">Nombre</span><input class="input" id="cff-nombre" placeholder="Nombre" value="' + esc(f.nombre) + '"></label>' +
      '<label class="fld"><span class="lb">Apellidos</span><input class="input" id="cff-apellidos" placeholder="Apellidos" value="' + esc(f.apellidos) + '"></label></div>' +
    "</div>" +
    '<div class="section"><span class="eyebrow" style="display:block;margin:0 2px 8px">Documentos al día</span>' +
      '<p class="meta-line" style="margin:0 2px 10px;font-size:.8rem">Marca los que están al día.</p>' +
      '<div class="card pad"><div class="chips" id="cff-docs">' + docChips + "</div></div></div>" +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Usuario vinculado (opcional)</span><select class="input" id="cff-user">' + userOpts + "</select>" +
      '<span class="meta-line" style="margin-top:6px">Si lo vinculas a un usuario conductor, ese usuario podrá iniciar sesión y seleccionar el camión asignado.</span></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Camión asignado (opcional)</span><select class="input" id="cff-camion">' + camOpts + "</select>" +
      '<span class="meta-line" style="margin-top:6px">Un chofer se asigna a un solo camión. Si el camión ya tiene otro chofer, ese queda sin asignar.</span></label>' +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="cff-save">' + I.check + (editing ? "Guardar cambios" : "Registrar chofer") + "</button></div>";

  const back = () => { cfForm = null; ctx.go(editing ? "choferDetail" : "choferes", editing ? { id: ctx.params.id } : {}); };
  $("#cff-back", view).onclick = back;
  const bindF = (id, key) => { const el = $(id, view); if (el) el.oninput = () => { f[key] = el.value; }; };
  bindF("#cff-nombre", "nombre"); bindF("#cff-apellidos", "apellidos");
  $$("#cff-docs [data-docflag]", view).forEach(b => b.onclick = () => { syncAll(view); const k = b.getAttribute("data-docflag"); f.docs[k] = !f.docs[k]; choferForm(view, ctx); });
  const us = $("#cff-user", view); if (us) us.onchange = () => { f.usuarioUid = us.value; };
  const cs = $("#cff-camion", view); if (cs) cs.onchange = () => { f.camionId = cs.value; };
  $("#cff-save", view).onclick = async () => {
    syncAll(view);
    if (!f.nombre.trim()) { toast("El nombre es obligatorio", "err"); return; }
    const data = {
      nombre: f.nombre.trim(), apellidos: f.apellidos.trim(), activo: f.activo !== false,
      usuarioUid: f.usuarioUid || null, camionId: f.camionId || null,
      docs: { licencia: !!f.docs.licencia, cedula: !!f.docs.cedula, antecedentes: !!f.docs.antecedentes, otros: !!f.docs.otros }
    };
    if (!editing) { data.createdAt = Date.now(); data.createdBy = ctx.profile.uid; }
    const btn = $("#cff-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    try {
      const id = await store.saveChofer(editing ? ctx.params.id : null, editing ? Object.assign({}, c, data) : data);
      await applyChoferTruck(Object.assign({ id }, data));
      cfForm = null; toast(editing ? "Chofer actualizado" : "Chofer registrado", "ok"); ctx.go("choferes", {});
    } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar"; }
  };
  function syncAll(v) {
    ["nombre", "apellidos"].forEach(k => { const el = $("#cff-" + k, v); if (el) f[k] = el.value; });
    const u = $("#cff-user", v); if (u) f.usuarioUid = u.value;
    const cm = $("#cff-camion", v); if (cm) f.camionId = cm.value;
  }
}

async function choferDetail(view, ctx) {
  const c = await store.getChofer(ctx.params.id);
  if (!c) return list(view, ctx);
  const manage = can(ctx.profile, "truck.manage");
  const [trucks, users] = await Promise.all([store.listTrucks().catch(() => []), store.listUsers().catch(() => [])]);
  const de = docEstado(c);
  const cam = trucks.find(t => t.id === (c.camionId || ""));
  const usr = users.find(u => u.uid === (c.usuarioUid || ""));
  const initials = ((c.nombre || "?").charAt(0) + (c.apellidos || "").charAt(0)).toUpperCase();

  const docRows = DOCS.map(([k, n]) => {
    const ok = !!(c.docs && c.docs[k]);
    return '<div class="doc-row"><div class="dl"><div class="dn">' + esc(n) + "</div></div>" +
      '<span class="pill ' + (ok ? "ok" : "crit") + '"><span class="dot"></span>' + (ok ? "Al día" : "Pendiente") + "</span></div>";
  }).join("");

  view.innerHTML =
    '<button class="backlink" id="cd-back">' + I.back + " Choferes</button>" +
    '<div class="card pad section"><div class="stat-truck"><span class="trucknum" style="background:var(--accent)">' + esc(initials || "CH") + "</span>" +
    '<div style="flex:1"><div style="font-family:Barlow Semi Condensed;font-weight:700;font-size:1.2rem">' + esc(nombreCompleto(c) || "Sin nombre") + "</div>" +
    '<div style="margin-top:5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ' + de.cls + '"><span class="dot"></span>' + de.label + "</span>" +
    (c.activo === false ? '<span class="pill neutral"><span class="dot"></span>Inactivo</span>' : "") + "</div>" +
    '<div class="meta-line" style="margin-top:8px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.users + "</span>Usuario: <b style=\"color:var(--ink)\">" + (usr ? esc(usr.nombre || usr.email) : "Sin vincular") + "</b></div>" +
    '<div class="meta-line" style="margin-top:4px;display:flex;align-items:center;gap:6px"><span style="display:inline-flex;width:15px;height:15px;color:var(--muted)">' + I.truck + "</span>Camión: <b style=\"color:var(--ink)\">" + (cam ? esc(cam.num + " · " + cam.patente) : "Sin asignar") + "</b></div></div></div>" +
    (manage ? '<button class="btn sm btn-soft" style="margin-top:12px" id="cd-asig">' + I.truck + "Cambiar camión asignado</button>" : "") + "</div>" +
    '<div class="section"><span class="eyebrow">Documentos</span><div class="card pad" style="margin-top:8px">' + docRows + "</div></div>" +
    (manage ? '<button class="btn btn-ghost" id="cd-edit">' + I.doc + "Editar datos y documentos</button>" : "");

  $("#cd-back", view).onclick = () => ctx.go("choferes", {});
  const eb = $("#cd-edit", view); if (eb) eb.onclick = () => { cfForm = null; ctx.go("choferForm", { id: c.id }); };
  const ab = $("#cd-asig", view); if (ab) ab.onclick = () => asignarCamion(ctx, c, trucks);
}

// Sheet rápido para asignar/cambiar el camión de un chofer.
function asignarCamion(ctx, chofer, trucks) {
  const opts = '<option value="">Sin camión asignado</option>' + trucks.map(t =>
    '<option value="' + esc(t.id) + '"' + ((chofer.camionId || "") === t.id ? " selected" : "") + ">" + esc(t.num + " · " + t.patente) + "</option>").join("");
  openSheet("Camión del chofer · " + esc(nombreCompleto(chofer)),
    '<p class="meta-line" style="margin:0 0 12px;font-size:.82rem">Un chofer va con un solo camión. Si el camión elegido ya tiene otro chofer, ese queda sin asignar.</p>' +
    '<label class="fld"><span class="lb">Camión</span><select class="input" id="ac-sel">' + opts + "</select></label>" +
    '<button class="btn btn-primary" id="ac-ok" style="width:100%">' + I.check + "Guardar asignación</button>",
    () => {
      $("#ac-ok").onclick = async () => {
        const val = $("#ac-sel").value;
        const btn = $("#ac-ok"); btn.disabled = true; btn.textContent = "Guardando...";
        try {
          const updated = Object.assign({}, chofer, { camionId: val || null });
          await store.saveChofer(chofer.id, updated);
          await applyChoferTruck(updated);
          closeSheet(); toast("Asignación actualizada", "ok"); ctx.go("choferDetail", { id: chofer.id });
        } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar asignación"; }
      };
    });
}
