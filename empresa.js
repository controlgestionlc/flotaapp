import { store } from "./store.js";
import { I, esc, toast, $ } from "./ui.js";

export async function renderEmpresa(view, ctx) {
  const co = await store.getCompany();
  const draft = { nombre: co.nombre || "", app: co.app || "", logo: co.logo || "" };

  function paint() {
    view.innerHTML =
      '<button class="backlink" id="em-back">' + I.back + " Panel</button>" +
      '<div class="subhead"><h2>Datos de la empresa</h2></div>' +
      '<div class="card pad section">' +
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
          '<div style="width:64px;height:64px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line-strong);overflow:hidden;display:grid;place-items:center;flex:none">' +
            (draft.logo ? '<img src="' + esc(draft.logo) + '" style="width:100%;height:100%;object-fit:cover">' : '<span class="meta-line" style="font-size:.68rem;text-align:center">Sin<br>logo</span>') +
          "</div>" +
          '<div style="flex:1"><input type="file" id="em-file" accept="image/*" style="display:none">' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm btn-soft" id="em-upload">' + I.plus + "Subir logo</button>" +
            (draft.logo ? '<button class="btn sm btn-soft" id="em-remove" style="color:var(--crit)">Quitar</button>' : "") + "</div>" +
            '<div class="meta-line" style="font-size:.76rem;margin-top:6px">Se guarda reducido (máx 240 px).</div>' +
          "</div>" +
        "</div>" +
        '<label class="fld"><span class="lb">Nombre de la empresa</span><input class="input" id="em-nombre" value="' + esc(draft.nombre) + '"></label>' +
        '<label class="fld" style="margin-bottom:0"><span class="lb">Nombre de la app</span><input class="input" id="em-app" value="' + esc(draft.app) + '"></label>' +
      "</div>" +
      '<div class="formbar"><button class="btn btn-primary" id="em-save">' + I.check + "Guardar</button></div>";

    $("#em-back", view).onclick = () => ctx.go("home", {});
    $("#em-nombre", view).oninput = e => { draft.nombre = e.target.value; };
    $("#em-app", view).oninput = e => { draft.app = e.target.value; };
    $("#em-upload", view).onclick = () => $("#em-file", view).click();
    $("#em-file", view).onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (f) resizeImage(f, 240, url => { draft.logo = url; paint(); });
    };
    const rm = $("#em-remove", view); if (rm) rm.onclick = () => { draft.logo = ""; paint(); };
    $("#em-save", view).onclick = async () => {
      if (!draft.nombre.trim() || !draft.app.trim()) { toast("Completa el nombre de la empresa y de la app", "err"); return; }
      const btn = $("#em-save", view); btn.disabled = true; btn.textContent = "Guardando...";
      try {
        await store.saveCompany({ nombre: draft.nombre.trim(), app: draft.app.trim(), logo: draft.logo || "" });
        await ctx.reloadCompany();
        toast("Datos de empresa guardados", "ok");
        ctx.go("home", {});
      } catch (err) { toast("No se pudo guardar: " + (err.message || err), "err"); btn.disabled = false; btn.textContent = "Guardar"; }
    };
  }
  paint();
}

// Redimensiona la imagen a un data URL pequeño (para guardar en Firestore sin Storage).
function resizeImage(file, max, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      let out;
      try { out = c.toDataURL("image/webp", 0.85); if (!out || out.indexOf("data:image/webp") !== 0) out = c.toDataURL("image/png"); }
      catch (e) { out = c.toDataURL("image/png"); }
      cb(out);
    };
    img.onerror = () => toast("No se pudo leer la imagen", "err");
    img.src = reader.result;
  };
  reader.onerror = () => toast("No se pudo leer el archivo", "err");
  reader.readAsDataURL(file);
}
