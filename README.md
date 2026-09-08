# Bitácora de Camiones

App web móvil (PWA) para gestionar la mantención preventiva y correctiva, y la operación diaria de una flota de camiones (Transportes La Cabaña). Los conductores registran el checklist de inicio de turno, los viajes y las novedades con ubicación GPS; supervisores y administradores gestionan camiones, documentación, fallas, órdenes de taller con sus costos, planificación semanal, clima y reservas de recepción en planta.

Construida con **HTML + JavaScript modular (ES modules) + Firebase** (Authentication + Firestore), sin paso de build. Se abre directamente en el navegador, es instalable como app (PWA) y se despliega en Firebase Hosting o GitHub Pages.

**Versión actual: 1.3.8**

## Novedades recientes (resumen)

- **PWA instalable y versionada.** Funciona al cambiar de app o con señal intermitente. Al publicar una versión nueva aparece el botón "Actualizar" en los equipos.
- **Menú lateral izquierdo** con el ítem "Panel" (KPIs, disponibilidad de flota, alertas y órdenes). Las alertas y las órdenes se abren en panel lateral (drawer); en PC las ventanas quedan centradas y el ancho se aprovecha mejor.
- **Planificación de flota:** matriz semanal, operación del día, plan vs. real, faenas, imprevistos, asignación automática (capacidad 18 MR / 20 M3, viajes por día y días de operación por faena), objetivo de metros y avance, reprogramación por falla. El detalle semanal se imprime o exporta a PDF.
- **Clima por faena (Open-Meteo, sin API key):** pronóstico de 7 días con lluvia y temperatura máx/mín como señal de riesgo (el encargado confirma, nunca cierra faenas solo). **Historial de clima** por faena y por día desde el 1 de agosto de 2026, con actualización automática diaria e impresión.
- **Recepción en planta (perfil Secretaria):** reserva de horario de recepción, planta de destino y guía de despacho por cada viaje (vuelta). Aparece un check en la planificación diaria y semanal cuando el día queda completo. Si el chofer ingresa una guía distinta a la reservada, se marca en rojo.
- **Asignación de chofer por camión:** el conductor solo puede seleccionar su camión asignado (ve el estado de los demás) y puede tomar uno de reserva si el suyo está en taller.
- **Documento vencido = fuera de servicio automático:** si un camión tiene cualquier documento vencido (permiso de circulación, SOAP, revisión técnica u otros), queda automáticamente fuera de servicio: aparece en rojo en el panel, no es seleccionable por el conductor y no entra en la asignación de la planificación hasta regularizar el documento.
- **Gestionar novedad:** al tocar una falla reportada en Disponibilidad se elige entre crear la orden de taller o descartarla indicando el motivo.
- **Órdenes de taller:** creación con todos los datos, gestión y cierre (trabajo realizado, repuestos, mano de obra, otros gastos y costo total sumado en vivo), con todos los montos como enteros con separador de miles. Impresión con **logo y datos de la empresa**. Una falla reportada se puede convertir en orden tocándola; la novedad desaparece solo si la orden se guarda.
- **Permisos por usuario:** además del rol, cada usuario puede tener permisos personalizados desde la pantalla Usuarios.

## Modo demostración (sin Firebase)

Mientras `public/js/config.js` tenga los valores de ejemplo, la app corre en **modo demo**: guarda todo en el `localStorage` del navegador con datos de ejemplo, para probarla sin configurar nada.

Para probar localmente:

```bash
cd public
python3 -m http.server 8080
# abre http://localhost:8080
```

> Usa un servidor local (no `file://`) porque la app carga módulos ES.

Usuarios de prueba (botones en la pantalla de login):

| Rol           | Correo                    | Contraseña  |
|---------------|---------------------------|-------------|
| Administrador | admin@lacabana.cl         | admin123    |
| Supervisor    | supervisor@lacabana.cl    | super123    |
| Gerente       | gerente@lacabana.cl       | gerente123  |
| Secretaria    | secretaria@lacabana.cl    | secre123    |
| Conductor     | conductor@lacabana.cl     | chofer123   |

## Roles y permisos

Los roles y permisos están en `public/js/permissions.js`. La matriz es **extensible**: para sumar un permiso nuevo lo defines en `PERMISSIONS` y lo agregas a los roles que lo tengan. La interfaz consulta `can(user, permiso)` y las reglas de Firestore validan lo mismo por rol.

