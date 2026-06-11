# Task 27 — Body doubling voice-first (piano MAX)

> Approvato il 2026-06-11 (ultraplan). Sostituisce la scheda ROADMAP Task 11.
> Avatar 2D animato che parla (TTS) e ascolta (STT da microfono), agganciato a un task
> e ai suoi micro-step. Gating piano MAX (Task 25). Branch: `feature/27-voice`.
> Stima: 16-22 sessioni in 3 fasi (spike → MVP → polish).

## Decisioni architetturali (chiuse)

| Tema | Decisione |
|---|---|
| Dialogo | Orchestrator esistente, mode **`focus_companion`** (slot già nello schema, oggi inutilizzato), tier **`fast`** (haiku) — richiede override: oggi il blocco «Determine model tier» di `orchestrator.ts` manda ogni mode ≠ general su `smart` |
| Architettura v1 | **Turn-based**: registra utterance → STT → turno chat → TTS → playback. Latenza target 2-4s/turno. Realtime streaming = v2 (Vercel serverless non tiene WebSocket) |
| STT | Proxy server batch per-utterance: `/api/voice/transcribe` → Deepgram REST (`language=it`). Niente token effimeri client→vendor in v1 (chiave mai sul client; entitlement+cap nello stesso hop) |
| TTS | Proxy server `/api/voice/speak` → Deepgram Aura-2 (voce italiana, id scelto nello spike). ElevenLabs (`eleven_flash_v2_5`) swappabile via env. Fallback client `speechSynthesis` |
| Avatar | 2D SVG + framer-motion (già in deps). Stati: `idle/listening/thinking/speaking/celebrating`. Bocca = ampiezza RMS dall'`AnalyserNode` sull'audio TTS. Interfaccia `AvatarRenderer {state, mouthAmplitude}` → il 3D si innesta dopo |
| Schema DB | **ZERO migration**: `ChatThread(mode='focus_companion', relatedTaskId, relatedSessionId)` + `StrictModeSession(triggerType='voice_body_double')` + `LearningSignal` (signalType liberi) + telemetria in `contextJson.voice` (scritto solo dalle route voice — niente race con l'orchestrator) |
| UI | Route dedicata **`/focus`** full-screen (deep-link `/focus?taskId=…`), NON overlay nel monolite. Dal monolite solo il bottone "Fallo con Shadow" nel TaskDetailView (~riga 2706). **Aggiungere `/focus/:path*` al matcher del middleware** (oggi non sarebbe protetta) |
| Decomposizione in sessione | Tool `generate_micro_steps` che riusa `fallbackDecomposition()` deterministico (gratis, one-shot) |
| Check-in da silenzio | Timer client → turno sintetico `__silence_checkin__` (precedente: `__auto_start__` del morning check-in) |
| Rate limiting | Bound per-request + cap giornalieri via `count()` Prisma su indici esistenti. Kill-switch: `VOICE_DAILY_TURN_CAP=0` |

Prerequisito: fix bug history orchestrator (oldest-20) — chiuso nel Task 24.

## Fase 0 — Spike de-risk (2-3 sess.) → GO/NO-GO

File temporanei (`src/app/focus/spike/page.tsx`, `src/app/api/voice/spike/route.ts`,
gated `NODE_ENV !== 'production'`). Matrice su **Chrome Android / PWA installata /
build TWA closed-testing / iOS Safari**:

1. Permesso mic: il prompt compare? In TWA lo gestisce Chrome per l'origin (bubblewrap
   NON ha delegation per il mic). Persiste tra sessioni?
2. mimeType MediaRecorder (`audio/webm;codecs=opus` Android, `audio/mp4` iOS).
3. Latenze reali: STT 8s audio <1s; TTS 200 char <1s; turno haiku 1-2.5s ⇒ budget 2-4s.
4. Autoplay: playback su risposta fetch SENZA nuovo gesto, con `AudioContext`
   creato/resumed nel gesto di avvio.
