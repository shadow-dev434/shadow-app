# Task 42 — Gestione task dalla chat, guida dell'app, affidabilità del turno

> Spec scritta il 2026-06-12 su brief di Antonio (primo test beta reale della
> chat, transcript morning check-in + screenshot inbox). Decisioni di prodotto
> D1/D2 raccolte via AskUserQuestion nella stessa sessione. Workflow v2:
> approvazione del piano = unico checkpoint, poi implementazione end-to-end.

---

## 1. Contesto e sintomi (test beta 2026-06-12)

Antonio ha condotto una conversazione "tipo" di morning check-in (35 fatture →
ridotte a 5 + spesa, body doubling improvvisato). Esito qualitativo ottimo, ma:

1. **La chat non può completare/modificare/rimuovere task.** A fine giornata
   l'utente chiede "togli i task fatti dall'inbox" e Shadow risponde
   (correttamente) di non avere lo strumento. UX rotta: il loop
   crea-task-via-chat → esegui → *pulisci a mano dall'app* vanifica il punto
   d'ingresso conversazionale.
2. **Task duplicati**: "Fare la spesa" ×2 nell'inbox (screenshot). Nessun
   guard di idempotenza su `create_task`.
3. **"(nessuna risposta)"** un paio di volte: bolla assistant vuota.
4. **Errore 404** sul tentativo successivo, poi al terzo tentativo tutto ok.
5. (Bonus, dal transcript) Shadow promette "torno tra 25 minuti": promessa
   che non può mantenere — la chat non può iniziare messaggi spontanei.

## 2. Diagnosi (verificata nel codice)

| Sintomo | Causa | Dove |
|---|---|---|
| Niente completamento | Fuori da evening_review i tool sono solo `create_task`, `get_today_tasks`, `set_user_energy` | `src/lib/chat/tools.ts:76-122`, `getToolsForMode` riga 263 |
| Duplicati | `create_task` è flavor `sideEffect`: scrive nel DB subito, mentre i messaggi del turno si committano solo nella `$transaction` finale. Turno morto a metà (timeout/rete/errore LLM) = task creato ma turno mai persistito → al reinvio il modello ricrea. In più replay del modello cross-turno (fenomeno già documentato in `prompts.ts:431`). Nessun dedup server-side. | `tools.ts:489` vs `orchestrator.ts:874` |
| "(nessuna risposta)" | Stringa fallback client quando `assistantMessage` è vuoto: il modello può chiudere il turno con soli tool_use (la "REGOLA CRITICA" in MORNING_CHECKIN_PROMPT esiste proprio per questo). Nessun fallback server-side. | `ChatView.tsx:248`, `orchestrator.ts:802-913` |
| 404 | La route emette solo 400/401/500; il SW non intercetta i POST (`method !== 'GET'` → return). Ipotesi più solida: **deployment skew Vercel** — il deploy prod di Task 23/40/41 è partito il 2026-06-12, il test era la sera stessa con TWA aperta su client vecchio. Da confermare nei log Vercel in implementazione. | `turn/route.ts`, `public/sw.js:64` |

## 3. Decisioni di prodotto

- **D1 — Poteri della chat sui task** (scelta Antonio): completa + aggiorna +
  archivia. Archiviazione = soft (status `archived`, stesso esito del
  `cancelled` della review serale, reversibile); la chat deve chiedere
  **conferma esplicita nel turno corrente** prima di archiviare. Nessun hard
  delete via chat.
- **D2 — Guida dell'app** (scelta Antonio): sezione statica nel prompt
  (cacheable) **+** suggested prompt "Come funziona Shadow?" nella schermata
  vuota della chat.

## 4. Design

### A. Nuovi tool (in `src/lib/chat/tools.ts`, file non protetto)