Además del rol, cada usuario puede tener **permisos propios** (campo `perms` en su documento): si están definidos, mandan sobre los del rol. Se configuran en la pantalla Usuarios (Editar usuario → "Personalizar permisos").

| Permiso           | Conductor | Secretaria | Supervisor | Gerente | Administrador |
|-------------------|:---------:|:----------:|:----------:|:-------:|:-------------:|
| checklist.create  |     ✓     |            |            |         |       ✓       |
| bitacora.create   |     ✓     |            |            |         |       ✓       |
| fuel.create       |     ✓     |            |     ✓      |         |       ✓       |
| trip.create       |     ✓     |            |     ✓      |         |       ✓       |
| truck.select      |     ✓     |            |            |         |       ✓       |
| history.own       |     ✓     |            |     ✓      |         |       ✓       |
| fleet.view        |           |     ✓      |     ✓      |    ✓    |       ✓       |
| falla.view        |           |            |     ✓      |    ✓    |       ✓       |
| truck.manage      |           |            |     ✓      |         |       ✓       |
| product.manage    |           |            |     ✓      |         |       ✓       |
| order.manage      |           |            |     ✓      |         |       ✓       |
| reports.view      |           |            |     ✓      |    ✓    |       ✓       |
| plan.view         |           |     ✓      |     ✓      |    ✓    |       ✓       |
| plan.manage       |           |            |     ✓      |         |       ✓       |
| reserva.manage    |           |     ✓      |     ✓      |         |       ✓       |
| data.import       |           |            |            |         |       ✓       |
| user.manage       |           |            |            |         |       ✓       |

El Gerente tiene una vista de supervisión de solo lectura. La Secretaria lee planificación y disponibilidad, y registra las reservas de recepción (horarios, planta y guías).

## Identificación de usuario y dispositivo

- **Usuario:** el UID de Firebase Authentication (estable por persona).
- **Dispositivo:** un `deviceId` persistente que se genera una vez por navegador/dispositivo y se guarda en `localStorage` (`bf_device_id`).

Cada checklist y cada registro de bitácora quedan sellados con el `uid` del usuario y el `deviceId`. Al iniciar sesión, la app registra/actualiza el dispositivo en la colección `devices`.

## Modelo de datos (Firestore)

- `users/{uid}` — perfil: `email`, `nombre`, `role`, `activo`, `createdAt`, `perms?` (permisos propios opcionales).
- `devices/{deviceId}` — `ultimoUid`, `ultimoUso`, `userAgent`.
- `trucks/{id}` — `num`, `patente`, `marca`, `modelo`, `anio`, `activo`, `docs`, `conductorUid?`, `conductorNombre?`.
  - `docs.permisoCirculacion`, `docs.soap`, `docs.revisionTecnica` = `{ numero, vence }`; `docs.otros` = lista de `{ nombre, numero, vence }`.
- `checklists/{id}` — `truckId`, `uid`, `deviceId`, `driverNombre`, `ts`, `items`, `fails`, `gps`, `obs`.
- `bitacora/{id}` — `truckId`, `uid`, `deviceId`, `driverNombre`, `ts`, `tipo`, `sev`, `desc`, `gps`.
- `fuel/{id}` — cargas de combustible: `truckId`, `km`, `litros`, `precioLitro`, `total`, `fecha`.
- `trips/{id}` — viajes: origen/predio, `plantaDestino`, `producto`, `volumen`, `unidad`, `guiaDespacho`, `salida`, `llegada`, `estado`, GPS.
- `orders/{id}` — `truckId`, `otNumero`, `titulo`, `detalle`, `estado`, `taller`, `fechaAgendada`, `costoEstimado`, `fechaEntregaEstimada`, `trabajo`, `repuestos[]`, `manoObra`, `otrosGastos`, `completedAt`, `sources[]`.
- `resolved/{fallaId}` — fallas descartadas por el supervisor/admin.
- `faenas/{id}` — catálogo de faenas: ubicación, comuna, coordenadas, unidad, metros semana/día, días de operación, capacidad, `clima?` (pronóstico) y `climaHist?` (historial diario).
- `plans/{id}` — plan semanal: `asignaciones[]` (camión, faena, conductor, horario, viajes/volumen objetivo, `plantaDestino?`, `reservas[]` de recepción), `original`, `cambios[]`, estado.
- `imprevistos/{id}` — imprevistos operacionales del día.
- `planconfig/{id}` — parámetros de asignación automática y umbrales de clima.
- `config/empresa` — datos de la empresa: `nombre`, `app`, `logo`, `rut`, `giro`, `direccion`, `comuna`, `fono`, `email`, `avisoDias`.