5. Wake Lock disponibile per piattaforma.
6. Voce italiana Aura-2: esiste? qualità vs ElevenLabs sullo stesso testo (giudizio Antonio).

Output: `docs/tasks/27-voice-spike-results.md` con matrice, p50/p95 latenza/turno,
costo/turno, decisione GO/NO-GO su TWA mic.

## Fase 1 — MVP end-to-end (9-12 sess., 6 step ognuno chiuso da build verde)

### 1.1 Libreria provider (2 sess.) — `src/lib/voice/`
- `provider.ts`: `SttProvider {transcribe(audio, {mimeType, language}): Promise<{transcript, confidence, durationSec}>}`,
  `TtsProvider {synthesize(text, {voiceId}): Promise<{audio: ReadableStream, mimeType, chars}>}`,
  factory `getSttProvider()/getTtsProvider()` su env.
- `deepgram.ts` (REST fetch: `POST /v1/listen?model=…&language=it&smart_format=true`,
  `POST /v1/speak?model=…`), `elevenlabs.ts` (TTS flash), `limits.ts` (cap giornalieri),
  `telemetry.ts` (`VOICE_PRICING` + log stile `[cache]`). Timeout 8s STT / 6s TTS,
  1 retry con backoff solo su 5xx/network. Unit test con fetch mockato.
- `browser-tts.ts` (client): wrapper `speechSynthesis` it-IT come fallback quando
  `/speak` fallisce (avatar in stato speaking generico, senza lip-sync).

### 1.2 API routes (2 sess.) — tutte `requireSession` + `requirePlan('MAX')`
- `POST /api/voice/session` `{taskId, durationMinutes?}` → verifica ownership, riusa o
  crea `StrictModeSession (active_soft, triggerType='voice_body_double')`, chiude
  eventuali sessioni voce attive precedenti, crea `ChatThread(focus_companion,
  relatedTaskId, relatedSessionId)`, lancia `orchestrate(…, '__session_start__')` →
  `{threadId, strictSessionId, assistantMessage, task{microSteps, currentStepIdx}, endsAt, limits}`.
  429 su `VOICE_DAILY_SESSION_CAP`.
- `PATCH /api/voice/session` `{threadId, action:'end'|'extend', minutes?}` → chiusura
  (thread `completed`, sessione `exited` + `actualDurationMinutes`) o estensione.
- `POST /api/voice/transcribe` (multipart audio + threadId) → STT. **Gate dei costi**:
  413 su audio >60s/>2MB; 429 su `VOICE_DAILY_TURN_CAP` (count ChatMessage user di oggi
  sui thread focus); 502/504 su vendor down/timeout.
- `POST /api/voice/speak` `{text, threadId}` (tronca a 500 char) → stream `audio/mpeg`,
  header `X-Voice-Chars`/`X-Voice-Provider`; su errore il client degrada a speechSynthesis.
- `POST /api/voice/event` `{threadId, type:'barge_in'|'checkin_shown'|'tts_fallback'|'mic_denied'}` →
  LearningSignal + contatori `contextJson.voice`.
- Env nuove: `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY?`, `VOICE_STT_PROVIDER=deepgram`,
  `VOICE_TTS_PROVIDER=deepgram`, `VOICE_TTS_VOICE_ID?`, `VOICE_DAILY_TURN_CAP=200`,
  `VOICE_DAILY_SESSION_CAP=10`.

