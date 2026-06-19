# Task 59 — App nativa Android (Capacitor) — runbook eseguibile in autonomia

> **Origine:** richiesta Antonio 2026-06-19 ("trasformare l'app in app nativa
> Android, piano che Code possa eseguire in completa autonomia; ho un backup,
> gli errori non sono un problema").
> **Base:** questa è l'operazionalizzazione di `docs/tasks/35-v3-w5-capacitor-android.md`
> (W5, già approvato nel piano v3) + recon verificato il 2026-06-19 (toolchain,
> policy Play, claim sul codice). Dove il recon ha corretto la spec 35, vale questo doc.
> **Backup:** Antonio ha una copia di sicurezza della cartella `shadow-app`.

---

## 0. Idea in una frase

Shadow diventa **app nativa Android via Capacitor 6**: un guscio nativo che carica
la **stessa web app remota** (`https://shadow-app2.vercel.app`) dentro una WebView,
**più** plugin nativi che il web non può avere (blocco app reale, push, IAP).
Stesso package della TWA — `com.shadow.adhd.executor` — che questa build **sostituisce**.

Conseguenza chiave: "renderla nativa" **non riscrive l'app**. La web app resta
servita da Vercel; il lavoro è il guscio nativo + i plugin. Il valore vero del
nativo (vs PWA/TWA) è il **blocco app** durante lo strict mode.

---

## 1. Cosa Code fa in autonomia ORA vs cosa serve a te (Antonio)

| Pezzo | Autonomo ORA (Code) | Serve a te (account/console/device) |
|---|---|---|
| Toolchain Android SDK (headless) | ✅ scarica + installa via `sdkmanager` | — |
| Skeleton Capacitor + `capacitor.config.ts` + `android/` | ✅ | — |
| **Build APK debug installabile** | ✅ `gradlew assembleDebug` (auto-firma debug) | installarlo sul tuo telefono + occhio reale |
| Guscio web-side (platform guard, gate SW, back button) | ✅ codice su feature branch | **push/deploy su Vercel** (la WebView carica il remoto) |
| Plugin nativo blocco app (Kotlin) | ✅ scrive + compila nell'APK | **occhio reale sul telefono** (il blocco vero si vede solo on-device) |
| Auth bridge Bearer (M3) | ✅ codice | edit `middleware.ts` = file protetto → tua conferma |
| Sostituire la TWA su Play (M2) | scrive signingConfig | **keystore + Play Console + upload** = solo tu |
| Push FCM (M4) | ✅ codice/dispatcher | **service account Firebase + VAPID** (W0) |
| IAP RevenueCat (M6) | ✅ codice/paywall | **account RevenueCat + entitlements W2** |
| Dichiarazioni Play (Usage Access, FGS specialUse) + **video demo** | — | **solo tu** (Play Console) |

**Conclusione:** Code può portarti fino a un **APK debug nativo installabile, con
il blocco app reale compilato dentro**, in piena autonomia. La *pubblicazione* su
Play e le feature che dipendono da account a pagamento (push, IAP) restano gate tue.

---

## 2. Scope raccomandato per questa esecuzione

| Fase | Cosa | Raccomandazione |
|---|---|---|
| **Fase 0** | Toolchain Android SDK | **Fare** (prerequisito di tutto) |
| **Fase 1 (M1)** | Skeleton → APK debug che carica Shadow | **Fare** — è "l'app è nativa adesso" |
| **Fase 2 (M5)** | Plugin nativo blocco app | **Fare** — è il motivo per essere nativi |
| Fase 3 (M3) | Auth bridge Bearer | Differire (tocca `middleware.ts`; il cookie WebView già funziona) |
| Fase 4 (M2) | Sostituzione TWA su Play | Differire (keystore + console = tue) |
| Fase 5 (M4) | Push FCM unificato | Differire (W0: service account Firebase) |
| Fase 6 (M6) | IAP RevenueCat | Differire (W2 + account RevenueCat) |

> Le fasi differite hanno già la spec in `docs/tasks/35-…`; restano pronte ma
> bloccate su risorse esterne. Questo doc dettaglia 0–2; per 3–6 vedi spec 35.

---

## 3. Decisioni tecniche (verificate il 2026-06-19, vincolanti)

| Decisione | Valore | Perché |
|---|---|---|
| Capacitor | **6.2.1** (pin esatto, non `^6`) | Cap 7/8 hardcodano `JavaVersion.VERSION_21` nel gradle generato; questa macchina ha **solo JDK 17**. Cap 6 = Gradle 8.2.1 / AGP 8.2.1, gira su JDK 17. |
| JDK | **Temurin 17** (già installato) | non installare JDK 21 |
| appId / package | **`com.shadow.adhd.executor`** | immutabile; uguale a TWA + `assetlinks.json` (già live coi fingerprint reali). La WebView su `server.url` **non** dipende da assetlinks per funzionare. |
| Caricamento | `server.url: https://shadow-app2.vercel.app` | Next 16 SSR resta su Vercel; niente static export; cookie NextAuth same-origin funzionano nella WebView. |
| SDK Android | compileSdk/targetSdk **34**, build-tools **34.0.0**, platform `android-34` | default Cap 6, compatibili JDK 17 |
| minSdk | **26** (Android 8) | `TYPE_APPLICATION_OVERLAY` del blocco app richiede API 26; ~99% device |
| Build debug | `gradlew assembleDebug` | auto-firma con debug keystore, **nessun keystore richiesto** |
| Coesistenza con TWA | debug `applicationIdSuffix ".debug"` | l'APK debug si installa **a fianco** della TWA pubblicata (firme diverse), niente conflitto di installazione |
| Gradle | wrapper 8.2.1 (incluso in `android/`) | **niente Gradle standalone** da installare |

**Niente in questo scope tocca:** `prisma/schema.prisma` (il campo
`distractionsBlocked` esiste già), `next.config.ts`, `.env*`. `middleware.ts`
solo se si fa la Fase 3 (differita).

---

## 4. Conferme richieste dagli hook (anche dentro piano approvato)

Per regola CLAUDE.md, ogni `bun add` tocca `package.json` → serve frase esplicita
che nomina i comandi. **Approvare questo piano = autorizzare questi add:**

```
# Fase 1
bun add @capacitor/core@6.2.1 @capacitor/app@6.0.2
bun add -d @capacitor/cli@6.2.1
bun add @capacitor/android@6.2.1
# Fase 2 (plugin locale, in-repo, nessun pacchetto npm esterno extra)
```

- **Nessun** `prisma migrate` / `db push`.
- **Nessun** edit di `.env*`, `next.config.*`, `middleware.ts` (nello scope 0–2).
- **Nessun** `git push` (Code committa su feature branch `feature/59-app-nativa-android`;
  push/merge li decidi tu — servono anche per il deploy Vercel del guscio web-side).

---

## 5. FASE 0 — Toolchain Android SDK (headless, no Android Studio)

Acceptance: `sdkmanager --list` mostra platform-tools + android-34 + build-tools 34.0.0; `adb` risponde.

```powershell
# SDK in %LOCALAPPDATA%\Android\Sdk
$SDK = "$env:LOCALAPPDATA\Android\Sdk"
New-Item -ItemType Directory -Force -Path "$SDK\cmdline-tools" | Out-Null
Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip" -OutFile "$env:TEMP\clt.zip"
Expand-Archive "$env:TEMP\clt.zip" "$SDK\cmdline-tools" -Force
Rename-Item "$SDK\cmdline-tools\cmdline-tools" "latest"   # layout richiesto: cmdline-tools/latest/bin

setx ANDROID_HOME "$SDK"; setx ANDROID_SDK_ROOT "$SDK"
$env:ANDROID_HOME=$SDK; $env:ANDROID_SDK_ROOT=$SDK
$env:Path="$SDK\cmdline-tools\latest\bin;$SDK\platform-tools;$env:Path"

sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
cmd /c "echo y| sdkmanager --licenses"   # accetta licenze non-interattivo
```

Note esecuzione:
- ~120 MB cmdline-tools + ~1 GB pacchetti SDK + (al primo build) la distro Gradle 8.2.1.
  Download pesanti ma scriptabili. Backup esistente → ok rischiare.
- Il Bash tool (git-bash) **non** eredita `setx`: Code esporta `ANDROID_HOME`/`PATH`
  **inline** in ogni chiamata che ne ha bisogno (o passa `env:`), oppure usa
  `powershell.exe -Command`.
- Prerequisito già verificato: JDK 17 (`JAVA_HOME` settato), node 24, bun 1.3.14.

---

## 6. FASE 1 — M1 Skeleton → APK debug

Acceptance: `app-debug.apk` prodotto; installato apre Shadow a tutto schermo, login + gate funzionano contro la prod.

### 6.1 Scaffold (autonomo, locale)
```bash
bun add @capacitor/core@6.2.1 @capacitor/app@6.0.2
bun add -d @capacitor/cli@6.2.1
bunx cap init "Shadow" "com.shadow.adhd.executor" --web-dir=public
bun add @capacitor/android@6.2.1
bunx cap add android
```
`--web-dir=public` è solo un campo obbligatorio: in modalità `server.url` la WebView
**non** serve asset locali. Nessun `next build && next export`.

### 6.2 `capacitor.config.ts` (nuovo, root)
```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.shadow.adhd.executor',
  appName: 'Shadow',
  webDir: 'public', // inutilizzato in server.url, ma richiesto
  server: {
    url: 'https://shadow-app2.vercel.app',
    cleartext: false,
    androidScheme: 'https',                 // origin https → cookie NextAuth ok
    allowNavigation: ['shadow-app2.vercel.app'],
    errorPath: 'offline.html',              // mostrato se il remoto è irraggiungibile
  },
};
export default config;
```

### 6.3 File e modifiche
- **`public/offline.html`** (nuovo): pagina statica "Shadow è offline — riconnettiti".
  Target di `errorPath`. **Nessun** accesso ai plugin (è la pagina di fallback).
- **`android/variables.gradle`**: `minSdkVersion = 26` (per la Fase 2); compile/target
  restano 34.
- **`android/app/build.gradle`**: nel `buildTypes { debug { … } }` aggiungere
  `applicationIdSuffix ".debug"` → l'APK debug è `com.shadow.adhd.executor.debug`
  e convive con la TWA pubblicata.
- **`src/lib/native/platform.ts`** (nuovo, unico punto d'import di Capacitor lato web):
  ```ts
  import { Capacitor } from '@capacitor/core';
  export const isNative = () => Capacitor.isNativePlatform();
  export const nativePlatform = () => Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
  ```
- **`src/app/tasks/page.tsx:428`** (gate SW): la registrazione attuale
  `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js')… }`
  diventa `if (!isNative() && 'serviceWorker' in navigator) { … }`. Evita che la
  WebView nativa serva bundle staleati dal SW.
- **Back button** (nuovo, montato a livello app o in `ChatView`/layout client): listener
  `@capacitor/app` `backButton` → `window.history.back()` se c'è storia, altrimenti
  `App.exitApp()`. Solo attivo quando `isNative()`.

> **Version-skew (importante):** le modifiche **web-side** (gate SW, `platform.ts`,
> back button, e in Fase 2 la JS dei plugin) hanno effetto nella WebView **solo dopo
> deploy su Vercel**, perché il binario carica il sito remoto. Quindi: Code le mette
> su `feature/59-…`; **tu fai push/merge → Vercel deploya**; poi l'APK le "vede".
> Regola: **web prima, binario poi.** Per il primissimo APK proof-of-life questo non
> serve: l'app carica la prod attuale e funziona già.

### 6.4 Build + verifica
```bash
bunx cap sync android
cd android && ./gradlew.bat assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```
Verifica autonoma: build verde + APK presente. Se un device è collegato via USB
(`adb devices`): `./gradlew.bat installDebug` e Code legge i log con `adb logcat`.
**Occhio reale (tu):** installare l'APK, fare login, vedere chat/piano/review.

---

## 7. FASE 2 — M5 Plugin nativo `shadow-app-blocker` (il valore vero del nativo)

Acceptance: avviando uno strict mode, aprire un'app vietata mostra l'overlay
"Torna a Shadow" entro ~2s; a fine sessione `distractionsBlocked` è sincronizzato.
(Build verde = autonomo; comportamento reale = occhio tuo sul telefono.)

### 7.1 Architettura (verificata Play-compliant 2026, no Accessibility)
- **Foreground Service** `foregroundServiceType="specialUse"` + permesso
  `FOREGROUND_SERVICE_SPECIAL_USE` + `<property PROPERTY_SPECIAL_USE_FGS_SUBTYPE>`;
  avviato **da azione utente**, vivo per tutta la sessione (regole Android 15 sul
  restart FGS da background).
- **Rilevamento**: `UsageStatsManager.queryEvents` su finestra ~10s, polling
  **~700ms–1.2s** solo a sessione attiva (sotto i 2s; idle quando non c'è sessione).
  Cache dell'ultimo package non-vuoto (queryEvents ha letture transitorie vuote).
  **Niente AccessibilityService** (rischio Play) — il polling basta.
- **Overlay** `TYPE_APPLICATION_OVERLAY` brandizzato "Torna a Shadow" + counter;
  mai su status/nav bar; solo durante sessione attiva.
- **Lista app**: `<queries>` MAIN/LAUNCHER (**niente `QUERY_ALL_PACKAGES`**).
- **Whitelist hardcoded** mai bloccabile: dialer, Settings, IME, launcher, emergenze.
- **Auto-stop** a `endsAt` (Handler + AlarmManager backup).
- minSdk 26.

### 7.2 Permessi (deep-link Settings + prominent disclosure PRIMA)
- `PACKAGE_USAGE_STATS` → `Settings.ACTION_USAGE_ACCESS_SETTINGS`, check via
  `AppOpsManager` (non è un dialog runtime).
- `SYSTEM_ALERT_WINDOW` → `ACTION_MANAGE_OVERLAY_PERMISSION`, check `canDrawOverlays()`.
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + schermata "rendi Shadow affidabile"
  (OEM Samsung/Xiaomi uccidono i background — è il vero rischio di affidabilità).
- **Disclosure in-app** (Perché/Cosa/Come + Accetto) prima di ogni richiesta.

### 7.3 Struttura plugin (in-repo, niente npm esterno)
```
plugins/shadow-app-blocker/
  src/definitions.ts        # API TS: checkPermissions, requestUsageAccess,
                            #   requestOverlayPermission, getInstalledApps,
                            #   startBlocking({packages,endsAtEpochMs,sessionId,…}),
                            #   stopBlocking()→{blockedAttempts}, getStatus,
                            #   addListener('blockedAttempt')
  src/index.ts              # registerPlugin
  android/…                 # Kotlin: ForegroundService, detector loop, overlay,
                            #   AppOps/overlay checks, SharedPreferences counter
```

### 7.4 Lato web (feature branch → deploy)
- **`src/lib/native/focus-shield.ts`** (facade): `startNativeShield({sessionId,
  blockedAppPackages, endsAt})` / `stopNativeShield()` / `syncDistractions()` —
  android→plugin, ios→no-op (W6), web→no-op.
- **Aggancio** in `src/app/tasks/page.tsx`: `startStrictModeSession` (**riga 231**)
  → `startNativeShield(...)`; `endStrictModeSession` (**riga 243**, chiamate a 1092/2480/2575)
  → `stopNativeShield()` + `syncDistractions()`. Tutto sotto `isNative()`.
- **`src/app/api/strict-mode/route.ts`** (PATCH, riga ~93): **estendere** la
  destrutturazione per accettare e persistere `distractionsBlocked` (oggi NON c'è;
  il campo esiste già in `prisma/schema.prisma` → **nessuna migration**). Senza
  questa modifica il sync è un no-op silenzioso.

### 7.5 Build + verifica
- `bunx cap sync android && ./gradlew.bat assembleDebug` → build verde con il plugin.
- `bun run build` + `bunx tsc --noEmit` + `bun run test` per il lato web.
- Comportamento reale (overlay, blocco, counter): **device fisico, occhio Antonio.**

---

## 8. Fasi differite (spec in `docs/tasks/35-…`, bloccate su risorse esterne)

- **M2 — Sostituzione TWA su Play**: signingConfig release legge `shadow-twa\shadow-upload.keystore`
  (da `keystore.properties` gitignorato); `versionCode` > ultimo AAB TWA; `assembleRelease`
  → AAB; upload sullo stesso track closed testing. **Tu**: keystore+password, Play Console.
  Release notes: "i tester rifanno il login una volta" (storage WebView ≠ Chrome).
- **M3 — Auth bridge Bearer**: `/api/auth/mobile-token` (JWE nel body) + refresh + cookie
  handoff; interceptor Bearer su ~42 fetch client; token in secure-storage; branch CORS
  in `middleware.ts` (**file protetto → tua conferma**). Oggi il cookie WebView basta → bassa urgenza.
- **M4 — Push FCM**: `@capacitor/push-notifications` → `/api/push-device` (shim su
  `/api/push-subscription` esistente); dispatcher web/FCM/APNs. **Serve W0**: service
  account Firebase (FCM HTTP v1) + chiavi VAPID. Oggi: niente VAPID, niente web-push.
- **M6 — IAP RevenueCat**: `@revenuecat/purchases-capacitor`, paywall via `getOfferings()`.
  **Serve** account RevenueCat + entitlements/webhook di **W2** (non fatto).

---

## 9. Verifica per step (self-verification, regola Workflow v2)

Ad ogni checkpoint Code esegue e committa solo a verde:
`bun run build` + `bunx tsc --noEmit` + `bun run test` + (per Android)
`./gradlew.bat assembleDebug`. Report finale: file toccati, path APK, comandi di
test manuale per Antonio, cosa resta gate-umano.

## 10. Rischi & rollback

- **Backup esiste** → qualsiasi stato si può ripristinare.
- **Download pesanti** (SDK + Gradle) → solo tempo/banda.
- **Cookie WebView volatili** (cold restart) → path "sessione scaduta → re-login" pulito
  (NextAuth è JWT-strategy: cookie perso = re-login). M3 lo blinda; non necessario per M1.
- **`server.url`** è pattern "documentato ma con caveat" (offline/OAuth-redirect a tuo
  carico) — non un bug Capacitor.
- **OEM background-kill** (Samsung/Xiaomi) → affidabilità del blocco, non policy:
  battery-exemption + FGS persistente + schermata affidabilità.
- **Play review** del blocco app: rischio **moderato gestibile** (app live con questa
  feature esistono); serve **video demo** + posizionamento "digital wellbeing
  auto-imposto, NON parental control". Gate tuo in fase di submission.
- **Conflitto install con la TWA**: risolto dal `.debug` suffix.

## 11. Ordine operativo consigliato

1. Fase 0 (toolchain) → 2. Fase 1 scaffold+config → 3. **primo APK proof-of-life**
   (carica prod, autonomo) → 4. guscio web-side su `feature/59-…` →
5. Fase 2 plugin blocco → APK con blocco → 6. report. Push/merge e occhio sul
   telefono: tu. Fasi 3–6 quando sblocchi le risorse esterne.

---

## 12. Stato esecuzione (2026-06-19) — Fasi 0–2 COMPLETE

Eseguito in autonomia su `feature/59-app-nativa-android`. Tutti i gate verdi:
`tsc --noEmit` OK, `vitest` 797/797, `gradlew assembleDebug` BUILD SUCCESSFUL,
`bun run build` OK.

**Fase 0** — SDK Android in `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools/latest,
platform-tools, android-34, build-tools 34.0.0); `adb` 1.0.41; `ANDROID_HOME` persistito.

**Fase 1 (M1)** — `app-debug.apk` (16 MB) in
`android/app/build/outputs/apk/debug/`. Package runtime `com.shadow.adhd.executor.debug`
(suffix .debug → convive con la TWA), minSdk 26, targetSdk 34, label "Shadow".
Carica `https://shadow-app2.vercel.app`. Commit `e7ac065`.

**Fase 2 (M5)** — plugin nativo `ShadowAppBlocker` compilato nell'APK:
FGS specialUse + polling UsageStats (~900ms) + overlay TYPE_APPLICATION_OVERLAY
"Torna a Shadow" + whitelist sistema + auto-stop a endsAt. Permessi nel manifest
(PACKAGE_USAGE_STATS, SYSTEM_ALERT_WINDOW, FOREGROUND_SERVICE_SPECIAL_USE,
POST_NOTIFICATIONS), `<queries>` MAIN/LAUNCHER (no QUERY_ALL_PACKAGES).
Facade `focus-shield.ts` agganciata a start/end strict mode; PATCH `/api/strict-mode`
persiste `distractionsBlocked`; disclosure+permessi via `ShieldPermissionGate`.

**Deviazioni dalla spec 35 (motivate, annotate qui):**
- **Java, non Kotlin** — l'app module Capacitor è Java (come `MainActivity.java`):
  niente plugin Gradle Kotlin da aggiungere → build verde garantita, zero rischio
  toolchain. Coerente con la regola "match the surrounding code".
- **Plugin embeddato nell'app module** (`…/blocker/`), non in `plugins/shadow-app-blocker/`
  con bun workspaces: runtime identico, zero plumbing workspace. Riusabilità persa
  (irrilevante per app singola; iOS = W6 avrà il suo).
- **Default "blocca tutto tranne whitelist"** quando `packages` è vuoto (oggi lo
  strict mode non ha un picker di app). `getInstalledApps()` è già pronto per un
  picker futuro.
- **Batteria**: aperta la lista `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (niente
  permesso `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, sensibile su Play).

**Cosa resta a te (Antonio):**
1. **Occhio reale sul telefono**: installare l'APK (`adb install -r app-debug.apk`,
   o copiarlo sul device) — login, e verifica del blocco avviando uno strict mode
   (il blocco vero non è verificabile headless). Nota: se hai la TWA installata,
   l'APK debug si installa a fianco (package `.debug`).
2. **Deploy del guscio web-side**: push/merge di `feature/59-…` → Vercel, perché le
   modifiche web (gate SW, scudo, disclosure) abbiano effetto nella WebView (il
   binario carica il remoto). Regola "web prima, binario poi".
3. **Fasi differite** (M2 Play / M3 auth bridge / M4 push / M6 IAP): vedi §1 e §8.
