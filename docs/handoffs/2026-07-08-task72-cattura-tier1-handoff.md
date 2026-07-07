# Handoff sessione 2026-07-08 — Task 72 "Cattura Tier 1" (COMPLETO, non pushato)

> Per la prossima sessione di Claude Code. Committato su
> `feature/72-cattura-tier1` (9º commit) su richiesta di Antonio.
> Leggere per intero prima di toccare il repo.

## 1. Stato git ESATTO a fine sessione

- `main` = `b40c83d` = `origin/main` (contiene TUTTA la catena 63→71, verificato).
- **`feature/72-cattura-tier1`** = branch corrente a fine sessione, **8 commit
  sopra main, NON pushato** (decisione Antonio: per ora non si pusha):
  1. `36fc0ca` docs(72): spec
  2. `d1062bf` feat(schema): `Task.sourceRef` + source share/ocr (B1)
  3. `3122692` feat(capture): contratto ingestione — whitelist, dedup, date cheap, SW v12 (B2)
  4. `de4a906` feat(review): varianti apertura SHARE/OCR + source= righe candidate (B3)
  5. `0dc8a5a` feat(native): share sheet Android testo/URL (C)
  6. `bd5cfe8` feat(capture): foto→OCR on-device ML Kit (D)
  7. `e1813b0` feat(capture): voce nativa RecognizerIntent (E)
  8. `779a56c` docs(72): ROADMAP, nota W5, privacy, report finale (F)
  9. (ultimo) docs(handoff): questo file
