import { store } from "./store.js";
import { ROLES, roleLabel } from "./permissions.js";
import { I, esc, emptyBox, toast, $, $$ } from "./ui.js";

let form = null;

export async function renderUsuarios(view, ctx) {
  if (ctx.route === "userForm") return userForm(view, ctx);
  return list(view, ctx);
}

async function list(view, ctx) {
  const users = await store.listUsers();
  const rows = users.length ? users.map(u => {
    const ini = (u.nombre || u.email || "?").trim().slice(0, 1).toUpperCase();
    return '<div class="row"><span class="avatar">' + esc(ini) + "</span>" +
      '<div class="rl"><div class="t">' + esc(u.nombre || "(sin nombre)") +
      ' <span class="pill steel">' + esc(roleLabel(u.role)) + "</span>" +
      (u.activo === false ? ' <span class="pill neutral">Inactivo</span>' : "") + "</div>" +
      '<div class="m"><span>' + esc(u.email) + "</span></div></div>" +
      '<button class="btn sm btn-soft" data-toggle="' + esc(u.uid) + '" data-activo="' + (u.activo === false ? "0" : "1") + '">' +
      (u.activo === false ? "Activar" : "Desactivar") + "</button></div>";
  }).join("") : emptyBox("No hay usuarios");

  view.innerHTML =
    '<button class="backlink" id="us-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Usuarios</h2><span class="meta-line num">' + users.length + "</span></div>" +
    '<button class="btn btn-primary section" id="us-new">' + I.plus + "Nuevo usuario</button>" +
    '<div class="card">' + rows + "</div>" +
    (store.mode === "demo" ? '<p class="meta-line" style="margin-top:12px;font-size:.8rem">En modo demo los usuarios se guardan solo en este navegador. Con Firebase, se crean en Authentication y su perfil con rol queda en Firestore.</p>' : "");

  $("#us-back", view).onclick = () => ctx.go("home", {});
  $("#us-new", view).onclick = () => { form = null; ctx.go("userForm", {}); };
  $$("[data-toggle]", view).forEach(b => b.onclick = async () => {
    const uid = b.getAttribute("data-toggle"), activo = b.getAttribute("data-activo") === "1";
    if (uid === ctx.profile.uid) { toast("No puedes desactivar tu propio usuario", "err"); return; }
    try { await store.updateUser(uid, { activo: !activo }); toast("Usuario actualizado", "ok"); list(view, ctx); }
    catch (e) { toast("No se pudo actualizar: " + (e.message || e), "err"); }
  });
}

async function userForm(view, ctx) {
  if (!form) form = { nombre: "", email: "", password: "", role: "conductor" };
  const f = form;
  const roleChips = Object.keys(ROLES).map(r =>
    '<button class="chip' + (f.role === r ? " on" : "") + '" data-role="' + r + '">' + esc(ROLES[r].label) + "</button>").join("");
  view.innerHTML =
    '<button class="backlink" id="uf-back">' + I.back + " Cancelar</button>" +
    '<div class="subhead"><h2>Nuevo usuario</h2></div>' +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Nombre</span><input class="input" id="uf-nombre" placeholder="Nombre y apellido" value="' + esc(f.nombre) + '"></label>' +
      '<label class="fld"><span class="lb">Correo</span><input class="input" id="uf-email" type="email" placeholder="correo@lacabana.cl" value="' + esc(f.email) + '"></label>' +
      '<label class="fld"><span class="lb">Contraseña temporal</span><input class="input" id="uf-pass" placeholder="Mínimo 6 caracteres" value="' + esc(f.password) + '"></label>' +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Rol</span><div class="chips">' + roleChips + "</div></label>" +
    "</div>" +
    '<div class="formbar"><button class="btn btn-primary" id="uf-save">' + I.check + "Crear usuario</button></div>";

  $("#uf-back", view).onclick = () => { form = null; ctx.go("usuarios", {}); };
  const b = (id, k) => { const el = $(id, view); if (el) el.oninput = () => { f[k] = el.value; }; };
  b("#uf-nombre", "nombre"); b("#uf-email", "email"); b("#uf-pass", "password");
  $$("[data-role]", view).forEach(x => x.onclick = () => { syncU(view); f.role = x.getAttribute("data-role"); userForm(view, ctx); });
  $("#uf-save", view).onclick = async () => {
    syncU(view);
    if (!f.nombre.trim() || !f.email.trim()) { toast("Nombre y correo son obligatorios", "err"); return; }
    if ((f.password || "").length < 6) { toast("La contraseña debe tener al menos 6 caracteres", "err"); return; }
    const btn = $("#uf-save", view); btn.disabled = true; btn.textContent = "Creando...";
    try {
      await store.createUser({ email: f.email.trim(), password: f.password, nombre: f.nombre.trim(), role: f.role });
      form = null; toast("Usuario creado", "ok"); ctx.go("usuarios", {});
    } catch (e) { toast("No se pudo crear: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Crear usuario"; }
  };
}
function syncU(view) { const g = (id, k) => { const el = $(id, view); if (el) form[k] = el.value; }; g("#uf-nombre", "nombre"); g("#uf-email", "email"); g("#uf-pass", "password"); }
