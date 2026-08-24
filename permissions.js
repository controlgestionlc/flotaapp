// =============================================================
// Roles y permisos
// -------------------------------------------------------------
// Los permisos se agregan de forma incremental: para sumar uno
// nuevo, defínelo en PERMISSIONS y agrégalo a los roles que lo
// tengan. La UI y las reglas de Firestore consultan can(user, ...).
// =============================================================

export const ROLES = {
  conductor:     { label: "Conductor",     rank: 1 },
  supervisor:    { label: "Supervisor",    rank: 2 },
  gerente:       { label: "Gerente",       rank: 3 },
  administrador: { label: "Administrador", rank: 4 }
};

// Catálogo de permisos (clave: descripción para referencia).
export const PERMISSIONS = {
  "checklist.create": "Registrar checklist de turno",
  "bitacora.create":  "Registrar novedades en la bitácora",
  "truck.select":     "Elegir el camión del turno",
  "history.own":      "Ver el historial del camión que conduce",
  "fleet.view":       "Ver el estado de toda la flota",
  "falla.view":       "Ver las fallas reportadas",
  "truck.manage":     "Registrar y editar camiones y su documentación",
  "order.manage":     "Crear y gestionar órdenes de taller y costos",
  "reports.view":     "Ver reportes y costos",
  "user.manage":      "Administrar usuarios y roles"
};

// Asignación de permisos por rol. Editar aquí para ampliar.
const ROLE_PERMISSIONS = {
  conductor: [
    "checklist.create", "bitacora.create", "truck.select", "history.own"
  ],
  supervisor: [
    "fleet.view", "falla.view", "truck.manage", "order.manage",
    "reports.view", "history.own"
  ],
  gerente: [
    "fleet.view", "falla.view", "reports.view"
  ],
  administrador: [
    "checklist.create", "bitacora.create", "truck.select", "history.own",
    "fleet.view", "falla.view", "truck.manage", "order.manage",
    "reports.view", "user.manage"
  ]
};

export function permsForRole(role) {
  return new Set(ROLE_PERMISSIONS[role] || []);
}

// ¿Puede este usuario ejecutar la acción?
export function can(user, perm) {
  if (!user || !user.role) return false;
  return permsForRole(user.role).has(perm);
}

export function roleLabel(role) {
  return (ROLES[role] && ROLES[role].label) || role || "Sin rol";
}
