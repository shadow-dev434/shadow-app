# Task 72 — Report finale: Cattura Tier 1

> Branch: `feature/72-cattura-tier1` (da main b40c83d). 8 commit, non pushato.
> Spec e report Fase 0: `docs/tasks/72-cattura-tier1.md`. Push/merge: decisione Antonio.

## Esito

Il brief esterno "cattura un gesto (Tier 1)" è stato riconciliato con HEAD ed
eseguito per intero nella parte applicabile. Tutte le slice pianificate sono
implementate e verificate:

| Slice | Contenuto | Commit |
|---|---|---|
| 0 | Spec + report Fase 0 (divergenze brief↔HEAD) | 36fc0ca |
| B1 | `Task.sourceRef` + enum source esteso, migration `task_source_ref` | d1062bf |
| B2 | Whitelist `source` {share,ocr}, dedup catture, date cheap zero-LLM, SW v12 | 3122692 |
| B3 | Varianti review SHARE/OCR + `source=` sulle righe candidate (orchestrator) | de4a906 |
| C | Share nativo Android (ACTION_SEND testo/URL, `ShadowCapturePlugin`) | 0dc8a5a |
| D | Foto→OCR on-device (ML Kit bundled, camera senza permesso, sheet conferma) | bd5cfe8 |
| E | Voce nativa (RecognizerIntent — il WebView non ha Web Speech) | e1813b0 |
| F | ROADMAP, nota W5, privacy/account-deletion, questo report | (ultimo) |

## Verifiche eseguite

- `bun run test`: **1148 verdi** (1114 pre-esistenti + 34 nuovi: date-extract 24,
  share payload 6, ocr-title 4).
- `bun x tsc --noEmit`: pulito. `bun run build`: verde (vedi ultimo commit).
- Probe e2e (dev :3000 + royal-feather): **84 assert** —
  `probe-b-ingestion` 37/37 (401/201/dedup/whitelist/deadline parsata/cap),
  `probe-c-native-share` 17/17, `probe-d-ocr` 21/21, `probe-e-voice` 9/9.
  Smoke: `task67/probe-a-share` 21/21 e `task65/probe-contracts` 21/21
  (pin SW resi tolleranti "≥ vN": erano già marci a HEAD).
- **Run LLM reale** (`run-llm-variants`, ~5 turni smart): 11/11 — apertura OCR
  «Dalla foto ho letto: bolletta TARI, scade tra 2 giorni — la chiudi?»,
  apertura SHARE «Iscrizione corso primo soccorso — te la sei condivisa da
  un'altra app. Che ne facciamo?», zero rinfacci (Layer 2). Il primo run ha
  scoperto che la prima entry apriva senza variante → fix `source=` sulle righe
  candidate (deviazione orchestrator ratificata via permission, annotata in spec).
- `gradlew assembleDebug`: verde con ML Kit (~+4MB APK).
- Browser (preview :3000): boot pulito, zero errori console con la sheet OCR
  montata nel layout; flussi share web verificati a livello HTTP dai probe
  (redirect login con param preservati, 401→testo mai perso).

## File toccati (principali)

- **Schema/DB**: `prisma/schema.prisma` (+`sourceRef`), migration
  `20260707225908_task_source_ref` (applicata a royal-feather; prod via
  `migrate-on-deploy` al deploy).
- **Server**: `src/app/api/tasks/route.ts` (whitelist source, sourceRef cap 2000,
  dedup, deadline share, `serializeTask` unificata).
- **Capture lib**: `src/lib/capture/date-extract.ts` (+test),
  `native-share.ts` (+test), `ocr-title.ts` (+test).
- **PWA**: `public/sw.js` → v12 (payload source/sourceRef, titolo senza URL).
- **Chat (protetti, confermati)**: `src/lib/chat/prompts.ts` (varianti SHARE/OCR,
  regola temporale estesa, nota prima-entry), `src/lib/chat/orchestrator.ts`
  (solo `source=` nelle righe candidate).
