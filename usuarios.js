import { store } from "./store.js";
import { ROLES, roleLabel, PERMISSIONS, allPerms, permsForRole } from "./permissions.js";
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
    const custom = Array.isArray(u.perms);
    return '<div class="row"><span class="avatar">' + esc(ini) + "</span>" +
      '<div class="rl"><div class="t">' + esc(u.nombre || "(sin nombre)") +
      ' <span class="pill steel">' + esc(roleLabel(u.role)) + "</span>" +
      (custom ? ' <span class="pill warn">Permisos propios</span>' : "") +
      (u.activo === false ? ' <span class="pill neutral">Inactivo</span>' : "") + "</div>" +
      '<div class="m"><span>' + esc(u.email) + "</span></div></div>" +
      '<div style="display:flex;gap:6px"><button class="btn sm btn-soft" data-edit="' + esc(u.uid) + '">Editar</button>' +
      '<button class="btn sm btn-soft" data-toggle="' + esc(u.uid) + '" data-activo="' + (u.activo === false ? "0" : "1") + '">' +
      (u.activo === false ? "Activar" : "Desactivar") + "</button></div></div>";
  }).join("") : emptyBox("No hay usuarios");

  view.innerHTML =
    '<button class="backlink" id="us-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Usuarios</h2><span class="meta-line num">' + users.length + "</span></div>" +
    '<button class="btn btn-primary section" id="us-new">' + I.plus + "Nuevo usuario</button>" +
    '<div class="card">' + rows + "</div>" +
    (store.mode === "demo" ? '<p class="meta-line" style="margin-top:12px;font-size:.8rem">En modo demo los usuarios se guardan solo en este navegador. Con Firebase, se crean en Authentication y su perfil con rol queda en Firestore.</p>' : "");

  $("#us-back", view).onclick = () => ctx.go("home", {});
  $("#us-new", view).onclick = () => { form = null; ctx.go("userForm", {}); };
  $$("[data-edit]", view).forEach(b => b.onclick = () => { form = null; ctx.go("userForm", { id: b.getAttribute("data-edit") }); });
  $$("[data-toggle]", view).forEach(b => b.onclick = async () => {
    const uid = b.getAttribute("data-toggle"), activo = b.getAttribute("data-activo") === "1";
    if (uid === ctx.profile.uid) { toast("No puedes desactivar tu propio usuario", "err"); return; }
    try { await store.updateUser(uid, { activo: !activo }); toast("Usuario actualizado", "ok"); list(view, ctx); }
    catch (e) { toast("No se pudo actualizar: " + (e.message || e), "err"); }
  });
}

