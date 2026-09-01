// =============================================================
// Roles y permisos
// -------------------------------------------------------------
// Los permisos se agregan de forma incremental: para sumar uno
// nuevo, defínelo en PERMISSIONS y agrégalo a los roles que lo
// tengan. La UI y las reglas de Firestore consultan can(user, ...).
// =============================================================

export const ROLES = {
  conductor:     { label: "Conductor",     rank: 1 },
  secretaria:    { label: "Secretaria",    rank: 2 },
  supervisor:    { label: "Supervisor",    rank: 3 },
  gerente:       { label: "Gerente",       rank: 4 },
  administrador: { label: "Administrador", rank: 5 }
};

// Catálogo de permisos (clave: descripción para referencia).
export const PERMISSIONS = {
  "checklist.create": "Registrar checklist de turno",
  "bitacora.create":  "Registrar novedades en la bitácora",
  "fuel.create":      "Registrar cargas de combustible",
  "trip.create":      "Registrar viajes realizados",
  "truck.select":     "Elegir el camión del turno",
  "history.own":      "Ver el historial del camión que conduce",
  "fleet.view":       "Ver el estado de toda la flota",
  "falla.view":       "Ver las fallas reportadas",
  "truck.manage":     "Registrar y editar camiones y su documentación",
  "product.manage":   "Administrar la lista de productos trasladados",
  "order.manage":     "Crear y gestionar órdenes de taller y costos",
  "reports.view":     "Ver reportes, indicadores y costos",
  "data.import":      "Importar viajes históricos desde Excel",
  "user.manage":      "Administrar usuarios y roles",
  "plan.view":        "Ver la planificación de flota",
  "plan.manage":      "Crear y editar la planificación de flota",
  "reserva.manage":   "Registrar horarios de recepción, planta destino y guías por viaje"
};

// Asignación de permisos por rol. Editar aquí para ampliar.
const ROLE_PERMISSIONS = {
  conductor: [
    "checklist.create", "bitacora.create", "fuel.create", "trip.create",
    "truck.select", "history.own"
  ],
  // La secretaria reserva los horarios de recepción en planta: lee la
  // planificación, la disponibilidad y los choferes asignados, y registra
  // horarios de recepción, planta de destino y guías de despacho por viaje.
  secretaria: [
    "fleet.view", "plan.view", "reserva.manage"
  ],
  supervisor: [
    "fleet.view", "falla.view", "truck.manage", "product.manage", "order.manage",
    "reports.view", "fuel.create", "trip.create", "history.own",
    "plan.view", "plan.manage", "reserva.manage"
  ],
  gerente: [
    "fleet.view", "falla.view", "reports.view", "plan.view"
  ],
  administrador: [
    "checklist.create", "bitacora.create", "fuel.create", "trip.create",
    "truck.select", "history.own",
    "fleet.view", "falla.view", "truck.manage", "product.manage", "order.manage",
    "reports.view", "data.import", "user.manage",
    "plan.view", "plan.manage", "reserva.manage"
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