- **Nativo**: `android/.../capture/ShadowCapturePlugin.java` (share, camera,
  picker, ML Kit, voce), `MainActivity.java` (registrazione),
  `AndroidManifest.xml` (2 intent-filter SEND), `app/build.gradle` (ML Kit).
- **Web nativo**: `src/lib/native/capture.ts`,
  `src/components/native/native-bootstrap.tsx` (wiring share + mount sheet),
  `src/features/capture/OcrCaptureSheet.tsx`, `src/app/tasks/page.tsx`
  (bottone camera native-only, ramo voce nativa in `useVoiceCapture`).
- **Legale**: `src/app/privacy/page.tsx` §3 (voce catture: share salvato,
  OCR on-device, immagine mai caricata), `src/app/account-deletion/page.tsx` §3.
- **Docs**: spec 72, ROADMAP, nota su `docs/tasks/35-v3-w5-capacitor-android.md`.

## Test manuale APK (Antonio)

APK: `android/app/build/outputs/apk/debug/app-debug.apk` (package `.debug`,
convive con la TWA → in dev vedrai DUE "Shadow" nel menu Condividi: quello
nuovo è l'APK).

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
```

1. **Share testo**: da WhatsApp/Chrome, tieni premuto → Condividi → Shadow →
   l'app si apre sulla chat col banner "salvato"; in inbox trovi il task con
   titolo pulito (l'URL non c'è: è in `sourceRef`). Ricondividi lo stesso link:
   nessun duplicato.
2. **Share con scadenza**: condividi un testo tipo "pagare bolletta entro il
   15/08/2026" → il task nasce già con la deadline.
3. **Share da sloggato**: fai signout, condividi → login → il testo ricompare
   precompilato in chat (round-trip esistente).
4. **Foto→OCR**: inbox → bottone camera → fotografa una bolletta vera → sheet
   con testo letto + chip della data → conferma → task in inbox con scadenza.
   Verifica che NON ci sia richiesta di permesso fotocamera. (Qualità foto
   bassa → messaggio "Non ho letto testo", riprova.)
5. **Share immagine**: condividi uno screenshot di un avviso → stessa sheet OCR.
6. **Voce**: inbox → mic → dialog di sistema Google → parla → il trascritto
   finisce nell'input come su web.
7. **Review serale**: con un task da share e uno da OCR in inbox, la review
   apre con «te la sei condivisa…» / «Dalla foto ho letto…».

## Checklist store (per te, non bloccante ora)

- **Play Data Safety** (alla prossima submission, W9/M2): lo share aggiunge
  "contenuto condiviso dall'utente" ai dati raccolti (testo/URL, come i task);
  l'OCR NON aggiunge raccolta dati (elaborazione on-device, immagine mai
  trasmessa) — dichiararlo così. La riga è annotata anche nella nota W5.
- Coerenza a tre vie fatta a codice: Data Safety ↔ `/privacy` ↔
  `/account-deletion` (le due pagine sono aggiornate in questo branch).

## Costi / telemetria

- Cattura (share, OCR, voce): **zero LLM**, zero costi marginali.
- Review: varianti = prompt statico (+~1KB, delta cache trascurabile).
- Run di verifica LLM di questa sessione: 3 run (~15 turni smart totali, ~$1.2).

## Fuori scope / rischi residui

- iOS (niente `ios/`; il token handoff della share extension resta il punto
  duro di W6). Widget homescreen: differito post-W5. Share immagini su **web**
  (il SW non passa file al client): solo APK per ora. Gmail ingest: W8 (che
  erediterà `sourceRef` per il suo dedup). Gating tier: W2.
- La voce nativa usa il dialog di sistema (UX un gradino sotto il Web Speech
  inline): scelta deliberata zero-dipendenze; la voce conversazionale resta v1.1.
- OCR: qualità variabile su foto storte/scure — mitigata dalla conferma
  obbligatoria (mai auto-save) e dall'errore esplicito.