async function userForm(view, ctx) {
  const editing = !!ctx.params.id;
  if (!form) {
    if (editing) {
      const u = (await store.listUsers()).find(x => x.uid === ctx.params.id) || {};
      form = {
        editing: true, uid: u.uid, nombre: u.nombre || "", email: u.email || "", role: u.role || "conductor",
        custom: Array.isArray(u.perms), perms: Array.isArray(u.perms) ? u.perms.slice() : [], activo: u.activo !== false
      };
    } else {
      form = { editing: false, nombre: "", email: "", password: "", role: "conductor", custom: false, perms: [] };
    }
  }
  const f = form;
  const roleChips = Object.keys(ROLES).map(r =>
    '<button class="chip' + (f.role === r ? " on" : "") + '" data-role="' + r + '">' + esc(ROLES[r].label) + "</button>").join("");

  // Editor de permisos (opcional). Por defecto usa los del rol.
  const permItems = allPerms().map(k =>
    '<label class="perm-row"><input type="checkbox" data-perm="' + k + '"' + (f.perms.includes(k) ? " checked" : "") + '><span>' + esc(PERMISSIONS[k]) + "</span></label>").join("");
  const permsCard =
    '<div class="card pad section"><span class="eyebrow" style="display:block;margin-bottom:10px">Permisos</span>' +
    '<label class="perm-row" style="border:0;padding:0"><input type="checkbox" id="uf-custom"' + (f.custom ? " checked" : "") + '>' +
      '<span><b>Personalizar permisos de este usuario</b><br><span class="meta-line" style="font-size:.8rem">Si está apagado, usa los permisos del rol ' + esc(roleLabel(f.role)) + ".</span></span></label>" +
    (f.custom ? '<div class="perm-list" style="margin-top:12px">' + permItems + "</div>" : "") + "</div>";

  view.innerHTML =
    '<button class="backlink" id="uf-back">' + I.back + " Cancelar</button>" +
    '<div class="subhead"><h2>' + (editing ? "Editar usuario" : "Nuevo usuario") + "</h2></div>" +
    '<div class="card pad section">' +
      '<label class="fld"><span class="lb">Nombre</span><input class="input" id="uf-nombre" placeholder="Nombre y apellido" value="' + esc(f.nombre) + '"></label>' +
      '<label class="fld"><span class="lb">Correo</span><input class="input" id="uf-email" type="email" placeholder="correo@lacabana.cl" value="' + esc(f.email) + '"' + (editing ? " disabled" : "") + "></label>" +
      (editing ? "" : '<label class="fld"><span class="lb">Contraseña temporal</span><input class="input" id="uf-pass" placeholder="Mínimo 6 caracteres" value="' + esc(f.password || "") + '"></label>') +
      '<label class="fld" style="margin-bottom:0"><span class="lb">Rol</span><div class="chips">' + roleChips + "</div></label>" +
    "</div>" +
    permsCard +
    '<div class="formbar"><button class="btn btn-primary" id="uf-save">' + I.check + (editing ? "Guardar cambios" : "Crear usuario") + "</button></div>";

  $("#uf-back", view).onclick = () => { form = null; ctx.go("usuarios", {}); };
  const b = (id, k) => { const el = $(id, view); if (el) el.oninput = () => { f[k] = el.value; }; };
  b("#uf-nombre", "nombre"); b("#uf-email", "email"); b("#uf-pass", "password");
  $$("[data-role]", view).forEach(x => x.onclick = () => { syncU(view); f.role = x.getAttribute("data-role"); userForm(view, ctx); });
  const cu = $("#uf-custom", view);
  if (cu) cu.onchange = () => {
    syncU(view);
    f.custom = cu.checked;
    // Al activar por primera vez, parte desde los permisos del rol.
    if (f.custom && !f.perms.length) f.perms = [...permsForRole(f.role)];
    userForm(view, ctx);
  };
  $$("[data-perm]", view).forEach(chk => chk.onchange = () => {
    const k = chk.getAttribute("data-perm");
    if (chk.checked) { if (!f.perms.includes(k)) f.perms.push(k); }
    else f.perms = f.perms.filter(x => x !== k);
  });

  $("#uf-save", view).onclick = async () => {
    syncU(view);
    if (!f.nombre.trim()) { toast("El nombre es obligatorio", "err"); return; }
    const btn = $("#uf-save", view); btn.disabled = true; btn.textContent = "Guardando...";
    const permsField = f.custom ? f.perms : null; // null → usa los del rol
    try {
      if (editing) {
        await store.updateUser(f.uid, { nombre: f.nombre.trim(), role: f.role, perms: permsField });
        form = null; toast("Usuario actualizado", "ok"); ctx.go("usuarios", {});
      } else {
        if (!f.email.trim()) { toast("El correo es obligatorio", "err"); btn.disabled = false; btn.textContent = "Crear usuario"; return; }
        if ((f.password || "").length < 6) { toast("La contraseña debe tener al menos 6 caracteres", "err"); btn.disabled = false; btn.textContent = "Crear usuario"; return; }
        await store.createUser({ email: f.email.trim(), password: f.password, nombre: f.nombre.trim(), role: f.role, perms: permsField });
        form = null; toast("Usuario creado", "ok"); ctx.go("usuarios", {});
      }
    } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = editing ? "Guardar cambios" : "Crear usuario"; }
  };
}
function syncU(view) {
  const g = (id, k) => { const el = $(id, view); if (el) form[k] = el.value; };
  g("#uf-nombre", "nombre"); g("#uf-email", "email"); g("#uf-pass", "password");
  const cu = $("#uf-custom", view); if (cu) form.custom = cu.checked;
  $$("[data-perm]", view).forEach(chk => {
    const k = chk.getAttribute("data-perm");
    if (chk.checked) { if (!form.perms.includes(k)) form.perms.push(k); }
    else form.perms = form.perms.filter(x => x !== k);
  });
}
