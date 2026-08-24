// =============================================================
// Configuración de Firebase
// -------------------------------------------------------------
// Reemplaza estos valores con los de TU proyecto de Firebase.
// Los encuentras en: Firebase Console > Configuración del proyecto
// > Tus apps > SDK setup and configuration.
//
// Mientras el apiKey siga como "TU_API_KEY", la app funciona en
// MODO DEMO (datos de ejemplo guardados solo en este navegador),
// sin conectarse a Firebase. Así puedes probarla de inmediato.
// =============================================================

export const FIREBASE_CONFIG = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

// Versión del SDK de Firebase que se carga desde CDN (sin build).
export const FIREBASE_SDK = "10.12.0";

// ¿Está configurado Firebase de verdad? Si no, corre en modo demo.
export function isConfigured() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "TU_API_KEY";
}