### 1.3 Prompt + tool + orchestrator (2.5 sess.)
- `FOCUS_COMPANION_PROMPT` in `prompts.ts` (`getModePrompt` riga ~1497, oggi `''`).
  **Static** (cacheable): battute ≤30 parole, UNA frase quando possibile, mai
  liste/markdown/emoji/`[[QR:]]`; marker sintetici (mai citarli):
  `__session_start__` → saluto ≤15 parole + primo micro-step non fatto (se
  `MICRO_STEPS=(none)` → `generate_micro_steps`); `__silence_checkin__ minutes=N` →
  UNA frase di presenza non giudicante (con `CHECKINS_UNANSWERED>=2` → risposta `…`,
  che il client non manda a TTS); `__timer_end__` → proponi chiusura o estensione.
  "Sono bloccato" → gesto fisico ≤2 min, UNA proposta. Distrazione → `create_task` +
  parcheggio ("Segnato. Torniamo a [step]."). Chiusura sobria (vietato "bravo!":
  nominare il fatto concreto). "Basta/stop" → `end_voice_session` immediato.
  Il tono eredita `preferredPromptStyle` (direct/gentle/challenge) dal voice profile.
- **Dynamic** (`modeContext`, da `src/lib/chat/focus-companion/context.ts`, puro+testato):
  blocco `FOCUS_SESSION` con task, micro-step `[fatto]/[corrente]/[da fare]`,
  `ELAPSED/PLANNED/REMAINING_MIN`, `TURNS`, `CHECKINS_UNANSWERED`, `SESSION_PHASE`.
