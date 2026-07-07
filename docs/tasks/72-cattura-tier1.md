# Task 72 — Cattura Tier 1: share nativo, foto→OCR on-device, fondazione `source`/`sourceRef`

> Origine: brief esterno "12-cattura-tier1-brief" (epoca pre-Capacitor/pre-Task 67).
> Ricognizione Fase 0 eseguita il 2026-07-08 contro HEAD (main, post-catena 63→71).
> Piano approvato da Antonio il 2026-07-08 (plan mode). Branch: `feature/72-cattura-tier1`.
> Il processo del brief (ratifica R6, diff-as-text, no-code) è superato dal Workflow v2;
> restano sotto conferma esplicita i file protetti (schema.prisma, prompts.ts, migration).

## 0. Decisioni ratificate

| Decisione | Esito |
|---|---|
| Share nativo Android (ACTION_SEND) | **In questo task** (l'APK nativo, distribuito ai beta tester, oggi non ha share) |
| Foto→OCR | **OCR on-device adesso** (ML Kit, zero LLM, immagine mai caricata). La vision LLM in chat resta intatta |
| Apertura review per catture esterne | **Variante dedicata** SHARE/OCR in prompts.ts, stile "nomina ma non rinfaccia" |

Decisioni minori (regola 8, annotate): `source` non granulare (`share`, `ocr`; testo vs URL
ricavabile da `sourceRef`); nuovo campo `Task.sourceRef` (precedente: doc 26 lo proponeva per
Gmail/W8) invece di riusare `description`; dedup solo per catture esterne; parsing date
server-side per `share`, client-side con conferma per `ocr`; plugin nativo **custom** sul
pattern `AppBlockerPlugin` (zero dipendenze npm; ML Kit = sola dipendenza gradle); voce nativa
via `RecognizerIntent` (zero permessi).

## 1. Report Fase 0 — ricognizione e divergenze dal brief

### 1.1 Guscio nativo
- `capacitor.config.ts`: appId `com.shadow.adhd.executor`, **server.url remoto** su
  `https://shadow-app2.vercel.app`, `androidScheme: 'https'` → i cookie NextAuth funzionano
  same-origin nella WebView (l'auth nativa Android NON è un problema; il "problema iOS" del
  brief §5 resta reale ma fuori scope: `ios/` non esiste).
- Capacitor **6.2.1** (`@capacitor/core`, `@capacitor/android`, `@capacitor/app`); nessun
  plugin community. `@capacitor/camera` assente (e non serve: usiamo intent di sistema).
- `AndroidManifest.xml`: solo MAIN/LAUNCHER + `BlockerService` (Task 59/W5-M5).
  **Nessun intent-filter ACTION_SEND**. FileProvider già configurato con `cache-path`.
- Plugin custom esistente (pattern da riusare): `AppBlockerPlugin.java` registrato in
  `MainActivity`, chiamato dal web via `registerPlugin<...>('ShadowAppBlocker')`
  (`src/lib/native/app-blocker.ts`); init in `src/components/native/native-bootstrap.tsx`.
- Nessun listener `appUrlOpen` / deep link consumer nel layer web.

### 1.2 Come un item entra oggi in inbox (mappa world → inbox)
1. **Quick-add UI** (InboxView, anche vocale via Web Speech) → `POST /api/tasks` → `source:'manual'`.
2. **Chat** (incl. **foto/PDF via vision LLM**, Task 54) → tool `create_task`
   (`src/lib/chat/tools.ts:878`) → `source:'manual'`, `aiClassified:true`, dedup titolo
   case-insensitive tra non-terminali (`tools.ts:854`).
3. **Share PWA/TWA** (Task 67/71): manifest `share_target` → SW v11 intercetta il POST /,
   `POST /api/tasks {title: [title,text,url].join(' — '), status:'inbox'}` **senza LLM** →
   `source:'manual'` (default), URL perso dentro il titolo. Fallback onesto `?text=` (cap 500,
   `truncated=1`) → precompila la chat; stash `shadow-share-pending` sopravvive al login.
4. **Ricorrenti** (Task 46): materializzazione lazy → `source:'recurring'`.
5. **Calendar import** (`PUT /api/calendar`): dedup per `calendarEventId`, `source:'manual'`.

### 1.3 Divergenze brief ↔ HEAD (da segnalare, non "correggere in silenzio")
- **Lo share esiste già** (web/TWA) e rispetta "nessun LLM in cattura" — il brief lo dava da
  costruire. Ma **nel guscio nativo il SW è disattivato** (`tasks/page.tsx:752`) → l'APK non
  compare nel menu Condividi. Nessuna milestone W5 lo prevedeva.
- **`source` reali a HEAD**: `manual | gmail | review_carryover | recurring` (schema:148).
  `review_carryover` è **definito ma mai assegnato** (il carryover scrive `DailyPlanTask`,
  non crea Task); `gmail` è riservato a W8 fase 2. Il brief citava solo i primi tre.
- **`sourceRef` non esiste** (il brief lo sospettava): l'URL condiviso finisce concatenato
  nel `title` (sw.js:131).
- **Dedup**: esiste solo nel tool chat, **non** su `POST /api/tasks` (il percorso dello share).
- **Parsing date cheap: inesistente** — c'è solo keyword→urgency score
  (`profiling-engine.ts:157`), che non produce una data.
- **Foto→task esiste già ma via vision LLM cloud** (Haiku→Sonnet), in contraddizione col
  principio del brief "nessuna chiamata LLM in cattura / OCR on-device". Decisione: le due vie
  convivono (vision in chat per ricchezza, OCR on-device per privacy/costo zero).
- **Voce**: quick-add vocale già esistente (Web Speech, `tasks/page.tsx:2265`) → il brief
  aveva ragione ("già esistente") **solo per web/TWA**: l'Android System WebView non
  implementa Web Speech → sull'APK il mic degrada a toast. Gap chiuso dalla Slice E.
- **Widget**: shortcuts PWA già presenti (`?action=inbox|today`). Widget homescreen: assente,
  non pianificato → differito post-W5 (come il brief stesso suggeriva).
- **Varianti review**: keyed su `source` in `prompts.ts:699-727` (GMAIL/MANUAL/CARRYOVER),
  selezione in-prompt (orchestrator inietta `source` in `CURRENT_ENTRY_DETAIL:1772` e non va
  toccato — il brief supponeva la selezione in orchestrator).
- **Unit economics**: il gating per tier (W2) e il model router (W3) sono solo spec — la
  cattura resta core per tutti, nessun gating in questo task.

## 2. Contratto di ingestione (§4.0 del brief, adattato)

Ogni cattura esterna produce una voce inbox grezza:
- `title` = testo grezzo (share: `[title, text]` cap 500; OCR: prima riga significativa,
  editabile alla conferma). L'URL NON va nel titolo.
- `source` = `'share'` o `'ocr'` — **whitelist server-side**: il client non può dichiarare
  altri valori (`recurring` alimenta le stelle del Cielo, `gmail` è riservato a W8).
- `sourceRef` = URL condiviso o testo OCR integrale (cap server 2000, `@db.Text`).
- `status='inbox'`, `aiClassified=false`, `deadline` = null oppure data parsata cheap
  (share: server, mai bloccante; OCR: scelta esplicita dell'utente tra i candidati).
- **Nessuna chiamata LLM in cattura.**
- Dedup (solo share/ocr): stesso `sourceRef` non vuoto oppure stesso `title`
  (case-insensitive) tra i task non-terminali dell'utente → 200 `{task, alreadyExists:true}`.

## 3. Slices

- **B1 — Schema**: `Task.sourceRef String @default("") @db.Text` + commento enum `source`
  esteso. Migration `task_source_ref` (royal-feather; prod via migrate-on-deploy). Nessun
  indice nuovo (scala beta; si rivaluta a W8 quando `sourceRef` servirà al dedup Gmail).
- **B2 — Ingestione**: `src/lib/capture/date-extract.ts` (euristiche IT: gg/mm/aaaa,
  gg-mm-aaaa, gg/mm con anno inferito, "entro il/scadenza/pagare entro", mesi testuali;
  candidati `{date, snippet}`; Europe/Rome); `POST /api/tasks` (whitelist `source`,
  `sourceRef` cap 2000, dedup, deadline per share); `public/sw.js` → **v12** (payload separa
  title/sourceRef/source; fallback `?text=` invariato). Unit test + probe
  `scripts/e2e/task72/probe-b-ingestion.ts`; riallineati i pin SW stale nei probe storici.
- **B3 — Review**: varianti SHARE e OCR in `prompts.ts` (normale/high-avoidance ×
  direct/gentle/challenge), enum riga 667, regola temporale GMAIL estesa a SHARE/OCR.
  Verifica con run LLM reale.
  **Deviazione dal piano (ratificata via permission)**: il run LLM ha mostrato che
  la PRIMA entry si apre quando `CURRENT_ENTRY` è ancora null e la riga candidate
  non esponeva `source` → l'entry ocr apriva in stile GMAIL. Fix: `source=` aggiunto
  alle righe candidate del blocco TRIAGE CORRENTE (`orchestrator.ts`, solo dato,
  zero logica) + nota nel prompt. Secondo run: 11/11, aperture con origine corretta.
- **C — Share nativo**: intent-filter `ACTION_SEND` (`text/plain`, `image/*`);
  `ShadowCapturePlugin.java` (cold start + `handleOnNewIntent`, `getPendingShare()`
  consume-once, evento `shareReceived`, immagini copiate in cache); `src/lib/native/capture.ts`;
  wiring in `native-bootstrap.tsx`: testo → POST `{source:'share', sourceRef:url}` → banner
  "salvato" riusato; 401 → stash `shadow-share-pending` esistente.
- **D — OCR on-device**: gradle `com.google.mlkit:text-recognition` (bundled, ~+4MB,
  offline); plugin `capturePhoto()` (ACTION_IMAGE_CAPTURE + FileProvider cache, **nessun
  permesso CAMERA**), `pickImage()` (Photo Picker), `recognizeText({path})` (ML Kit), file
  temporaneo cancellato subito (immagine mai persistita né caricata);
  `src/features/capture/OcrCaptureSheet.tsx` (preview, titolo editabile, chip date da
  date-extract, conferma) → POST `{source:'ocr', sourceRef: testo}`; bottone camera in
  InboxView (solo `isNative()`); immagini condivise (Slice C) instradate qui.
- **E — Voce nativa**: `startSpeech()` via `RecognizerIntent` it-IT nel plugin;
  `useVoiceCapture` usa il plugin quando `isNative()`.
- **F — Docs**: ROADMAP, nota su doc 35 (W5), riga privacy/account-deletion (share salva
  testo/URL; OCR on-device, immagine mai caricata), report finale con checklist Data Safety
  per Antonio e passi di test manuale APK.

## 4. Acceptance criteria

1. Share da app terza (web/TWA **e** APK nativo) → voce inbox con `source:'share'`,
   `sourceRef`=URL (se presente), titolo senza URL; secondo share identico → nessun duplicato;
   senza sessione → il testo sopravvive al login (percorso esistente).
2. Share con testo contenente "entro il 15/08" → `deadline` valorizzata; testo senza data →
   `deadline` null. Mai errori bloccanti dal parser.
3. `POST /api/tasks` con `source:'recurring'|'gmail'|altro` → 400.
4. Su APK: camera → OCR → sheet con date candidate → conferma → voce inbox `source:'ocr'`
   con `sourceRef`=testo OCR; l'immagine non esiste più su disco a conferma avvenuta; nessuna
   richiesta di rete contiene l'immagine.
5. Review serale su entry `share`/`ocr` → apertura con la variante dedicata (run LLM reale),
   tono "nomina ma non rinfaccia" (Layer 2 rispettato in high-avoidance).
6. Voce su APK: mic → dialog di sistema → trascritto in input inbox.
7. `bun run build`, `bunx tsc --noEmit`, `bun run test`, probe task72 verdi;
   `gradlew assembleDebug` verde; probe storici non regrediti.

## 5. Fuori scope (dichiarato)

iOS/share extension (W6; token handoff §5 del brief resta aperto lì), widget homescreen
nativo, share immagini→vision su **web** (il SW non passa file al client in questo giro;
sull'APK le immagini condivise vanno all'OCR), Gmail ingest (W8), gating per tier (W2),
i18n dei nuovi testi UI (italiano hardcoded; chiavi next-intl a W4 col re-install).

## 6. Rischi/note

- Qualità OCR variabile su foto reali → conferma utente obbligatoria, mai auto-save.
- SW v12 = reload bundle per i client web (regola bump rispettata, ChatView cambia).
- APK debug (`.debug`) convive con la TWA → due "Shadow" nel share sheet in dev (atteso).
- Sessioni Code concorrenti: branch-check separato prima di ogni commit.