Nuovo array `TASK_MANAGEMENT_TOOLS`, esposto **solo fuori da
`evening_review`** (`getToolsForMode`, ramo `mode !== 'evening_review'` →
`[...CHAT_TOOLS, ...TASK_MANAGEMENT_TOOLS]`). Dentro la review restano gli
strumenti di triage dedicati (`mark_entry_discussed` outcome `cancelled` ecc.):
esporre lì anche questi creerebbe doppio canale di mutazione in conflitto con
il triage state. Tutti flavor `sideEffect`, ownership check
`findFirst({ id, userId })` come gli executor esistenti.

- **`complete_task { taskId }`** → `status='completed'`, `completedAt=now()`.
  Idempotente: già `completed` → success con `alreadyCompleted: true`.
  Su task `archived`/`abandoned` → `success: false` con errore esplicativo.
- **`update_task { taskId, title?, description?, urgency?, importance?, category?, deadline? }`**
  → aggiorna solo i campi passati (almeno uno richiesto); clamp 1-5 su
  urgency/importance; category nello stesso enum di `create_task`; `deadline`
  ISO `YYYY-MM-DD` oppure `""` per rimuoverla. Rifiuta su task terminale.
  Ritorna `{ id, title, changed: [...] }` per la card UI.
- **`archive_task { taskId }`** → `status='archived'`. Description del tool:
  "NON è il completamento. Chiamalo SOLO dopo conferma esplicita dell'utente
  in questo turno (es. per duplicati o task non più rilevanti)."

