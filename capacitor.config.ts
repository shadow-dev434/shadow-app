import type { CapacitorConfig } from '@capacitor/cli';

// Shadow — guscio nativo Capacitor. La WebView carica la web app remota servita
// da Vercel (Next 16 SSR resta server-side: niente static export). Stesso package
// della TWA, che questa build sostituisce (W5 / Task 59).
const config: CapacitorConfig = {
  appId: 'com.shadow.adhd.executor',
  appName: 'Shadow',
  // Richiesto da Capacitor ma inutilizzato in modalità server.url (nessun asset
  // locale servito): puntato a public/ solo per soddisfare il campo.
  webDir: 'public',
  server: {
    url: 'https://shadow-app2.vercel.app',
    cleartext: false,
    // origin https → i cookie di sessione NextAuth funzionano same-origin nella WebView
    androidScheme: 'https',
    // le navigazioni restano nella WebView solo sull'origin consentito; il resto
    // (es. OAuth Google) esce nel browser di sistema → gestito in M3 (differito)
    allowNavigation: ['shadow-app2.vercel.app'],
    // pagina statica mostrata se il remoto è irraggiungibile (offline)
    errorPath: 'offline.html',
  },
};

export default config;