- Tool in `src/lib/chat/tools/focus/` (tutti `sideEffect`): `mark_step_done {stepIdx}`,
  `generate_micro_steps {}` (rifiuta se step esistenti non tutti fatti),
  `extend_session {minutes 5-30}` (il client legge il nuovo endsAt da `toolsExecuted`),
  `end_voice_session {outcome:'task_done'|'partial'|'stopped'}` (idempotente).
  `FOCUS_COMPANION_TOOLS = [create_task] + i 4 nuovi` — set minimale (lezione Bug #A).
- Orchestrator: branch `focus_companion` (carica Task + StrictModeSession via
  relatedTaskId/relatedSessionId, build modeContext, **tier forzato `fast`**).
  Gate MAX in `/api/chat/turn` quando `mode==='focus_companion'`.

### 1.4 UI avatar + hook audio (2.5 sess.) — `src/features/focus/`
`VoiceSessionView` (avatar centrale, countdown, card step corrente, pulsante mic
push-to-talk, scorciatoie touch "Fatto"/"Chiudi", banner errori, label italiane);
`avatar/AvatarRenderer.ts` (contratto) + `avatar/Avatar2D.tsx` (SVG+framer-motion:
blink su idle, motion su thinking, bocca segue `mouthAmplitude`);
`hooks/useTtsPlayback.ts` (fetch → `decodeAudioData` → `AnalyserNode` → RMS→bocca via
rAF con smoothing EMA; AudioContext creato nel gesto di avvio; `stop()` per barge-in;
fallback browser-tts); `hooks/useMicRecorder.ts` (`getUserMedia({audio:{echoCancellation,
noiseSuppression}})` una volta per sessione, MediaRecorder con mimeType negoziato);
`src/store/voice-store.ts` (store Zustand NUOVO: sessionPhase, micState, avatarState,
threadId/taskId/strictSessionId, endsAtEpoch, transcript, captionsOn, micPermission,
turns, bargeIns, lastError).

### 1.5 Loop di sessione (1.5 sess.)
`hooks/useVoiceSession.ts`: FSM avvio → loop (record → transcribe → turn → parse
toolsExecuted → speak) → timer silenzio 4 min (max 2 check-in senza risposta, poi
silenzio) → timer `endsAt` (ricalcolato da epoch, non da setInterval) → chiusura.
`TranscriptOverlay.tsx`: sottotitoli ultimi 2-3 scambi (accessibilità), toggle
persistito, nasconde i messaggi `__*`. **Fallback testuale completo se mic negato.**

### 1.6 Punto di lancio + QA (1 sess.)
Bottone "Fallo con Shadow" nel TaskDetailView (visibile solo piano MAX) →
`/focus?taskId=…`. QA manuale desktop + Chrome Android.

### Acceptance Fase 1
1. Tap → entro 5s l'avatar saluta a voce e nomina il primo micro-step non fatto.
2. "fatto" / "sono bloccato" / "mi è venuto in mente X" → marca step / riformula più
   piccolo / crea task in inbox, risposta vocale ≤4s p50.
3. Task senza micro-step → l'avatar li propone (engine deterministico) e guida al primo.
4. 4 min di silenzio → check-in non giudicante; dopo 2 senza risposta, silenzio.
5. "Basta per oggi" → chiusura: thread `completed`, sessione `exited` con durata reale,
   LearningSignal scritti.
6. Mic negato → sessione in modalità testo+TTS (o solo testo).
7. FREE/PRO → 403 con upsell; cap giornaliero → 429 con copy dedicato.
8. `bun run build` + `bun run test` verdi; zero `any`.

## Fase 2 — Polish (5-7 sess.)

| Item | Contenuto | Stima |
|---|---|---|
| Barge-in | stop playback + registra + `/api/voice/event {barge_in}`; prompt: non ripetere la frase troncata | 1.5 |
| VAD a soglia | AnalyserNode RMS in `useMicRecorder`, auto-stop dopo 1.2s di silenzio (opt-in UI) | 1 |
| Wake Lock + recovery | `wakeLock.request('screen')` + riacquisizione su visibilitychange; al mount di `/focus` riaggancio della sessione attiva (riapertura dopo kill) | 1 |
| Celebrazioni + ack istantanei | stato `celebrating` sobrio + ack audio pre-generati statici (`public/voice/ack-*.mp3`) riprodotti subito mentre arriva la risposta → latenza percepita ~0 | 1 |
| TWA hardening | addendum runbook Task 22: test mic post-step 8, troubleshooting permesso Chrome, Play **Data Safety form** (audio inviato a processor STT, non conservato); `RECORD_AUDIO` nel twa-manifest SOLO se lo spike lo dimostra necessario | 1.5 |

## Costi e telemetria

Per turno: STT ~$0.0006 (8s) + haiku con cache ~$0.002-0.004 + TTS ~$0.005 (180 char)
≈ **$0.008-0.010/turno** → sessione 25 min (12-18 turni) ≈ **$0.10-0.18** (~0,5 cent/min).
Worst case con cap 200 turni/giorno: ~$2/utente/giorno. Utente MAX molto attivo
(30 sessioni/mese): ~$3-6/mese — il prezzo del piano MAX deve coprirlo con margine.
Telemetria: log per richiesta + accumulo in `contextJson.voice`
(`sttSeconds, ttsChars, estVoiceCostUsd, checkinsSent, bargeIns`); riepilogo nel
LearningSignal `voice_session_ended` → consumabile dal learning engine.

## Rischi e piani B

| # | Rischio | Mitigazione | Piano B |
|---|---|---|---|
| 1 | Latenza >4s/turno | misure in spike; ack statici; prompt corto+fast+cache | route fusa transcribe+turn (-1 RTT); v2 streaming |
| 2 | Mic non funziona in TWA | spike su build reale PRIMA della feature | RECORD_AUDIO nel manifest; in extremis voce solo su PWA |
| 3 | Vendor down/429 | timeout+retry; provider swap via env | TTS→speechSynthesis; STT→input testo (la sessione continua sempre) |
| 4 | Haiku tool sbagliati / risposte lunghe | tool set minimale; troncamento 500 char in /speak | toolChoice forzato sui marker critici (pattern V1.3) |
| 5 | Thread orfani (kill app) | POST session chiude le sessioni voce attive precedenti; recovery fase 2 | normalize: auto-archive focus_companion con lastTurnAt >2h |
| 6 | Costi | bound per-request + cap giornalieri deterministici | kill-switch `VOICE_DAILY_TURN_CAP=0` senza deploy |
| 7 | iOS Safari | mimeType mp4 negoziato; "best effort" in beta | fallback testo+TTS sempre disponibile |