**Idempotenza `create_task`** (raffinato in implementazione): prima del
create, `findFirst` su `{ userId, title equals (case-insensitive, trimmed),
status notIn terminali }` — **senza finestra temporale**: un omonimo ancora
aperto È il duplicato da segnalare, un omonimo completato/archiviato non
blocca la ri-creazione legittima. Escape hatch `allowDuplicate?: boolean`
nello schema per il doppione voluto (il modello lo setta solo su conferma
esplicita dell'utente). Se esiste → `success: true` con `{ alreadyExists:
true, id, title, status }`; il modello informa l'utente invece di duplicare.
Copre sia il replay del modello sia il reinvio dopo turno fallito, e rende
sicuro il "Riprova" client (punto C).

Ritocco alla description di `get_today_tasks`: menziona che fornisce gli id
necessari a complete/update/archive.

### B. Guida dell'app nel prompt (`src/lib/chat/prompts.ts`, **PROTETTO**)

Nuova const `APP_KNOWLEDGE` (~700 token, master italiano per regola W4)
concatenata nel `staticPrefix` di `buildSystemPromptParts` → entra nel blocco
cacheato, costo marginale ≈ zero. Contenuto:

1. Mappa dell'app: inbox (cattura ovunque + "Classifica"), Today/piano,
   Focus (body doubling, strict mode), Review serale (triage + piano di
   domani), morning check-in.
2. Cosa la chat sa fare coi tool: creare, completare, aggiornare, archiviare
   (con conferma), elencare task; registrare energia.
3. Cosa NON sa fare, con redirect onesto: non può scrivere spontaneamente né
   "tornare tra X minuti" (→ per body doubling indirizza a Focus); non
   modifica il piano del giorno fuori dalla review serale; non legge
   email/calendario (arriverà con PRO).
4. Direttive d'uso dei tool nuovi: conferma esplicita prima di `archive_task`;
   se `create_task` risponde `alreadyExists` dillo all'utente, non insistere.

### C. Affidabilità del turno

- **`src/lib/chat/orchestrator.ts`** (**PROTETTO**): dopo lo strip dei QR
  (riga ~802), se `finalAssistantMessage === ''` → fallback deterministico
  (con tool eseguiti: "Fatto. Dimmi tu come proseguiamo."; senza: "Mi sono
  perso un attimo — puoi ripetere?") + `console.warn` con threadId/iterazioni
  per telemetria. Nessuna seconda chiamata LLM (costo/latenza).
- **`ChatView.tsx`**: error box con azioni — `404` → "Probabile aggiornamento
  dell'app in corso" + bottone **Ricarica** (`location.reload()`); altri
  errori → bottone **Riprova** che reinvia l'ultimo messaggio utente (sicuro
  grazie all'idempotenza di A). Lo status HTTP viene propagato nel messaggio
  d'errore.
- **Log Vercel**: in implementazione, best effort `vercel logs` (comando in
  `ask`) per confermare/smentire l'ipotesi skew sul 404. Non bloccante.

### D. UI

- `ToolExecutionCard` in `ChatView.tsx`: card per `complete_task`
  ("Task completato"), `update_task` ("Task aggiornato" + campi cambiati),
  `archive_task` ("Task archiviato").
- `SUGGESTED_PROMPTS`: + "Come funziona Shadow?" → prompt "Spiegami come
  funziona Shadow e cosa puoi fare per me."
- `public/sw.js`: bump cache `v4` → `v5` (regola: ogni release con JS nuovo,
  cfr. commit f1ada25).

## 5. Fuori scope (esplicito)

- Pianificazione del giorno via chat (i task creati restano in `inbox`; il
  piano resta alla review serale / engine). Eventuale evoluzione post-beta.
- Telemetria client→BugOps automatica degli errori di rete.
- Skew protection Vercel (decisione infra separata, da valutare con Antonio).
- Voce/STT, timer reali per body doubling (→ W7/v1.1).

## 6. QA e verifica

1. `bun run build` + `bunx tsc --noEmit` + `bun run test`.
2. Unit vitest sui nuovi executor (mock db secondo pattern test esistenti):
   complete/update/archive + dedup create (esiste/non esiste/terminale).
3. Probe e2e `scripts/e2e/42-chat-task-tools.ts` (mint cookie): crea task via
   API, turno chat "l'ho fatto" → verifica `status='completed'` sul DB;
   tolleranza al nondeterminismo LLM (retry/skip espliciti nel probe).
4. Verifica browser su preview (mint cookie + DOM probe, niente screenshot
   per il problema rAF): card nuove, suggested prompt, error box.
5. Smoke della guida: domanda "come funziona l'inbox?" in chat → risposta
   coerente con APP_KNOWLEDGE.

## 7. File toccati

| File | Protetto | Modifica |
|---|---|---|
| `src/lib/chat/tools.ts` | no | 3 tool nuovi + executors + dedup create + gating |
| `src/lib/chat/prompts.ts` | **sì** | `APP_KNOWLEDGE` nel staticPrefix + direttive tool |
| `src/lib/chat/orchestrator.ts` | **sì** | fallback risposta vuota + warn telemetria |
| `src/features/chat/ChatView.tsx` | no | card tool, suggested prompt, error UX retry/reload |
| `public/sw.js` | no | bump cache v5 |
| `scripts/e2e/42-chat-task-tools.ts` | no | probe nuovo |
| `src/lib/chat/tools.test.ts` (o file per-tool) | no | unit nuovi executor |
| `docs/ROADMAP.md` | no | riga Task 42 |

Branch: `feature/42-chat-task-tools`. Commit atomici per blocco (A/B/C/D).

## 8. Rischi e note

- **Cache del prompt**: `APP_KNOWLEDGE` e i tool nuovi invalidano la cache
  statica una tantum al deploy (primo turno per utente non cacheato): atteso,
  costo una-tantum.
- **Review serale intoccata**: nessun cambiamento a triage/fasi; i tool nuovi
  non sono esposti in `evening_review` (verificato da unit test sul gating).
- **Modello che archivia senza conferma**: mitigato da description del tool +
  direttiva in APP_KNOWLEDGE + reversibilità (`archived` non è delete).
- **`update_task` su task in triage attivo**: possibile solo fuori dal thread
  di review (gating), il triage rilegge i task dal DB a ogni turno → un titolo
  aggiornato si riflette, nessuna corruzione di stato.
