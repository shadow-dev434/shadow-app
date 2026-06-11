# Task 22 — TWA packaging: runbook closed testing (Play Store)

> **Owner esecuzione:** Giulio (R6).
> **Owner web-side:** già completato (vedi "Stato lato web"). Questa parte
> non va più toccata salvo compilazione dei fingerprint allo step 7.
> **Package name DEFINITIVO:** `com.shadow.adhd.executor` — immutabile dopo
> la prima pubblicazione su Play. Deve combaciare *ovunque* (bubblewrap
> `applicationId`, Play Console, assetlinks).

---

## 0. Cos'è questo documento

Runbook per impacchettare la PWA Shadow come **TWA** (Trusted Web Activity)
e pubblicarla su un track di **closed testing** di Google Play. La TWA è un
wrapper Android che apre `https://shadow-app2.vercel.app` a schermo intero
(senza barra URL) *a patto che* la verifica Digital Asset Links passi — ed è
lì che entrano i due fingerprint.

Tutto il lato web è già pronto e verificato. Restano i passi Android +
Play Console, che esegue Giulio.

---

## 1. Stato lato web (pronto — NON modificare, eccetto step 7)

Preparato il 2026-06-09 (Task 22, parte web):

| Cosa | Stato | Dove |
|---|---|---|
| `manifest.json` (display `standalone`, icone maskable 192/512) | ✅ servito | `https://shadow-app2.vercel.app/manifest.json` |
| Service worker `/sw.js` registrato | ✅ | `src/app/tasks/page.tsx` |
| Icone 192 / 512 / maskable-192 / maskable-512 | ✅ presenti | `public/` |
| `<link rel="manifest">` + `<meta name="theme-color" content="#18181b">` | ✅ emessi via Metadata API di Next (non tag literal — non cercarli a mano nell'HTML sorgente) | `src/app/layout.tsx` |
| `assetlinks.json` con **2 placeholder** fingerprint | ✅ servito, `Content-Type: application/json`, HTTP 200 (verificato in locale su Next 16.2.4 — nessun quirk dotfolder) | `public/.well-known/assetlinks.json` |
| `.gitignore` copre `*.keystore` / `*.jks` | ✅ | `.gitignore` |

Contenuto attuale di `public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.shadow.adhd.executor",
      "sha256_cert_fingerprints": [
        "__APP_SIGNING_KEY_SHA256__",
        "__UPLOAD_KEY_SHA256__"
      ]
    }
  }
]
```

I due placeholder vanno sostituiti con fingerprint reali allo **step 7**.

> Nota: il middleware NextAuth (`src/middleware.ts`) **non** intercetta
> `/.well-known/*` (non è nel `matcher`), quindi assetlinks è servito come
> statico puro. Non serve toccare middleware né `sw.js`.

---

## 2. Prerequisiti toolchain (Giulio installa — NON installati in questa run)

- **Node.js LTS** (≥ 20).
- **JDK 17** (Temurin/Adoptium consigliato). Anche se bubblewrap può gestire
  una JDK propria, `keytool` (estrazione fingerprint) serve comunque.
- **Android SDK** (build-tools + platform-tools). bubblewrap può scaricarne
  uno gestito al primo `init`.
- **Bubblewrap CLI:** `npm i -g @bubblewrap/cli`
- Validare l'ambiente: `bubblewrap doctor`

---

## 3. Decisioni già fissate (non re-discutere)

| Parametro | Valore |
|---|---|
| Application ID / package | `com.shadow.adhd.executor` |
| Host | `shadow-app2.vercel.app` |
| Manifest URL | `https://shadow-app2.vercel.app/manifest.json` |
| Signing | **Play App Signing** abilitato (default nuove app) |
| Track | Closed testing |

---

## 4. Sequenza passi

### Step 1 — Init progetto TWA

```bash
bubblewrap init --manifest https://shadow-app2.vercel.app/manifest.json
```

- Quando chiede l'**Application ID / package name**, inserire
  `com.shadow.adhd.executor`. **NON accettare il default** derivato dall'host
  (sarebbe tipo `app.vercel.shadow_app2.twa`).
- Domain: `shadow-app2.vercel.app`. Launcher name e colori vengono dal
  manifest (controllare che siano corretti).
- Output: `twa-manifest.json` + progetto Android.
- **Tenere il progetto Android FUORI dal repo Next.** Consigliato:
  `C:\shadow-twa\` (path senza spazi). NON dentro `C:\shadow-app`.

### Step 2 — Keystore (upload key)

bubblewrap propone di generare un keystore in fase di init. Generare un
**upload keystore** dedicato (se non già fatto da bubblewrap):

```bash
keytool -genkeypair -v -keystore android.keystore -alias android \
  -keyalg RSA -keysize 2048 -validity 9125
```

- Annotare alias, password keystore e password chiave in un password manager.
- **Mai committare** il `.keystore` (il repo web ignora `*.keystore`/`*.jks`;
  il progetto TWA va tenuto fuori dal repo o con un suo `.gitignore`).
- Questa è l'**upload key**: con Play App Signing NON è la chiave finale che
  firma l'app distribuita (quella la gestisce Google) — serve a firmare
  l'AAB che carichi. Vedi step 6.

### Step 3 — Build

```bash
bubblewrap build
```

- Produce `app-release-bundle.aab` (upload su Play) e
  `app-release-signed.apk` (test locale su device).
- Se fallisce su `JAVA_HOME` / SDK: lanciare `bubblewrap doctor` e
  correggere (vedi "Scar Windows").

### Step 4 — Test locale su device (consigliato, opzionale)

```bash
adb install app-release-signed.apk
```

A questo punto la TWA mostra **ancora la barra URL di Chrome**: è normale,
perché assetlinks non combacia ancora con la chiave. Sparirà solo dopo gli
step 5–8.

### Step 5 — Fingerprint #1: upload key (disponibile subito)

```bash
keytool -list -v -keystore android.keystore -alias android
```

- Copiare la riga `SHA256:` (formato `AA:BB:CC:...`, 32 byte).
- Questo è il valore per il placeholder **`__UPLOAD_KEY_SHA256__`**.
- In alternativa: `bubblewrap fingerprint` gestisce i fingerprint del
  progetto.

### Step 6 — Upload su Play + Play App Signing → Fingerprint #2: app signing key

1. Creare l'app su **Play Console** con package `com.shadow.adhd.executor`.
2. Creare un track **Closed testing** e caricare l'`app-release-bundle.aab`.
3. **Abilitare Play App Signing** (default): Google genera/gestisce la
   **app signing key** (la chiave con cui l'app viene firmata per gli utenti).
4. Recuperare l'SHA-256 della app signing key:
   **Play Console → (app) → Test and release → Setup → App signing →
   "App signing key certificate" → SHA-256.**
5. Questo è il valore per il placeholder **`__APP_SIGNING_KEY_SHA256__`**.

> ⚠️ **Ordine obbligato.** Il fingerprint della app signing key **esiste solo
> DOPO** il primo upload dell'AAB. Quindi assetlinks NON può essere
> completato prima di questo step. È la ragione per cui lato web abbiamo
> lasciato due placeholder e non un solo fingerprint.

### Step 7 — Compilare assetlinks + redeploy web

Editare `public/.well-known/assetlinks.json` nel repo web (`C:\shadow-app`):

- `__UPLOAD_KEY_SHA256__` → fingerprint dello step 5.
- `__APP_SIGNING_KEY_SHA256__` → fingerprint dello step 6.

**Tenere ENTRAMBI** i fingerprint nell'array (vedi tabella sotto sul perché).
Poi:

```bash
git add public/.well-known/assetlinks.json
git commit -m "chore(twa): fingerprint reali assetlinks per closed testing"
git push   # → Vercel redeploy
```

Verifica live:

```bash
curl -i https://shadow-app2.vercel.app/.well-known/assetlinks.json
```

Atteso: `200`, `Content-Type: application/json`, i due fingerprint reali.

Validazione ufficiale Digital Asset Links:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://shadow-app2.vercel.app&relation=delegate_permission/common.handle_all_urls
```

(oppure il generatore: https://developers.google.com/digital-asset-links/tools/generator)

### Step 8 — Verifica TWA su device

Reinstallare l'app dalla build firmata da Play (link internal/closed testing)
e verificare che la **barra URL sparisca** → la verifica Digital Asset Links
è passata.

Se la barra resta:
- assetlinks non ancora propagato (CDN/cache) → attendere e ricontrollare;
- fingerprint sbagliato o package name non combaciante → ricontrollare 5–7;
- aver dimenticato uno dei due fingerprint.

### Step 9 — Closed testing

- Aggiungere i tester (email singole o Google Group) al track closed testing.
- Condividere l'opt-in URL.
- Compilare la scheda store minima richiesta anche per closed testing:
  privacy policy URL, Data safety form, content rating, categoria, ecc.

---

## 5. I due fingerprint (punto critico)

| Placeholder | Chiave | Da dove si ottiene | Quando è disponibile |
|---|---|---|---|
| `__UPLOAD_KEY_SHA256__` | Upload key (keystore locale di Giulio) | `keytool -list -v -keystore android.keystore -alias android` | Subito (step 2) |
| `__APP_SIGNING_KEY_SHA256__` | App signing key (gestita da Google) | Play Console → Setup → App signing → SHA-256 | Solo dopo il 1º upload AAB (step 6) |

**Perché tenerli entrambi.** L'app distribuita agli utenti via Play è firmata
con la *app signing key* di Google; build/test installati direttamente (APK
firmato con la *upload key*) usano l'altra. Mantenere entrambi i fingerprint
evita che la verifica fallisca a seconda di come l'app è stata installata.
Non rimuoverne uno "tanto basta l'altro".

---

## 6. Scar Windows / PowerShell

- `keytool` è in `%JAVA_HOME%\bin\keytool.exe`. Se non è nel PATH:
  `& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore ...`
- Path con spazi (`C:\Program Files\...`) danno problemi a Gradle/bubblewrap:
  tenere il progetto TWA in un path senza spazi (es. `C:\shadow-twa`).
- `assetlinks.json` deve restare **UTF-8 senza BOM**. Attenzione a editor che
  aggiungono il BOM (rompe il parsing lato Google).
- Se `bubblewrap build` fallisce su `JAVA_HOME`: settare la var alla JDK 17 e
  **riavviare il terminale** prima di ritentare.
- Backuppare `.keystore` + password fuori dal repo (NON in `C:\shadow-app`):
  se perdi l'upload key puoi richiedere un reset a Google (con Play App
  Signing), ma è una scocciatura evitabile.

---

## 7. Cosa NON fare

- ❌ Cambiare `com.shadow.adhd.executor` (rompe identità Play + assetlinks).
- ❌ Committare keystore, chiavi, password.
- ❌ Rimuovere uno dei due fingerprint da assetlinks.
- ❌ Mettere il progetto Android dentro `C:\shadow-app`.
- ❌ Toccare `src/middleware.ts` o `public/sw.js` per "far servire" assetlinks:
  è già servito correttamente come statico.

---

## 8. Riferimenti

- Bubblewrap (TWA CLI): https://github.com/GoogleChromeLabs/bubblewrap
- Digital Asset Links: https://developers.google.com/digital-asset-links
- Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756
- TWA quick start: https://developer.chrome.com/docs/android/trusted-web-activity/

---

## Changelog

- **2026-06-09** — Parte web preparata (Task 22): `assetlinks.json`
  riportato a package `com.shadow.adhd.executor` con 2 placeholder fingerprint
  (il fingerprint reale precedente, residuo dall'initial commit, era stale —
  firmeremo con keystore nuova + Play App Signing); `.gitignore` esteso a
  `*.keystore`/`*.jks`; serve-test locale OK (200 + `application/json`).
  Build Android, keystore, account Play e deploy: a Giulio.
