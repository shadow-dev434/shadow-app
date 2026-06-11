# W5 — Capacitor Android (M1→M6): skeleton, sostituzione TWA, auth bridge, push, blocker, IAP

> Tutto eseguibile su Windows. Decisione D4: Capacitor **in-repo** (`android/`,
> `plugins/` con bun workspaces — la regola "Android fuori dal repo" valeva per
> il progetto bubblewrap usa-e-getta), webview su **URL remoto** Vercel.

## Architettura di caricamento (decisa)

- `capacitor.config.ts`: `appId: 'com.shadow.adhd.executor'`,
  `server.url: 'https://shadow-app2.vercel.app'`, `errorPath` → `public/offline.html`.
  Aggiornamenti UI istantanei (cadenza beta preservata), cookie **same-origin**
  → NextAuth e middleware gate invariati, niente CORS per il webview.
- La JS dei plugin va shippata NEL SITO: `@capacitor/core` + plugin diventano
  dipendenze web con guard `Capacitor.isNativePlatform()` (unico punto di import:
  `src/lib/native/platform.ts`). Vincolo version-skew: deploy "web prima, binario poi".
- SW: in `tasks/page.tsx` (registrazione, riga ~363) condizionare con
  `!Capacitor.isNativePlatform()`.
- Bundle statico locale = contingency documentata anti-Apple-4.2 (serve split
  monorepo: NON farlo ora).

## M1 — Skeleton (acceptance: AAB firmato apre Shadow, login+gate ok)

`bun add @capacitor/core @capacitor/cli @capacitor/android` (⚠️ tocca
package.json → conferma) → `bunx cap init` + `bunx cap add android` (cartella
`android/` committata); icone/splash; creazione `public/offline.html` (target
di `errorPath`, oggi inesistente); intent-filter App Links `autoVerify` su
shadow-app2.vercel.app (assetlinks già live e valido); gate SW; `platform.ts`.

## M2 — Sostituzione TWA su Play (acceptance: update OTA ai closed tester)

1. `applicationId` identico; `versionCode` > ultimo AAB TWA (verifica Play Console).
2. Firma con lo **stesso upload keystore** reale
   `C:\shadow-twa\shadow-upload.keystore` (il nome `android.keystore` nel
   runbook TWA è solo l'esempio del comando; mai committato; verificare che sia
   la upload key registrata su Play App Signing); Play App Signing invariato.
3. Upload sullo stesso track closed testing → update trasparente.
4. Release notes: **i tester rifanno il login una volta** (storage webview ≠ Chrome).
5. `assetlinks.json` SI TIENE (serve agli App Links; entrambi i fingerprint).
6. **Primo release = feature parity** (webview+push al massimo): zero permessi
   nuovi, review banale. Blocker in release separato (M5).
7. `C:\shadow-twa` si archivia, non si cancella (keystore!).

## M3 — Auth bridge (acceptance: kill cookie → sessione ripristinata silenziosa)

Fatti verificati: `getToken()` di next-auth accetta GIÀ `Authorization: Bearer`
(fallback nativo) → `requireSession` invariato; `/api/auth/login` custom esistente
è il template. In opzione URL-remoto il cookie resta primario; il Bearer serve a
componenti nativi, recovery eviction WKWebView e future-proof.

- `POST /api/auth/mobile-token`: email/password → JWE `encode()` 30gg **nel body**
  + claim `consentGiven` (fix parity: il login attuale non lo inietta) + profileFlags.
- `POST /api/auth/mobile-token/refresh`: Bearer valido → nuovo JWE (sliding;
  client: refresh al cold start se mancano <7gg).
- `POST /api/auth/mobile-session`: Bearer valido → `Set-Cookie` session token
  (cookie handoff anti-eviction).
- `src/middleware.ts` (⚠️ conferma): branch CORS per `/api/*` (OPTIONS 204 +
  allowlist `capacitor://localhost`, `https://localhost`, `http://localhost:3000`;
  `Allow-Headers: authorization, content-type`) + skip `.well-known`.
- `src/lib/native/api-fetch.ts`: interceptor Bearer (refactor dei ~39 call-site
  fetch in 5 file: tasks/page.tsx ~30, OnboardingView 4, **ChatView 3** —
  active-thread:110, bootstrap:148, turn:213 —, TourView 1, ConsentView 1).
  Token in `@aparajita/capacitor-secure-storage` (Keychain/Keystore).
