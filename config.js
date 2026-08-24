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
  apiKey: "AIzaSyCAXaRW9zSIwsffBNyCwZVIO8lSSvPJmos",
  authDomain: "flotaapp-d1e1d.firebaseapp.com",
  projectId: "flotaapp-d1e1d",
  storageBucket: "flotaapp-d1e1d.firebasestorage.app",
  messagingSenderId: "487478351743",
  appId: "1:487478351743:web:3f666b7d1679e4ec276c4a"
};
 
// Versión del SDK de Firebase que se carga desde CDN (sin build).
export const FIREBASE_SDK = "10.12.0";
 
// ¿Está configurado Firebase de verdad? Si no, corre en modo demo.
export function isConfigured() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "TU_API_KEY";
}
 
