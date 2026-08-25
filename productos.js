import { store } from "./store.js";
import { can } from "./permissions.js";
import { PRODUCTS_BASE } from "./productos-base.js";
import { I, esc, emptyBox, toast, openSheet, closeSheet, $, $$ } from "./ui.js";

export async function renderProductos(view, ctx) {
  const manage = can(ctx.profile, "product.manage");
  const products = await store.listProducts();
  const rows = products.length ? products.map(p =>
    '<div class="row"><div class="rl"><div class="t">' + esc(p.codigo) + (p.um ? ' <span class="pill neutral">' + esc(p.um) + "</span>" : "") + '</div><div class="m"><span>' + esc(p.descripcion || "") + "</span><span>" + esc(p.especie || "") + "</span></div></div>" +
    (manage ? '<button class="btn sm btn-soft" data-edit="' + esc(p.id) + '">Editar</button>' : "") + "</div>"
  ).join("") : emptyBox("Aún no hay productos cargados");

  view.innerHTML =
    '<button class="backlink" id="pr-back">' + I.back + " Panel</button>" +
    '<div class="subhead"><h2>Productos trasladados</h2><span class="meta-line num">' + products.length + "</span></div>" +
    (manage ? '<div class="section" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" style="flex:1;min-width:150px" id="pr-new">' + I.plus + "Nuevo producto</button>" +
      '<button class="btn btn-soft" style="flex:1;min-width:150px" id="pr-import">' + I.download + "Importar lista base</button></div>" : "") +
    '<div class="card">' + rows + "</div>" +
    '<p class="meta-line" style="font-size:.78rem;padding:8px 2px">Estos productos aparecen en el buscador al registrar la salida de un viaje. La unidad (M3 o MR) se completa sola al elegir el producto.</p>';

  $("#pr-back", view).onclick = () => ctx.go("home", {});
  const nb = $("#pr-new", view); if (nb) nb.onclick = () => openForm(null);
  const ib = $("#pr-import", view); if (ib) ib.onclick = () => importBase(products);
  $$("[data-edit]", view).forEach(b => b.onclick = () => openForm(products.find(x => x.id === b.getAttribute("data-edit"))));

  async function importBase(existing) {
    const have = new Set(existing.map(p => (p.codigo + "|" + p.descripcion).toLowerCase()));
    const faltan = PRODUCTS_BASE.filter(p => !have.has((p.codigo + "|" + p.descripcion).toLowerCase()));
    if (!faltan.length) { toast("La lista base ya está cargada", "ok"); return; }
    if (!confirm("Se agregarán " + faltan.length + " producto(s) de la lista base. ¿Continuar?")) return;
    const btn = $("#pr-import", view); if (btn) { btn.disabled = true; btn.textContent = "Importando..."; }
    try {
      await Promise.all(faltan.map(p => store.addProduct({ codigo: p.codigo, descripcion: p.descripcion, especie: p.especie, um: p.um })));
      toast(faltan.length + " producto(s) importado(s)", "ok"); ctx.go("productos", {});
    } catch (e) { toast("No se pudo importar: " + (e.message || e), "err"); if (btn) { btn.disabled = false; btn.textContent = "Importar lista base"; } }
  }

  function openForm(p) {
    const um = (p && p.um) || "MR";
    openSheet(p ? "Editar producto" : "Nuevo producto",
      '<label class="fld"><span class="lb">Código</span><input class="input" id="pf-cod" placeholder="Ej: 3232" value="' + esc(p ? p.codigo : "") + '"></label>' +
      '<label class="fld"><span class="lb">Descripción</span><input class="input" id="pf-desc" placeholder="Ej: MR Eucalyptus globulus 3,50 C/C" value="' + esc(p ? p.descripcion : "") + '"></label>' +
      '<label class="fld"><span class="lb">Especie</span><input class="input" id="pf-esp" placeholder="Ej: EUCALYPTUS" value="' + esc(p ? p.especie : "") + '"></label>' +
      '<label class="fld"><span class="lb">Unidad de medida</span><div class="chips" id="pf-um">' +
        ["MR", "M3"].map(u => '<button type="button" class="chip' + (um === u ? " on" : "") + '" data-um="' + u + '">' + u + "</button>").join("") + "</div></label>" +
      '<button class="btn btn-primary" id="pf-save">Guardar</button>',
      () => {
        let selUm = um;
        $$("#pf-um [data-um]").forEach(b => b.onclick = () => { selUm = b.getAttribute("data-um"); $$("#pf-um [data-um]").forEach(x => x.classList.toggle("on", x === b)); });
        $("#pf-save").onclick = async () => {
          const cod = $("#pf-cod").value.trim(), desc = $("#pf-desc").value.trim(), esp = $("#pf-esp").value.trim();
          if (!cod || !desc) { toast("Código y descripción son obligatorios", "err"); return; }
          const data = { codigo: cod, descripcion: desc, especie: esp, um: selUm };
          const btn = $("#pf-save"); btn.disabled = true; btn.textContent = "Guardando...";
          try {
            if (p) await store.saveProduct(p.id, Object.assign({}, p, data)); else await store.addProduct(data);
            closeSheet(); toast("Producto guardado", "ok"); ctx.go("productos", {});
          } catch (e) { toast("No se pudo guardar: " + (e.message || e), "err"); btn.disabled = false; btn.textContent = "Guardar"; }
        };
      }
    );
  }
}