- OAuth Calendar: Google **vieta** OAuth nel webview (`disallowed_useragent`) →
  `@capacitor/browser` (Custom Tabs) + ritorno via App Link; creare anche
  `public/.well-known/apple-app-site-association` (per iOS, W6).

## M4 — Push unificato (acceptance: reminder arriva su FCM device reale + web push)

- Client: `@capacitor/push-notifications` → token → `POST /api/push-device`
  (tabella `PushDevice` di W1; shim su `/api/push-subscription` che scrive su
  PushDevice; script `scripts/migrate-push-subscriptions.ts`).
- Server `src/lib/push/dispatch.ts` con 3 adapter: web (`web-push`, VAPID),
  Android (FCM HTTP v1 con `google-auth-library` + fetch — NIENTE firebase-admin),
  iOS (APNs HTTP/2 diretto, .p8 + JWT ES256 via `jose` — zero Firebase su iOS).
- `vercel.json` (⚠️ nuovo file root): cron → `GET /api/cron/reminders` protetto
  `CRON_SECRET`: scan `Task.reminderAt <= now` non inviati → dispatch multi-device.
  Nota: cron Vercel Hobby = solo giornaliero → per granularità 5-15 min serve
  piano Pro o cron esterno (cfr. W0).

## M5 — Plugin `shadow-app-blocker` (acceptance: overlay entro 2s dall'apertura di un'app vietata; `distractionsBlocked` sincronizzato)

API TS (in `plugins/shadow-app-blocker/src/definitions.ts`):
`checkPermissions / requestUsageAccess / requestOverlayPermission /
requestNotificationPermission / getInstalledApps / startBlocking({packages,
endsAtEpochMs, sessionId, overlayTitle, overlayBody}) / stopBlocking() →
{blockedAttempts} / getStatus / addListener('blockedAttempt')`.

Nativo (Kotlin): ForegroundService `foregroundServiceType="specialUse"`
(+ permesso `FOREGROUND_SERVICE_SPECIAL_USE`, Android 14) con notifica countdown;
polling `UsageStatsManager.queryEvents` (finestra 3-5s ogni ~1200ms, solo a
sessione attiva); overlay `TYPE_APPLICATION_OVERLAY` brandizzato "Torna a Shadow"
+ counter; whitelist hardcoded mai bloccabile (dialer, Settings, IME, launcher,
emergenze); auto-stop a endsAt (Handler + AlarmManager backup); lista app via
`queryIntentActivities` con `<queries>` MAIN/LAUNCHER (**niente QUERY_ALL_PACKAGES**);
`blockedAttempts` su SharedPreferences, consegnati a JS su resume e a stop →
`PATCH /api/strict-mode { distractionsBlocked }`. ⚠️ Il PATCH attuale
(`src/app/api/strict-mode/route.ts:93`) destruttura solo
sessionId/status/exitReason/exitConfirmationText/taskCompleted: va ESTESO per
accettare e persistere `distractionsBlocked` (il campo esiste già nello schema),
altrimenti il sync è un no-op silenzioso.

Facade `src/lib/native/focus-shield.ts`: `startNativeShield({sessionId,
blockedAppPackages, endsAt})` / `stopNativeShield()` / `syncDistractions()` —
android→plugin, ios→W6, web→no-op. Aggancio a start/stop StrictModeSession
(tasks/page.tsx righe ~183/192, ~896, ~2256, ~2284-2324 + scadenza endsAt).
Prominent disclosure in-app PRIMA della richiesta permessi.

Release Play con: Usage Access declaration (digital wellbeing + video demo),
FGS specialUse declaration, giustificazione SYSTEM_ALERT_WINDOW, Data safety
aggiornato (FCM token).

## M6 — RevenueCat (acceptance: acquisto sandbox di ogni piano → entitlement server <1min; gate MAX attivo)

`@revenuecat/purchases-capacitor`; `Purchases.configure()` per piattaforma +
`Purchases.logIn(User.id)` subito dopo auth (stesso bootstrap — evita alias
anonimi); paywall custom nel webview via `getOfferings()`/`purchasePackage()`
(coerenza UI + bilingue; RC Paywalls native = riserva); su nativo MAI link al
checkout web (Apple 3.1.1). Webhook/entitlements: già fatti in W2.

## Dipendenze nuove (giustificate nel piano — ⚠️ ogni `bun add` tocca package.json → conferma esplicita)

`@capacitor/{core,cli,android,push-notifications,browser}`,
`@revenuecat/purchases-capacitor`, `@aparajita/capacitor-secure-storage`,
`web-push`, `google-auth-library`, `jose` (transitiva→esplicita).