- Working tree: puliti i tracked; untracked storici invariati (reel-*/, GuidaShadow/,
  cowork/, mint-*.txt, .next-stale-nul-panic/, docs/handoffs/*).
- **Migration `20260707225908_task_source_ref` APPLICATA a royal-feather (dev)**.
  Prod (purple-paper) la riceverà da `migrate-on-deploy` al primo deploy dopo il
  merge. Nessun'altra modifica di schema.

## 2. Cosa è entrato col Task 72 (in una riga per pezzo)

- `Task.sourceRef String @default("") @db.Text` + enum commento `source` esteso
  (`share | ocr`) — [prisma/schema.prisma:148].
- `POST /api/tasks`: whitelist `source` ∈ {share, ocr} (400 altrimenti — MAI
  accettare `recurring`/`gmail` dal client: `recurring` alimenta le stelle del
  Cielo), `sourceRef` cap 2000, **dedup solo catture esterne** (share: sourceRef
  O titolo case-insensitive tra non-terminali; ocr: SOLO sourceRef), deadline
  auto per share da `extractDeadline` (solo candidati confident).
- `src/lib/capture/date-extract.ts`: euristiche date IT zero-LLM (gg/mm/aaaa,
  gg/mm anno inferito, mesi testuali, keyword "entro/scadenza/…"; URL strippati).
- `public/sw.js` → **v12**: il POST share dichiara `source`+`sourceRef`, l'URL
  esce dal titolo; fallback `?text=` invariato.
- `src/lib/chat/prompts.ts`: varianti apertura SHARE e OCR (nomina-non-rinfaccia,
  menzione origine OBBLIGATORIA), regola temporale estesa a SHARE/OCR, nota
  prima-entry. `src/lib/chat/orchestrator.ts`: SOLO `source=` aggiunto alle due
  righe candidate (~riga 1700) — deviazione ratificata, motivo sotto (§4).
- Nativo: `android/.../capture/ShadowCapturePlugin.java` (ACTION_SEND testo e
  immagini, `capturePhoto` via intent SENZA permesso CAMERA, `pickImage` Photo
  Picker, `recognizeText` ML Kit **bundled** con delete immediato del file,
  `startSpeech` RecognizerIntent it-IT), registrato in `MainActivity`; 2
  intent-filter in `AndroidManifest.xml`; dep gradle `com.google.mlkit:text-recognition`.
- Web nativo: `src/lib/native/capture.ts` (iface), `src/lib/capture/native-share.ts`
  (riusa 1:1 il contratto URL `?action=share&saved=1|text=` del SW — zero UI nuova),
  `src/features/capture/OcrCaptureSheet.tsx` (sheet globale, evento
  `shadow:ocr-open`, chip date, POST source ocr), wiring in
  `src/components/native/native-bootstrap.tsx`, bottone camera + ramo voce nativa
  in `src/app/tasks/page.tsx` (useVoiceCapture).
- Legale: `src/app/privacy/page.tsx` §3 e `src/app/account-deletion/page.tsx` §3
  aggiornate (catture; OCR on-device, immagine mai caricata).
- Docs: `docs/tasks/72-cattura-tier1.md` (spec + report Fase 0 con TUTTE le
  divergenze dal brief esterno), `docs/tasks/72-report-finale.md` (report, passi
  test manuale APK, checklist Data Safety), ROADMAP (entry 2026-07-08), nota in
  `docs/tasks/35-v3-w5-capacitor-android.md` (cattura NON è più scope W5).

## 3. Verifiche già fatte (e come rifarle)

- 1148 test (`bun run test`), tsc pulito (**`bun x tsc --noEmit` — `bunx` NON
  esiste nel PATH del Bash tool**), `bun run build` exit 0 (⚠️ EPERM Prisma su
  Windows se dev server/studio aperti: chiuderli prima).
- Probe (servono dev server :3000 + DB royal-feather):
  `bun run dotenv -e .env.local -- bun scripts/e2e/task72/<probe>.ts` per
  probe-b-ingestion (37), probe-c-native-share (17), probe-d-ocr (21),
  probe-e-voice (9). Run LLM reale: `scripts/e2e/task72/run-llm-variants.ts`
  (11/11, ~$0.5/run). Smoke storici toccati: task67/probe-a-share e
  task65/probe-contracts (pin SW resi tolleranti ≥vN — erano già marci a HEAD).
- APK: `cd android && ANDROID_HOME="C:\Users\antot\AppData\Local\Android\Sdk"
  ./gradlew.bat -p C:/shadow-app/android assembleDebug` → verde, ~38s.

## 4. Gotcha scoperti in QUESTA sessione (non ripeterli)

1. **Righe candidate del TRIAGE senza `source`**: la PRIMA entry della review si
   apre quando `CURRENT_ENTRY` è ancora null → senza `source=` nella riga
   candidate il modello non può applicare la variante (apriva in stile GMAIL).
   Visto SOLO col run LLM reale; il probe iniziale dava un falso PASS perché
   il regex `lett[ao]` matchava dentro "bo-lletta". Morale: per cambi prompt,
   run LLM reale sempre, e regex di assert con word boundary.
2. **Android WebView non implementa Web Speech** → la voce "già esistente" del
   brief valeva solo per web/TWA; sull'APK ora c'è RecognizerIntent.
3. Probe storici che pinnano la versione SW esatta marciscono a ogni bump:
   pattern nuovo = `assert(swVersion >= N)`.
4. Porta 3000: il preview MCP vuole gestirsi il server — se un `bun run dev` gira
   in background va killato (taskkill per porta, i worker node sopravvivono al
   PID di bun).
5. Neon dev può chiudere la connessione a freddo (P1017 transiente): retry e basta.

## 5. Cosa RESTA aperto (in ordine di probabilità che serva alla prossima sessione)

- **Test manuale APK di Antonio** (7 passi in `docs/tasks/72-report-finale.md` §Test
  manuale): share testo/scadenza/da-sloggato, share immagine→OCR, camera→OCR su
  bolletta vera, voce, review con entry share/ocr. Eventuali fix da lì = nuova
  micro-slice su QUESTO branch (`feature/72-cattura-tier1`), NON su main.
- **Push/merge di feature/72**: SOLO Antonio. Non pushare mai (hook blocca main
  comunque).
- **Data Safety Play Console**: a carico Antonio alla prossima submission (W9/M2);
  annotato in report §Checklist store e nella nota W5.
- Fuori scope dichiarati (NON iniziare senza brief): iOS/share extension (W6),
  widget homescreen (post-W5), share immagini su web (SW→client file passing),
  Gmail ingest (W8 — erediterà `sourceRef` per il dedup), gating tier (W2),
  voce conversazionale (v1.1).

## 6. Regole di sessione (invariate ma ripetute perché costano care)

- Branch-check SEPARATO prima di ogni commit (sessioni concorrenti = index
  condiviso); `git add` path-by-path, mai wildcard.
- Protetti sotto conferma esplicita: schema.prisma, migration, prompts.ts,
  orchestrator.ts, tools.ts, update-plan-preview-handler.ts, package.json,
  next.config, .env*, .claude/*, push.
- Probe SOLO su royal-feather (preflightDb obbligatoria, lib condivisa =
  `scripts/e2e/collaudo-68/lib.ts`); MAI probe scriventi su preview Vercel
  (condividono la DATABASE_URL di prod).
- Nuove route sotto src/app → aggiornare il matcher di `src/middleware.ts`.
- Memoria auto della sessione: `shadow-task72-cattura-tier1.md` (+ indice
  MEMORY.md aggiornato, incluso lo stato "catena 63→71 dentro main").
