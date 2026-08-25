// =============================================================
// Punto de entrada: arranque, sesión, shell, router e historial.
// =============================================================
import { store } from "./store.js";
import { can, roleLabel } from "./permissions.js";
import { I, esc, applyTheme, toggleTheme, toast, setDocDias } from "./ui.js";
import { renderLogin } from "./login.js";
import { renderConductor } from "./conductor.js";
import { renderPanel } from "./panel.js";
import { renderCamiones } from "./camiones.js";
import { renderUsuarios } from "./usuarios.js";
import { renderReportes } from "./reportes.js";
import { renderEmpresa } from "./empresa.js";
import { renderResumen } from "./resumen.js";
import { renderProductos } from "./productos.js";
import { renderImportar } from "./importar.js";
import { renderMantencion } from "./mantencion.js";
import { renderAlertas } from "./alertas.js";

const APP = document.getElementById("app");

let COMPANY = { nombre: "Transportes La Cabaña", app: "Bitácora de Camiones", logo: "" };

export const ctx = {
  profile: null,
  route: "home",
  params: {},
  company() { return COMPANY; },
  async reloadCompany() { try { COMPANY = await store.getCompany(); setDocDias(COMPANY.avisoDias || 30); } catch (e) {} },
  go(route, params) {
    this.route = route; this.params = params || {};
    try { history.pushState({ bf: "sub", route, params: this.params }, ""); } catch (e) {}
    window.scrollTo(0, 0); renderShell();
  },
  selectedTruck() { try { return localStorage.getItem("bf_truck_" + (this.profile ? this.profile.uid : "x")); } catch (e) { return null; } },
  setTruck(id) { try { id ? localStorage.setItem("bf_truck_" + this.profile.uid, id) : localStorage.removeItem("bf_truck_" + this.profile.uid); } catch (e) {} }
};

function isHome() {
  return !!ctx.profile && ctx.route === "home" && (!ctx.params.screen || ctx.params.screen === "home");
}

function appbar(sub, showExit) {
  const themeIcon = document.documentElement.getAttribute("data-theme") === "dark" ? I.sun : I.moon;
  const logo = COMPANY.logo
    ? '<img class="logo" src="' + esc(COMPANY.logo) + '" alt="logo" style="border-radius:6px;object-fit:cover">'
    : '<svg class="logo" viewBox="0 0 24 24" fill="none" stroke="#F5871F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4l3 3v4h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>';
  return '<header class="appbar">' + logo +
    '<div class="brand"><div class="k">' + esc(COMPANY.app) + '</div><div class="s">' + esc(sub || COMPANY.nombre) + "</div></div>" +
    '<button class="iconbtn" id="btn-theme" title="Tema">' + themeIcon + "</button>" +
    (showExit ? '<button class="iconbtn" id="btn-exit" title="Cerrar sesión">' + I.logout + "</button>" : "") +
    "</header>";
}

function bindChrome() {
  const bt = document.getElementById("btn-theme");
  if (bt) bt.onclick = () => { toggleTheme(); renderShell(); };
  const be = document.getElementById("btn-exit");
  if (be) be.onclick = async () => {
    if (confirm("¿Cerrar sesión?")) { await store.logout(); ctx.profile = null; ctx.route = "home"; ctx.params = {}; renderShell(); }
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
  if (p.role === "conductor") return renderConductor(view, ctx);
  if (r === "camiones" || r === "truckForm" || r === "truckDetail") return renderCamiones(view, ctx);
  if (r === "mantencion") {
    if (!can(p, "truck.manage")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderMantencion(view, ctx);
  }
  if (r === "alertas") {
    if (!can(p, "fleet.view")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderAlertas(view, ctx);
  }
  if (r === "resumen") return renderResumen(view, ctx);
  if (r === "usuarios" || r === "userForm") {
    if (!can(p, "user.manage")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderUsuarios(view, ctx);
  }
  if (r === "empresa") {
    if (!can(p, "user.manage")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderEmpresa(view, ctx);
  }
  if (r === "productos") {
    if (!can(p, "product.manage")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderProductos(view, ctx);
  }
  if (r === "importar") {
    if (!can(p, "data.import")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderImportar(view, ctx);
  }
  if (r === "reportes") {
    if (!can(p, "reports.view")) { ctx.route = "home"; return renderPanel(view, ctx); }
    return renderReportes(view, ctx);
  }
  return renderPanel(view, ctx);
}

// ---- historial / botón atrás ----
// Deja dos entradas: una "base" (para atrapar el atrás) y "home".
function setupHistory() {
  try { history.replaceState({ bf: "base" }, ""); history.pushState({ bf: "home" }, ""); } catch (e) {}
}
function onPop(e) {
  const st = (e && e.state) || {};
  if (!ctx.profile) return; // en login, dejar salir
  if (st.bf === "sub" && st.route) {
    ctx.route = st.route; ctx.params = st.params || {}; window.scrollTo(0, 0); renderShell();
    return;
  }
  if (st.bf === "home") {
    ctx.route = "home"; ctx.params = {}; window.scrollTo(0, 0); renderShell();
    return;
  }
  // st.bf === "base" (o desconocido): intento de salir desde el menú principal
  if (confirm("¿Cerrar la aplicación?")) {
    try { history.back(); } catch (e2) {}
  } else {
    try { history.pushState({ bf: "home" }, ""); } catch (e2) {}
    ctx.route = "home"; ctx.params = {}; window.scrollTo(0, 0); renderShell();
  }
}

async function onLogin(email, password, btn) {
  try {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Ingresando..."; }
    ctx.profile = await store.login(email, password);
    ctx.route = "home"; ctx.params = {};
    setupHistory();
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
    await ctx.reloadCompany();
    ctx.profile = store.currentProfile();
  } catch (e) {
    APP.innerHTML = '<div class="login-wrap"><div class="banner">' + I.alert +
      "<div>No se pudo iniciar la app: " + esc(e.message || e) + "</div></div></div>";
    return;
  }
  window.addEventListener("popstate", onPop);
  if (ctx.profile) setupHistory();
  await renderShell();
})();