Los documentos se registran por **número y fecha de vencimiento** (sin archivos). Para adjuntar PDF o foto se agregaría Firebase Storage.

## PWA y versiones

- `public/manifest.webmanifest` y `public/sw.js` hacen la app instalable y la mantienen disponible offline (cache-first para recursos propios).
- Al publicar: sube `APP_VERSION` en `sw.js` y el mismo número en `window.BF_VERSION` dentro de `index.html`. Con eso, al abrir la app aparece el botón "Actualizar".

## Conectar tu proyecto de Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method:** habilita **Correo/contraseña**.
3. **Firestore Database:** créalo en modo producción.
4. **Configuración del proyecto → Tus apps → Web:** copia el objeto de configuración y pégalo en `public/js/config.js` (reemplaza los `TU_...`). Con eso la app deja el modo demo y usa Firebase.
5. Instala las herramientas y despliega (incluye siempre las reglas):

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc   # y pon el id de tu proyecto
firebase deploy --only firestore:rules,hosting
```

> Cada vez que se agrega o cambia un permiso o colección, vuelve a publicar `firestore.rules`.

### Crear el primer administrador

Como los perfiles con rol viven en Firestore y solo un administrador puede crear usuarios, el primer admin se crea a mano una sola vez:

1. En **Authentication**, agrega un usuario (correo + contraseña).
2. Copia su **UID**.
3. En **Firestore**, crea el documento `users/{UID}` con:

```json
{ "email": "admin@tudominio.cl", "nombre": "Nombre Admin", "role": "administrador", "activo": true, "createdAt": 0 }
```

Desde ahí, ese administrador crea el resto de los usuarios desde la propia app (pantalla Usuarios).

## Estructura del proyecto

```
bitacora-flota/
├── firebase.json            Hosting + Firestore
├── firestore.rules          Reglas de seguridad por rol
├── firestore.indexes.json
├── .firebaserc.example
└── public/
    ├── index.html           Meta PWA + registro del service worker + versión
    ├── manifest.webmanifest
    ├── sw.js                Service worker (offline + versión)
    ├── icon-192/512/maskable.png
    ├── styles.css
    └── js/
        ├── config.js        Configuración de Firebase (editar aquí)
        ├── main.js          Arranque, sesión, menú lateral y router
        ├── store.js         Datos: adaptador Firebase + adaptador demo
        ├── permissions.js   Roles, matriz de permisos y permisos por usuario
        ├── planning.js      Motor de planificación, disponibilidad y reservas
        ├── clima.js         Clima e historial (Open-Meteo)
        ├── maintenance.js   Alertas de mantención por kilometraje
        ├── checklist.js     Puntos del checklist y tipos de documento
        ├── ui.js            Utilidades de interfaz (sheets, drawer, iconos)
        ├── productos-base.js / xlsx-lite.js
        └── views/
            ├── login.js
            ├── conductor.js     Selección de camión, checklist, viajes, bitácora, combustible
            ├── panel.js         Panel + órdenes de taller (detalle e impresión)
            ├── planificacion.js Semana, operación del día, plan vs real, faenas, clima, historial, recepción, auto
            ├── camiones.js      Registro de camiones, documentos y estado operativo
            ├── resumen.js       Resumen operativo por camión
            ├── reportes.js      Indicadores y exportación
            ├── truckweek.js     Semana del camión
            ├── usuarios.js      Usuarios y permisos
            ├── empresa.js       Datos de la empresa
            ├── productos.js / importar.js / mantencion.js / alertas.js
```

## Pendientes / próximas fases

- Notificaciones (push) al supervisor cuando entra una falla alta o vence un documento.
- Sincronización del historial de clima desde un proceso en la nube (hoy es diaria al abrir la app).
- Reportes exportables ampliados de costos por camión y por mes.
- Adjuntar fotos/PDF (Firebase Storage) en fallas, órdenes y documentos.
