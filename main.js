// =============================================================
// Punto de entrada: arranque, sesión, shell y router.
// =============================================================
import { store } from "./store.js";
import { can, roleLabel } from "./permissions.js";
import { I, esc, applyTheme, toggleTheme, toast } from "./ui.js";
import { renderLogin } from "./login.js";
import { renderConductor } from "./conductor.js";
import { renderPanel } from "./panel.js";
import { renderCamiones } from "./camiones.js";
import { renderUsuarios } from "./usuarios.js";

const APP = document.getElementById("app");

export const ctx = {
  profile: null,
  route: "home",
  params: {},
  go(route, params) { this.route = route; this.params = params || {}; window.scrollTo(0, 0); renderShell(); },
  // camión del turno, por usuario y dispositivo
  selectedTruck() { try { return localStorage.getItem("bf_truck_" + (this.profile ? this.profile.uid : "x")); } catch (e) { return null; } },
  setTruck(id) { try { id ? localStorage.setItem("bf_truck_" + this.profile.uid, id) : localStorage.removeItem("bf_truck_" + this.profile.uid); } catch (e) {} }
};

function appbar(sub, showExit) {
  const themeIcon = document.documentElement.getAttribute("data-theme") === "dark" ? I.sun : I.moon;
  return '<header class="appbar">' +
    '<svg class="logo" viewBox="0 0 24 24" fill="none" stroke="#F5871F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4l3 3v4h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>' +
    '<div class="brand"><div class="k">Bitácora de Flota</div><div class="s">' + esc(sub || "La Cabaña Forestal") + "</div></div>" +
    '<button class="iconbtn" id="btn-theme" title="Tema">' + themeIcon + "</button>" +
    (showExit ? '<button class="iconbtn" id="btn-exit" title="Cerrar sesión">' + I.logout + "</button>" : "") +
    "</header>";
}

function bindChrome() {
  const bt = document.getElementById("btn-theme");
  if (bt) bt.onclick = () => { toggleTheme(); renderShell(); };
  const be = document.getElementById("btn-exit");
  if (be) be.onclick = async () => {
    if (confirm("¿Cerrar sesión?")) { await store.logout(); ctx.profile = null; ctx.route = "home"; renderShell(); }
  };
}

async function renderShell() {
  applyTheme();
  if (!ctx.profile) {
    APP.innerHTML = "";
    await renderLogin(APP, ctx, onLogin);
    return;
  }
  const p = ctx.profile;
  let sub = roleLabel(p.role);
  if (p.role === "conductor") sub = p.nombre;
  APP.innerHTML = appbar(sub, true) + '<main class="main" id="view"></main>';
  bindChrome();
  const view = document.getElementById("view");
  try {
    await routeTo(view);
  } catch (e) {
    view.innerHTML = '<div class="banner">' + I.alert + "<div>Ocurrió un error cargando esta vista: " + esc(e.message || e) + "</div></div>";
  }
}

async function routeTo(view) {
  const p = ctx.profile, r = ctx.route;
  // Conductor
  if (p.role === "conductor") return renderConductor(view, ctx);
  // Camiones (supervisor/admin gestionan; otros ven)
  if (r === "camiones" || r === "truckForm" || r === "truckDetail") return renderCamiones(view, ctx);
  // Usuarios (solo user.manage)
  if (r === "usuarios" || r === "userForm") {
    if (!can(p, "user.manage")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderUsuarios(view, ctx);
  }
  // Panel supervisor / gerente / administrador (home + órdenes)
  return renderPanel(view, ctx);
}

async function onLogin(email, password, btn) {
  try {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Ingresando..."; }
    ctx.profile = await store.login(email, password);
    ctx.route = "home";
    await renderShell();
  } catch (e) {
    toast(e.message || "No se pudo iniciar sesión", "err");
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || "Ingresar"; }
  }
}

// arranque
(async function boot() {
  applyTheme();
  APP.innerHTML = '<div class="login-wrap"><div class="meta-line">Cargando...</div></div>';
  try {
    await store.init();
    ctx.profile = store.currentProfile();
  } catch (e) {
    APP.innerHTML = '<div class="login-wrap"><div class="banner">' + I.alert +
      "<div>No se pudo iniciar la app: " + esc(e.message || e) + "</div></div></div>";
    return;
  }
  await renderShell();
})();
