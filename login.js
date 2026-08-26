import { store } from "./store.js";
import { I, esc, toggleTheme } from "./ui.js";

export async function renderLogin(host, ctx, onLogin) {
  const demo = store.mode === "demo";
  const co = ctx.company ? ctx.company() : { nombre: "Transportes La Cabaña", app: "Bitácora de Camiones", logo: "" };
  const logo = co.logo
    ? '<div class="login-logo" style="background:var(--surface-2);border:1px solid var(--line);overflow:hidden"><img src="' + esc(co.logo) + '" alt="logo" style="width:100%;height:100%;object-fit:cover"></div>'
    : '<div class="login-logo"><svg viewBox="0 0 24 24" fill="none" stroke="#F5871F" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4l3 3v4h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg></div>';
  host.innerHTML =
    '<div class="login-wrap">' +
      '<div class="login-card">' +
        logo +
        '<span class="eyebrow">' + esc(co.nombre) + "</span>" +
        '<h1 style="font-size:1.9rem;margin:6px 0 4px">' + esc(co.app) + "</h1>" +
        '<p class="meta-line" style="margin:0 0 22px">Ingresa con tus credenciales para continuar.</p>' +
        '<label class="fld"><span class="lb">Correo</span><input class="input" id="lg-email" type="email" autocomplete="username" placeholder="tucorreo@lacabana.cl" value="' + (demo ? "conductor@lacabana.cl" : "") + '"></label>' +
        '<label class="fld"><span class="lb">Contraseña</span><input class="input" id="lg-pass" type="password" autocomplete="current-password" placeholder="••••••••" value="' + (demo ? "chofer123" : "") + '"></label>' +
        '<button class="btn btn-primary" id="lg-btn" style="width:100%">' + I.logout + "Ingresar</button>" +
        (demo ? demoNote() : "") +
      "</div>" +
    "</div>";

  const email = host.querySelector("#lg-email");
  const pass = host.querySelector("#lg-pass");
  const btn = host.querySelector("#lg-btn");
  const submit = () => onLogin(email.value.trim(), pass.value, btn);
  btn.onclick = submit;
  pass.onkeydown = e => { if (e.key === "Enter") submit(); };
  host.querySelectorAll("[data-fill]").forEach(b => b.onclick = () => {
    const [em, pw] = b.getAttribute("data-fill").split("|");
    email.value = em; pass.value = pw; submit();
  });
}

function demoNote() {
  const users = [
    ["Administrador", "admin@lacabana.cl", "admin123"],
    ["Supervisor", "supervisor@lacabana.cl", "super123"],
    ["Gerente", "gerente@lacabana.cl", "gerente123"],
    ["Conductor", "conductor@lacabana.cl", "chofer123"]
  ];
  return '<div class="demo-note"><b>Modo demostración</b> (sin Firebase). Prueba cada rol:' +
    '<div style="margin-top:10px;display:grid;gap:6px">' +
    users.map(u =>
      '<button class="btn sm btn-soft" style="width:100%;justify-content:space-between" data-fill="' + esc(u[1]) + "|" + esc(u[2]) + '">' +
      "<span>" + esc(u[0]) + "</span><span class='meta-line'>" + esc(u[1]) + "</span></button>"
    ).join("") +
    "</div></div>";
}
