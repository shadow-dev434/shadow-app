# W7 — Body doubling MAX (avatar 3D) + review profonda Opus

> Dipende da W3 (router) e, per il blocco app, da W5-M5 / W6-M8 (su web il
> shield è no-op: la feature funziona comunque con la sola friction esistente).
> Decisioni del piano 2026-06-11 (registro D1-D10 in ROADMAP, Fase v3):
> D3 = MAX include il body doubling; D6 = v1 con avatar 3D + check-in testuali,
> voce TTS rimandata alla v1.1 (cfr. ROADMAP Task 11 / spec 27).

## Rilascio beta web (2026-06-12, branch `feature/v3-w7-body-doubling`)

Anticipo della versione web durante la beta (brief Antonio, piano approvato).
Tagli ratificati rispetto a questa spec:

- **Shield nativo no-op** (`src/lib/focus-shield.ts`, TODO W5-M5/W6-M8): solo
  friction esistente. `StrictModeExitDialog` **estratto dal monolite** in
  `src/features/strict-mode/` (controlled, store-free; il monolite usa il
  wrapper `StrictModeExitDialogConnected`).
- **Check-in su Haiku hardcoded** (`callLLM tier 'fast'` in
  `/api/body-double/checkin`, TODO W3 router); costi in `AiUsage`
  (`recordAiUsage`, taskClass `body_double_checkin`), cap giornaliero
  `BODY_DOUBLE_DAILY_CHECKIN_CAP` (default 150, 0 = kill-switch).
- **Niente gating** (TODO W2): i beta tester hanno MAX promozionale.
- **Voce**: taglio parzialmente superato su richiesta di Antonio in chat
  (2026-06-12, sera): **voce in USCITA anticipata** — i check-in (e il fine
  timer) sono parlati, toggle in header persistito, default ON.
  **Upgrade 2026-06-13 (branch `feature/27-voice-tts`)**: TTS server-first via
  **ElevenLabs** (`eleven_flash_v2_5`, REST zero-SDK in `src/lib/voice/`,
  route `/api/voice/speak`) con fallback automatico a `speechSynthesis` su
  501/errori/autoplay-block. Vendor unico deciso con Antonio (account
  ElevenLabs esistente; la chiave NON ha scope voices_read → voce premade
  Rachel di default, override `VOICE_TTS_VOICE_ID`). Costi in `AiUsage`
  taskClass `voice_tts` (tokensOut=caratteri, ~$0,0015/check-in), cap
  `VOICE_TTS_DAILY_CAP` (default 300, 0=kill-switch). Probe
  `scripts/e2e/probe-voice-speak.ts` PASS 8/8. Env prod: **ELEVENLABS_API_KEY
  va aggiunta su Vercel** prima del deploy, altrimenti degrado silenzioso a
  voce browser. **Mic/STT restano v1.1**: ElevenLabs **Scribe** come STT
  primario (stesso vendor), Deepgram solo se lo spike boccia le latenze;
  resta lo spike GO/NO-GO sul microfono nella TWA prima di prometterlo ai
  tester.
- **Niente review profonda Opus** (resta in questa spec per il W7 pieno).
- Sessione: riuso `POST /api/strict-mode` con `triggerType:'body_double'`
  (+ `PATCH action:'extend'` per il +15 a fine timer). Niente
  ChatThread/persistenza dei check-in: stato client + `AiUsage`.

Decisioni di prodotto (domande poste 2026-06-12, nessuna risposta → applicate
le raccomandate, annotate qui):

| Tema | Decisione |
|---|---|
| Modello VRM | ~~Vita.vrm~~ → **Sendagaya_Shino.vrm** (pixiv/VRoid, CC0). La verifica licenza 2026-06-12 ha scartato Vita: CC0 non confermabile (FAQ 403 per i bot, OpenGameArt non la elenca, mirror senza il file). Shino è CC0 confermato (OpenGameArt + mirror madjin/vrm-samples, 15MB). Asset committato: `public/models/avatar-v1.vrm` + `LICENSE-avatar.md` (link FAQ da verificare a occhio prima del lancio pubblico). |
| Aspetto | Richiesto neutro/androgino, ma nessun CC0 verificato disponibile → applicato il fallback documentato nella domanda di prodotto: **femminile anime-style** (Shino). Swap libero in seguito (es. custom VRoid Studio di Antonio), file versionato senza tocchi al codice. |
| Timer | Default da `task.sessionDuration` (25), preset 25/50/90; a scadenza bolla locale +15/chiusura (no LLM). |
| Check-in | Quick-reply "Tutto ok / Sono bloccato / Fatto!" → `lastOutcome` del check-in successivo; "Sono bloccato" → check-in immediato; niente testo libero. |

Scelte minori: pausa ferma check-in/avatar ma il countdown continua; testi
italiani hardcoded (vista nuova, i18n in W4); l'avvio NON cambia lo status del
task (solo micro-step); fix collaterale: il client strict-mode non mandava
`mode` al POST (sessioni mai create server-side) — corretto.

