# Bitácora de Flota

App web móvil para gestionar la mantención preventiva y correctiva de una flota de camiones (La Cabaña Forestal). Los conductores registran el checklist de inicio de turno y las novedades con ubicación GPS; supervisores y administradores gestionan camiones, documentación, fallas y órdenes de taller con sus costos.

Está construida con **HTML + JavaScript modular + Firebase** (Authentication + Firestore), sin paso de build. Se puede abrir directamente en el navegador y desplegar en Firebase Hosting.

## Modo demostración (sin Firebase)

Mientras `public/js/config.js` tenga los valores de ejemplo, la app corre en **modo demo**: guarda todo en el `localStorage` del navegador con datos de ejemplo, para que puedas probarla sin configurar nada.

Para probar localmente:

```bash
cd public
python3 -m http.server 8080
# abre http://localhost:8080
```

> Usa un servidor local (no `file://`) porque la app carga módulos ES.

Usuarios de prueba (botones en la pantalla de login):

| Rol           | Correo                   | Contraseña  |
|---------------|--------------------------|-------------|
| Administrador | admin@lacabana.cl        | admin123    |
| Supervisor    | supervisor@lacabana.cl   | super123    |
| Gerente       | gerente@lacabana.cl      | gerente123  |
| Conductor     | conductor@lacabana.cl    | chofer123   |

## Roles y permisos

Los roles y permisos están en `public/js/permissions.js`. La matriz es **extensible**: para sumar un permiso nuevo lo defines en `PERMISSIONS` y lo agregas a los roles que lo tengan. La interfaz consulta `can(user, permiso)` y las reglas de Firestore validan lo mismo por rol.

| Permiso            | Conductor | Supervisor | Gerente | Administrador |
|--------------------|:---------:|:----------:|:-------:|:-------------:|
| checklist.create   |     ✓     |            |         |       ✓       |
| bitacora.create    |     ✓     |            |         |       ✓       |
| truck.select       |     ✓     |            |         |       ✓       |
| fleet.view         |           |     ✓      |    ✓    |       ✓       |
| falla.view         |           |     ✓      |    ✓    |       ✓       |
| truck.manage       |           |     ✓      |         |       ✓       |
| order.manage       |           |     ✓      |         |       ✓       |
| reports.view       |           |     ✓      |    ✓    |       ✓       |
| user.manage        |           |            |         |       ✓       |

El Gerente tiene una vista de supervisión de solo lectura. Los permisos se van ampliando a medida que crece la app.

## Identificación de usuario y dispositivo

- **Usuario:** el UID de Firebase Authentication (estable por persona).
- **Dispositivo:** un `deviceId` persistente que se genera una vez por navegador/dispositivo y se guarda en `localStorage` (`bf_device_id`).

Cada checklist y cada registro de bitácora quedan sellados con el `uid` del usuario y el `deviceId`. Al iniciar sesión, la app registra/actualiza el dispositivo en la colección `devices`. Esta es la misma lógica que puedes replicar desde tus otros sistemas; si allá usas otro formato de ID, ajusta `ensureDeviceId()` en `public/js/store.js`.

## Modelo de datos (Firestore)

- `users/{uid}` — perfil: `email`, `nombre`, `role`, `activo`, `createdAt`.
- `devices/{deviceId}` — `ultimoUid`, `ultimoUso`, `userAgent`.
- `trucks/{id}` — `num`, `patente`, `marca`, `modelo`, `anio`, `activo`, `docs`.
  - `docs.permisoCirculacion`, `docs.soap`, `docs.revisionTecnica` = `{ numero, vence }`.
  - `docs.otros` = lista de `{ nombre, numero, vence }`.
- `checklists/{id}` — `truckId`, `uid`, `deviceId`, `driverNombre`, `ts`, `items`, `fails`, `gps`, `obs`.
- `bitacora/{id}` — `truckId`, `uid`, `deviceId`, `driverNombre`, `ts`, `tipo`, `sev`, `desc`, `gps`.
- `orders/{id}` — `truckId`, `titulo`, `estado`, `taller`, `fechaAgendada`, `trabajo`, `repuestos[]`, `manoObra`, `completedAt`, `sources[]`.
- `resolved/{fallaId}` — fallas descartadas por el supervisor.

Los documentos se registran por **número y fecha de vencimiento** (sin archivos), como pediste. Si más adelante quieres adjuntar PDF o foto, se agrega Firebase Storage.

## Conectar tu proyecto de Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method:** habilita **Correo/contraseña**.
3. **Firestore Database:** créalo en modo producción.
4. **Configuración del proyecto → Tus apps → Web:** copia el objeto de configuración y pégalo en `public/js/config.js` (reemplaza los `TU_...`). Con eso la app deja el modo demo y usa Firebase.
5. Instala las herramientas y despliega:

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc   # y pon el id de tu proyecto
firebase deploy --only firestore:rules,hosting
```

### Crear el primer administrador

Como los perfiles con rol viven en Firestore y solo un administrador puede crear usuarios, el primer admin se crea a mano una sola vez:

1. En **Authentication**, agrega un usuario (correo + contraseña).
2. Copia su **UID**.
3. En **Firestore**, crea el documento `users/{UID}` con:

```json
{ "email": "admin@tudominio.cl", "nombre": "Nombre Admin", "role": "administrador", "activo": true, "createdAt": 0 }
```

Desde ahí, ese administrador puede crear el resto de los usuarios desde la propia app (pantalla Usuarios).

## Estructura del proyecto

```
bitacora-flota/
├── firebase.json            Hosting + Firestore
├── firestore.rules          Reglas de seguridad por rol
├── firestore.indexes.json
├── .firebaserc.example
└── public/
    ├── index.html
    ├── styles.css
    └── js/
        ├── config.js        Configuración de Firebase (editar aquí)
        ├── main.js          Arranque, sesión y router
        ├── store.js         Datos: adaptador Firebase + adaptador demo
        ├── permissions.js   Roles y matriz de permisos
        ├── checklist.js     Puntos del checklist y tipos de documento
        ├── ui.js            Utilidades de interfaz
        └── views/
            ├── login.js
            ├── conductor.js Checklist, bitácora e historial
            ├── panel.js     Panel supervisor/gerente/admin y órdenes
            ├── camiones.js  Registro de camiones y documentos
            └── usuarios.js  Administración de usuarios
```

## Pendientes / próximas fases

- Notificaciones al supervisor cuando entra una falla alta o un documento vence.
- Mantención preventiva programada por kilometraje o fecha.
- Reportes exportables de costos por camión y por mes.
- Adjuntar fotos/PDF (Firebase Storage) en fallas, órdenes y documentos.
- Ajustar el checklist y los talleres a los datos reales de la operación.
