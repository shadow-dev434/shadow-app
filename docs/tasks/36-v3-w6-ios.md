# W6 — iOS: bring-up (M7) + Screen Time strict mode (M8)

> Richiede: Mac (decisione W0 — raccomandato Mac mini fisico; Xcode Cloud solo CI),
> Apple Developer attivo, entitlement FamilyControls richiesto in W0,
> **iPhone fisico** (il simulatore NON supporta FamilyControls). Minimo: iOS 16.0
> (FamilyControls `.individual`).

## M7 — Bring-up (acceptance: build TestFlight con login, chat, task, push, acquisto sandbox)

- `bun add @capacitor/ios` (⚠️ tocca package.json → conferma) → `bunx cap add ios`
  (cartella `ios/` committata).
- Parity webview: stessa `capacitor.config.ts` (server.url remoto + errorPath).
- Universal Links: servire `public/.well-known/apple-app-site-association`
  (creato in W5-M3; JSON senza estensione, content-type corretto su Vercel) +
  Associated Domains nel target.
- Auth: cookie same-origin nel WKWebView + handoff `mobile-session` per
  l'eviction (test esplicito: cancellare i cookie del webview → riapertura senza login).
- Push APNs: registrazione `@capacitor/push-notifications` → `POST /api/push-device`
  (platform 'ios'); invio via adapter APNs diretto (.p8) di W5-M4.
- RevenueCat iOS: `configure` + `logIn`; prodotti App Store Connect + intro offer
  21 giorni; acquisto sandbox di ogni piano.
- OAuth Calendar via SFSafariViewController (`@capacitor/browser`) + ritorno
  Universal Link.
- Niente Sign in with Apple richiesto: login solo email/password (Google OAuth
  è account-linking calendario, non autenticazione — esplicitarlo nelle review notes).

## M8 — Plugin `shadow-screen-time` (acceptance: app selezionate shieldate; shield cade a endsAt anche con Shadow uccisa; tentativi contati)

API TS (`plugins/shadow-screen-time/src/definitions.ts`):
`getAuthorizationStatus / requestAuthorization (.individual) / presentAppPicker /
hasSavedSelection / startShield({endsAtEpochMs, sessionId}) / stopShield() →
{blockedAttempts} / getStatus`.

Ripartizione Swift (vincolo strutturale):
- **Nel plugin** (SPM): `AuthorizationCenter.requestAuthorization(for: .individual)`;
  `FamilyActivityPicker` (SwiftUI in UIHostingController modale sopra il webview);
  persistenza `FamilyActivitySelection` in **App Group UserDefaults**
  (`group.com.shadow.adhd.executor`); `ManagedSettingsStore().shield.applications/
  .applicationCategories` on/off; `DeviceActivitySchedule` con
  `intervalEnd = max(endsAt, intervalStart + 15 min)` — le schedule
  DeviceActivity hanno un **minimo di 15 minuti** (`startMonitoring` fallisce
  sotto soglia, e le sessioni strict hanno durata libera, default 25 min ma
  anche meno): lo stop puntuale a endsAt lo fa il timer in-process del plugin
  (clear di ManagedSettingsStore) quando l'app è viva; la schedule è il
  safety-net ad app uccisa.
- **Nel target app Xcode** (setup one-shot committato in `ios/`, NON shippabile
  dal plugin): estensione **DeviceActivityMonitor** (`intervalDidEnd` → clear
  shield anche ad app uccisa) + estensioni **ShieldConfiguration/ShieldAction**
  (shield brandizzato Shadow, localizzato it/en; ShieldAction incrementa il
  counter tentativi su App Group). Documentare nel README del plugin.

Vincoli onesti (da riflettere in UX e copy):
- La selection è fatta di **token opachi**: resta sul device, mai sul server
  (server riceve solo `hasSelection` + counts).
- Lo shield **non può aprire Shadow** (azioni possibili: close/defer).
- Integrazione con la facade `focus-shield.ts` (W5) e StrictModeSession:
  identica all'Android, stessa friction exit esistente.

## Fallback dichiarato

Se l'entitlement FamilyControls distribution è negato o in ritardo: iOS v1
esce con la sola friction UI attuale (strict mode "soft") e il blocco reale
arriva in update successivo. NON bloccare la release iOS su questo.

## Localizzazione nativa

FamilyControls e notifiche push NON hanno usage description in Info.plist
(i prompt di autorizzazione usano testo di sistema non personalizzabile):
localizzare in it/en il copy delle estensioni ShieldConfiguration
(titolo/sottotitolo/bottoni dello shield) e le chiavi Info.plist reali
(es. `CFBundleDisplayName`), coerente con W4.