Stato (2026-06-12, sera — COMPLETO sul branch): migration W1 applicata
(autorizzata, `20260612102418`), deps installate (`three@0.184.0` pin,
`@react-three/fiber@9.6.1`, `@pixiv/three-vrm@3.5.3`, `@types/three` dev),
**scena 3D montata** in `AvatarStage.tsx`: gate WebGL2 → chunk lazy →
cross-fade dal 2D al ready; loader manuale (no useLoader), `<Canvas flat
frameloop="demand" dpr={[1,1.5]}>`, cap 30fps via invalidate + stop totale in
background, rig procedurale (breathing/sway/blink/aa/relaxed/lookAt con
micro-saccadi, damp tra stati), `VRMUtils
removeUnnecessaryVertices/combineSkeletons/rotateVRM0/deepDispose`,
ErrorBoundary + webglcontextlost + load-fail → 2D permanente.

Verifica: `scripts/e2e/probe-body-double.ts` **PASS 18/18** (sessione, check-in
reali, AiUsage upsert con modelMix haiku, extend, exited). **Costo reale:
~$0,0005/check-in** (683 tok in / 77 out per 2 call — metà della stima spec).
Browser: flusso completo verificato col fallback 2D; la **resa visiva 3D**
non è verificabile nel preview headless (tab nascosto: ResizeObserver/texture
decode congelati → R3F non si inizializza, il 2D resta correttamente in scena)
→ eyeball test demandato ad Antonio su browser visibile.

## UX `BodyDoubleView` (gated `body_double`)

- Ingresso: dal task della lista ("fallo con Shadow") o da FocusView.
- Scena: avatar 3D **three.js + VRM** nel webview con stati `presente / parla /
  pausa` (idle animation continua → percezione di presenza senza costi AI).
- HUD: timer sessione, task corrente + micro-step attivo (riusa la
  decomposizione esistente), pulsante pausa, exit con la **friction esistente**
  (StrictModeExitDialog, 4 step). NOTA: oggi è una function privata dentro
  `tasks/page.tsx:~835`, accoppiata a useShadowStore e a `STRICT_EXIT_STEPS` —
  il riuso richiede l'estrazione in un modulo condiviso
  (es. `src/features/strict-mode/`), non un import diretto.
- Avvio sessione: crea `StrictModeSession` con `triggerType: 'body_double'` e
  attiva lo shield nativo via `focus-shield.ts` (W5/W6). Fine/scadenza → stop
  shield + sync `distractionsBlocked`.

## Check-in AI

- `POST /api/body-double/checkin` (`withCapability('body_double')`,
  taskClass `body_double_checkin` → Haiku, risposte ≤2 frasi, tono da companion).
- Cadenza ~10 min + trigger evento (micro-step completato, rientro da blocco).
- Input: task, micro-step corrente, minuti trascorsi, esito ultimo check-in.
- Costo: ~$0,001/check-in → ~$0,01 per sessione di 2h (trascurabile, dentro il
  cap giornaliero MAX).

## Asset e performance

- Dipendenze nuove (⚠️ edit package.json → conferma esplicita; giustificate:
  unico modo di fare 3D nel webview): `three`, `@react-three/fiber`,
  `@pixiv/three-vrm`. Lazy load (next/dynamic)
  SOLO in questa vista: zero impatto sul bundle del resto dell'app.
- Modello VRM servito da CDN/`public` (non nel binario nativo); licenza del
  modello da verificare (CC0/redistribuibile) o commissionarne uno.
- Tier qualità per device deboli: cap 30fps, pixelRatio max 1.5, fallback 2D
  (immagine animata) se WebGL assente/contesto perso; pausa render quando l'app
  è in background (battery).

## Review profonda mensile (MAX, `deep_review`)

- `POST /api/review/deep`: Opus 4.8 + `thinking:{type:'adaptive'}`,
  `export const maxDuration = 300`. Input: aggregati ultimi 30gg (task,
  pattern, streak, strict sessions, pulse beta se presenti). Output: analisi
  strutturata + 3 raccomandazioni concrete, salvata e mostrata in una card
  dedicata. Trigger: manuale da Settings/Review + suggerimento mensile.
- Costo stimato: ~50-100k token in / 2-4k out ≈ $0,3-0,6 per review → 1/mese
  per utente MAX: sostenibile. Batch API (−50%) solo se il volume lo
  giustificherà (decisione rinviata).

## Acceptance

1. Sessione body doubling end-to-end su Android reale: avatar visibile, timer,
   check-in che arrivano, app vietata → overlay/shield, exit con friction,
   `StrictModeSession` chiusa con `actualDurationMinutes` e `distractionsBlocked`.
2. Su web: identica ma senza blocco nativo (no-op silenzioso).
3. Device low-end (Android 2-3 anni): scena fluida o fallback 2D automatico.
4. Review profonda: output in lingua dell'utente, salvata, visibile, costo
   tracciato in `AiUsage` con taskClass `review_deep`.
5. Utente non-MAX → 402 + paywall con trigger `body_double`/`deep_review`.
