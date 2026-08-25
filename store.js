// =============================================================
// Capa de datos (store)
// -------------------------------------------------------------
// Expone una API única para autenticación y datos. Por debajo usa
// dos adaptadores intercambiables:
//   - "firebase": Auth + Firestore reales (cuando config.js está
//     configurado).
//   - "demo": guarda todo en localStorage con datos de ejemplo,
//     para probar la app sin Firebase.
// La lógica de negocio (vistas) no sabe cuál está activo.
// =============================================================

import { FIREBASE_CONFIG, FIREBASE_SDK, isConfigured } from "./config.js";

// ---- deviceId persistente por navegador/dispositivo ----
function ensureDeviceId() {
  let id = null;
  try { id = localStorage.getItem("bf_device_id"); } catch (e) {}
  if (!id) {
    id = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem("bf_device_id", id); } catch (e) {}
  }
  return id;
}

const COLLECTIONS = ["users", "devices", "trucks", "checklists", "bitacora", "orders"];

// =============================================================
//  ADAPTADOR DEMO (localStorage)
// =============================================================
function demoAdapter() {
  const K = "bf_demo_db";
  function load() {
    try { const raw = localStorage.getItem(K); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  function save(db) { try { localStorage.setItem(K, JSON.stringify(db)); } catch (e) {} }

  function seed() {
    const now = Date.now(), H = 3600000, D = 86400000;
    const vence = (days) => {
      const d = new Date(Date.now() + days * D);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    const users = [
      { uid: "u_admin", email: "admin@lacabana.cl",      nombre: "Rodrigo Briones", role: "administrador", activo: true, createdAt: now, _pw: "admin123" },
      { uid: "u_super", email: "supervisor@lacabana.cl", nombre: "Carlos Reyes",    role: "supervisor",    activo: true, createdAt: now, _pw: "super123" },
      { uid: "u_ger",   email: "gerente@lacabana.cl",    nombre: "Ana Torres",      role: "gerente",       activo: true, createdAt: now, _pw: "gerente123" },
      { uid: "u_chofer",email: "conductor@lacabana.cl",  nombre: "José Muñoz",      role: "conductor",     activo: true, createdAt: now, _pw: "chofer123" }
    ];
    const mkDocs = (pc, so, rt) => ({
      permisoCirculacion: { numero: pc.n, vence: pc.v },
      soap:               { numero: so.n, vence: so.v },
      revisionTecnica:    { numero: rt.n, vence: rt.v },
      otros: []
    });
    const trucks = [
      { id: "t1",  num: "C-01", patente: "JKLR-52", marca: "Mercedes-Benz", modelo: "Actros", anio: 2021, activo: true, docs: mkDocs({n:"PC-2026-1101",v:vence(70)},{n:"SOAP-88121",v:vence(120)},{n:"RT-55012",v:vence(15)}), createdAt: now },
      { id: "t2",  num: "C-02", patente: "HXPT-19", marca: "Volvo",         modelo: "FH",     anio: 2020, activo: true, docs: mkDocs({n:"PC-2026-1102",v:vence(200)},{n:"SOAP-88122",v:vence(-5)},{n:"RT-55013",v:vence(90)}), createdAt: now },
      { id: "t3",  num: "C-03", patente: "KDFS-73", marca: "Scania",        modelo: "R450",   anio: 2022, activo: true, docs: mkDocs({n:"PC-2026-1103",v:vence(300)},{n:"SOAP-88123",v:vence(60)},{n:"RT-55014",v:vence(45)}), createdAt: now },
      { id: "t4",  num: "C-04", patente: "GBHT-08", marca: "Mercedes-Benz", modelo: "Axor",   anio: 2019, activo: true, docs: mkDocs({n:"PC-2026-1104",v:vence(25)},{n:"SOAP-88124",v:vence(150)},{n:"RT-55015",v:vence(220)}), createdAt: now },
      { id: "t5",  num: "C-05", patente: "LPRV-64", marca: "Volvo",         modelo: "FMX",    anio: 2021, activo: true, docs: mkDocs({n:"PC-2026-1105",v:vence(180)},{n:"SOAP-88125",v:vence(180)},{n:"RT-55016",v:vence(180)}), createdAt: now }
    ];
    const okAll = { neumaticos:"ok",frenos:"ok",luces:"ok",niveles:"ok",direccion:"ok",espejos:"ok",fugas:"ok",docs:"ok",seguridad:"ok",carga:"ok" };
    const checklists = [
      { id: "ck1", truckId: "t1", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", ts: now - 3*H, items: okAll, fails: [], gps: { lat:-37.79812, lng:-72.71034, acc:12, ts: now-3*H }, obs: "" },
      { id: "ck2", truckId: "t3", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", ts: now - 5*H, items: Object.assign({}, okAll, { neumaticos:"falla" }),
        fails: [{ k:"neumaticos", n:"Neumáticos y tuercas", note:"Corte lateral neumático delantero derecho", sev:"alta" }], gps: null, obs: "" }
    ];
    const bitacora = [
      { id: "bt1", truckId: "t2", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", ts: now - 2*H, tipo: "Falla mecánica", sev: "media", desc: "Ruido en caja al reducir a segunda.", gps: null }
    ];
    const orders = [
      { id: "ord1", truckId: "t4", titulo: "Cambio de pastillas de freno", detalle: "Desgaste eje delantero", sources: [], reportadoPor: "Carlos Reyes",
        estado: "completado", taller: "Taller Diesel Sur", fechaAgendada: now - 3*D,
        trabajo: "Cambio de pastillas y rectificado de discos.", repuestos: [{ desc:"Juego pastillas", costo:189000 }], manoObra: 145000,
        createdBy: "u_super", createdAt: now - 4*D, completedAt: now - 2*D }
    ];
    const fuel = [
      { id: "fu1", truckId: "t1", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", fecha: now - 10*D, km: 120000, litros: 300, precioLitro: 950, estacion: "Copec Angol", total: 285000, ts: now - 10*D },
      { id: "fu2", truckId: "t1", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", fecha: now - 3*D,  km: 121500, litros: 320, precioLitro: 970, estacion: "Copec Angol", total: 310400, ts: now - 3*D },
      { id: "fu3", truckId: "t2", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", fecha: now - 4*D,  km: 284000, litros: 280, precioLitro: 965, estacion: "Petrobras Renaico", total: 270200, ts: now - 4*D }
    ];
    const trips = [
      { id: "tr1", truckId: "t1", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", origen: "Predio El Roble", salida: now - 2*D, predio: "El Roble", plantaDestino: "Aserradero Mininco", volumen: 32, unidad: "M3", guiaDespacho: "GD-45210", llegada: now - 2*D + 3*H, gmm: "GMM-8842", ts: now - 2*D },
      { id: "tr2", truckId: "t2", uid: "u_chofer", deviceId: "seed", driverNombre: "José Muñoz", origen: "Predio Santa Ana", salida: now - 1*D, predio: "Santa Ana", plantaDestino: "Planta Collipulli", volumen: 28, unidad: "MR", guiaDespacho: "GD-45233", llegada: now - 1*D + 2*H, gmm: "GMM-8851", ts: now - 1*D }
    ];
    const devices = [];
    const config = [{ id: "empresa", nombre: "Transportes La Cabaña", app: "Bitácora de Camiones", logo: "" }];
    return { users, devices, trucks, checklists, bitacora, orders, fuel, trips, config };
  }

  let db = load();
  if (!db) { db = seed(); save(db); }

  const clone = (x) => JSON.parse(JSON.stringify(x));

  return {
    mode: "demo",
    async signIn(email, password) {
      const u = db.users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
      if (!u || u._pw !== password) { const e = new Error("Correo o contraseña incorrectos"); e.code = "auth"; throw e; }
      if (u.activo === false) { const e = new Error("Usuario inactivo"); e.code = "inactive"; throw e; }
      try { localStorage.setItem("bf_demo_session", u.uid); } catch (e) {}
      const { _pw, ...safe } = u; return clone(safe);
    },
    async signOut() { try { localStorage.removeItem("bf_demo_session"); } catch (e) {} },
    currentUid() { try { return localStorage.getItem("bf_demo_session"); } catch (e) { return null; } },
    async profile(uid) {
      const u = db.users.find(x => x.uid === uid); if (!u) return null;
      const { _pw, ...safe } = u; return clone(safe);
    },
    async createAuthUser({ email, password, nombre, role }) {
      if (db.users.some(x => x.email.toLowerCase() === email.toLowerCase())) {
        const e = new Error("Ya existe un usuario con ese correo"); e.code = "exists"; throw e;
      }
      const uid = "u_" + Math.random().toString(36).slice(2, 10);
      const u = { uid, email, nombre, role, activo: true, createdAt: Date.now(), _pw: password };
      db.users.push(u); save(db);
      const { _pw, ...safe } = u; return clone(safe);
    },
    async list(coll) {
      return clone(db[coll] || []).map(x => { if (x._pw) delete x._pw; return x; });
    },
    async get(coll, id) {
      const x = (db[coll] || []).find(r => r.id === id || r.uid === id);
      return x ? clone(x) : null;
    },
    async add(coll, data) {
      const id = data.id || (coll.slice(0,3) + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
      const rec = Object.assign({ id }, data);
      (db[coll] = db[coll] || []).push(rec); save(db); return id;
    },
    async set(coll, id, data) {
      const arr = db[coll] = db[coll] || [];
      const idx = arr.findIndex(r => r.id === id || r.uid === id);
      const rec = Object.assign({}, data, { id });
      if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], rec); else arr.push(rec);
      save(db);
    },
    async update(coll, id, patch) {
      const arr = db[coll] = db[coll] || [];
      const idx = arr.findIndex(r => r.id === id || r.uid === id);
      if (idx >= 0) { arr[idx] = Object.assign({}, arr[idx], patch); save(db); }
    }
  };
}

// =============================================================
//  ADAPTADOR FIREBASE (Auth + Firestore, SDK modular vía CDN)
// =============================================================
async function firebaseAdapter() {
  const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK + "/";
  const appMod  = await import(base + "firebase-app.js");
  const authMod = await import(base + "firebase-auth.js");
  const fsMod   = await import(base + "firebase-firestore.js");

  const app  = appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  const dbf  = fsMod.getFirestore(app);
  const {
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, query, orderBy
  } = fsMod;

  return {
    mode: "firebase",
    _auth: auth, _authMod: authMod, _appMod: appMod,
    async signIn(email, password) {
      try {
        const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
        return await this.profile(cred.user.uid);
      } catch (e) {
        const err = new Error(e.code === "auth/invalid-credential" || e.code === "auth/wrong-password" || e.code === "auth/user-not-found"
          ? "Correo o contraseña incorrectos" : (e.message || "No se pudo iniciar sesión"));
        err.code = e.code; throw err;
      }
    },
    async signOut() { await authMod.signOut(auth); },
    currentUid() { return auth.currentUser ? auth.currentUser.uid : null; },
    async profile(uid) {
      const snap = await getDoc(doc(dbf, "users", uid));
      return snap.exists() ? Object.assign({ uid }, snap.data()) : null;
    },
    // Crea el usuario de Auth en una app secundaria para no cerrar la
    // sesión del administrador, y guarda su perfil con rol en Firestore.
    async createAuthUser({ email, password, nombre, role }) {
      const secondary = appMod.initializeApp(FIREBASE_CONFIG, "secondary_" + Date.now());
      const secAuth = authMod.getAuth(secondary);
      try {
        const cred = await authMod.createUserWithEmailAndPassword(secAuth, email, password);
        const uid = cred.user.uid;
        const profile = { email, nombre, role, activo: true, createdAt: Date.now() };
        await setDoc(doc(dbf, "users", uid), profile);
        await authMod.signOut(secAuth);
        return Object.assign({ uid }, profile);
      } finally {
        try { await appMod.deleteApp(secondary); } catch (e) {}
      }
    },
    async list(coll) {
      const q = query(collection(dbf, coll));
      const snap = await getDocs(q);
      return snap.docs.map(d => Object.assign({ id: d.id, uid: d.id }, d.data()));
    },
    async get(coll, id) {
      const snap = await getDoc(doc(dbf, coll, id));
      return snap.exists() ? Object.assign({ id, uid: id }, snap.data()) : null;
    },
    async add(coll, data) {
      const ref = await addDoc(collection(dbf, coll), data);
      return ref.id;
    },
    async set(coll, id, data) { await setDoc(doc(dbf, coll, id), data, { merge: true }); },
    async update(coll, id, patch) { await updateDoc(doc(dbf, coll, id), patch); }
  };
}

// =============================================================
//  API PÚBLICA
// =============================================================
let A = null;                 // adaptador activo
let PROFILE = null;           // perfil del usuario en sesión
const DEVICE_ID = ensureDeviceId();

export const store = {
  mode: "demo",
  deviceId() { return DEVICE_ID; },

  async init() {
    A = isConfigured() ? await firebaseAdapter() : demoAdapter();
    this.mode = A.mode;
    const uid = A.currentUid();
    if (uid) { try { PROFILE = await A.profile(uid); } catch (e) { PROFILE = null; } }
    return this.mode;
  },

  currentProfile() { return PROFILE; },

  async login(email, password) {
    PROFILE = await A.signIn(email, password);
    if (!PROFILE) { const e = new Error("Tu usuario no tiene perfil asignado. Contacta al administrador."); e.code = "no-profile"; throw e; }
    if (PROFILE.activo === false) { await A.signOut(); PROFILE = null; const e = new Error("Usuario inactivo"); e.code = "inactive"; throw e; }
    await this.touchDevice();
    return PROFILE;
  },

  async logout() { await A.signOut(); PROFILE = null; },

  async touchDevice() {
    if (!PROFILE) return;
    try {
      await A.set("devices", DEVICE_ID, {
        deviceId: DEVICE_ID, ultimoUid: PROFILE.uid, ultimoUso: Date.now(),
        userAgent: navigator.userAgent
      });
    } catch (e) { /* dispositivos es best-effort */ }
  },

  // --- empresa (branding editable) ---
  async getCompany() {
    let c = null;
    try { c = await A.get("config", "empresa"); } catch (e) { c = null; }
    return Object.assign({ nombre: "Transportes La Cabaña", app: "Bitácora de Camiones", logo: "" }, c || {});
  },
  async saveCompany(data) { return A.set("config", "empresa", Object.assign({ id: "empresa" }, data)); },

  // --- usuarios ---
  async listUsers() { return (await A.list("users")).sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||"")); },
  async createUser(data) { return A.createAuthUser(data); },
  async updateUser(uid, patch) { return A.update("users", uid, patch); },

  // --- camiones ---
  async listTrucks() { return (await A.list("trucks")).sort((a,b)=> (a.num||"").localeCompare(b.num||"")); },
  async getTruck(id) { return A.get("trucks", id); },
  async saveTruck(id, data) {
    if (id) { await A.set("trucks", id, data); return id; }
    return A.add("trucks", data);
  },

  // --- checklists / bitácora / órdenes ---
  async listChecklists() { return (await A.list("checklists")).sort((a,b)=> b.ts-a.ts); },
  async addChecklist(data) { return A.add("checklists", data); },
  async listBitacora() { return (await A.list("bitacora")).sort((a,b)=> b.ts-a.ts); },
  async addBitacora(data) { return A.add("bitacora", data); },
  async listOrders() { return (await A.list("orders")).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); },
  async saveOrder(id, data) {
    if (id) { await A.set("orders", id, data); return id; }
    return A.add("orders", data);
  },

  // --- combustible ---
  async listFuel() { return (await A.list("fuel")).sort((a, b) => (b.fecha || b.ts) - (a.fecha || a.ts)); },
  async addFuel(data) { return A.add("fuel", data); },

  // --- viajes ---
  async listTrips() { return (await A.list("trips")).sort((a, b) => (b.salida || b.ts) - (a.salida || a.ts)); },
  async addTrip(data) { return A.add("trips", data); },

  // --- fallas descartadas ---
  async listResolved() { return (await A.list("resolved")).map(r => r.id); },
  async resolveFalla(id) { return A.set("resolved", id, { id, ts: Date.now() }); }
};
