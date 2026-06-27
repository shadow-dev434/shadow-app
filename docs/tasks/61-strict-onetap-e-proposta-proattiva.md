# Task 61 — Strict mode: blocco nel body doubling, attivazione one-tap, proposta proattiva di Shadow

> **Handoff per una sessione Claude Code NUOVA.** Spec autosufficiente: contiene
> contesto, decisioni di prodotto **già prese** (non ri-chiederle), mappa del
> codice con file:line, piano per fasi, file protetti **pre-autorizzati**, e la
> self-verification. NON serve ri-esplorare: la mappatura è già stata fatta
> (workflow multi-agente, 2026-06-27). Numeri di riga **approssimativi** —
> localizza per simbolo/nome funzione (alcune righe in `tasks/page.tsx` si sono
> spostate). Creato 2026-06-27.

---

## 0. Cos'è e perché

Richiesta di Antonio (test on-device dell'APK nativo riuscito, il blocco app
funziona). Tre cose:

1. **Lo scudo deve bloccare le app anche durante il body doubling.** Oggi il body
   doubling avvia già lo strict mode ma con lista app **vuota** → non blocca niente.
2. **Attivare lo strict mode è macchinoso** ("un casino"): oggi sono 3 tap dentro
   un menu modalità. Va reso **one-tap**.
3. **Shadow deve PROPORRE proattivamente** in chat, es. nel check-in del mattino:
   *"Vuoi iniziare con le attività di oggi? Vuoi attivare la modalità strict per
   lavorare un paio d'ore?"* — e su consenso far **partire lo strict**.

**Principio di design guida (Antonio):** *meno tasti e meno menù possibili, per
non affaticare l'utente* (popolazione ADHD). Ogni scelta UI va nella direzione
di ridurre i tap, non aggiungerne.

---

## 1. Decisioni di prodotto — BLOCCATE (non ri-chiedere ad Antonio)

| # | Decisione |
|---|---|
| **D1** | Nel body doubling lo scudo blocca le app prese da **`profile.blockedApps`** (la lista scelta in Impostazioni → "App da bloccare"). |
| **D2** | "Attivare lo strict" = **strict puro**: timer + blocco app + uscita difficile (4-step), **SENZA avatar/body doubling**. |
| **D3** | Shadow **propone in chat** (quick reply nel morning check-in, dopo il commit del piano). **Editare i file core-chat protetti è pre-autorizzato** da Antonio per gli edit specifici descritti in Fase 3 (NON carta bianca: solo quelli). |
| **D4** | Attivazione **one-tap** dello strict, nel rispetto del principio "meno tasti/menù". |

**Sub-decisioni con default raccomandati** (procedi così salvo diverso parere):

- **Durata** della sessione strict proposta: default = `task.sessionDuration ?? 50`
  minuti. **NON** aggiungere un secondo tap per scegliere la durata (principio
  "meno tap"): usa il default. La copy dice "un paio d'ore" → se Antonio vuole,
  alza il default (es. 90). Tunable, non bloccante.
- **Quando** proporre: **solo** in `morning_checkin`, **dopo** `commit_today_plan`.
  Niente proposta mid-day (no spam). Su "Dopo"/rifiuto: continua la conversazione,
  niente insistenza.
- **Quale task**: il **primo task di "oggi"** nel piano (top of today).
- **triggerType** lato API: `'chat_proactive'` (la route non valida il campo →
  stringa libera ok; serve solo per analytics).

---

## 2. Stato del codice OGGI (mappa verificata 2026-06-27)

### 2a. Body doubling ↔ strict (per la Fase 1)
- `src/features/body-double/useBodyDoubleSession.ts`
  - **riga ~291**: la `start()` fa `POST /api/strict-mode` con `mode: 'strict'`,
    `triggerType: 'body_double'`, `taskId`, `durationMinutes`, **`blockedApps: []`** ← bug.
  - **riga ~310**: `await startShield({ sessionId, blockedApps: [] })` ← stessa lista vuota.
  - import a riga 10: `import { startShield, stopShield } from '@/lib/focus-shield';`
    (la facade; su Android delega a `src/lib/native/focus-shield.ts:startNativeShield`,
    che con lista vuota ritorna `{started:false, reason:'no-apps'}` — il fix B8 di Task 60).
  - **recovery** (riga ~198-240): al reload ripristina la sessione dal server, che
    contiene già `blockedApps:[]` → non serve toccarlo se il fix è all'avvio.
- `GET /api/profile` (`src/app/api/profile/route.ts`) ritorna `profile.blockedApps`
  come `string[]` (già parsato). **Il body-double hook NON lo legge.**
- ⚠️ **Vincolo**: `/focus?taskId=…` è un **deep-link** (route `src/app/focus/`).
  Lo store Zustand è **senza persist** → a freddo `store.userProfile` può essere
  **null**. Quindi per avere `blockedApps` in modo affidabile, il hook deve
  **fare fetch `/api/profile`** (con `apiFetch`) prima di `start()`, non fidarsi
  dello store.

### 2b. Attivazione strict manuale (per la Fase 2)
- `src/app/tasks/page.tsx`
  - `startStrictModeSession(mode, taskId, durationMinutes, blockedApps)` **riga ~251**:
    fa `POST /api/strict-mode` (`triggerType:'manual'`) e poi `startNativeShield(...)`.
  - `handleStartFocus(taskId, mode)` **riga ~2232**: entry dalla Today, setta
    `selectedTaskId`/`executionMode` e `currentView='focus'`.
  - `handleStartSession()` **riga ~2571**: legge `selectedFocusMode` e chiama
    `startStrictModeSession(...)` passando già `store.userProfile?.blockedApps ?? []`.
  - **ModeSelector** inline (~riga 2740): card con 3 bottoni (Soft / Strict / Body
    doubling) — è il "menu" da bypassare. Mostrato solo dopo "Inizia sessione".
  - Today task card "Inizia" ~riga 2407.
  - `startNativeShield` in `src/lib/native/focus-shield.ts:36` (firma:
    `{sessionId, blockedAppPackages?, endsAt}` → `{started, reason?}`).
- **Flusso attuale = 3 tap**: Inizia → Inizia sessione → (menu) Strict.

### 2c. Proposta proattiva in chat (per la Fase 3) — meccanismo da RISPECCHIARE
Il pattern esiste già con `offer_body_double`. Da imitare 1:1 per `offer_strict_mode`:
- **`src/lib/chat/tools.ts`** (PROTETTO)
  - `offer_body_double` tool def **riga ~291** (mirror per `offer_strict_mode`).
  - `commit_today_plan` tool **riga ~322** (è il punto post cui proporre).
  - `getToolsForMode(...)` **riga ~527**: decide quali tool esporre per modalità.
  - `executeTool` switch: `case 'commit_today_plan'` ~726, `case 'offer_body_double'` ~732.
  - executor `offer_body_double` (~riga 971) garantisce un `taskId` → da imitare.
- **`src/lib/chat/orchestrator.ts`** (PROTETTO)
  - `QuickReply` union **riga 112**: `{label,value} | {label, action:'body_double', taskId}`.
  - Cattura del risultato `offer_body_double` nel loop **riga ~816**.
  - Push della QR con `action:'body_double'` **riga ~977-980**.
  - Parsing `[[QR: a | b]]` dal testo LLM ~riga 939-953.
- **`src/lib/chat/prompts.ts`** (PROTETTO): prompt `morning_checkin` + "REGOLA
  CRITICA SUL COMMIT" — punto dove aggiungere l'istruzione a proporre lo strict.
- **`src/features/chat/ChatView.tsx`** (NON protetto)
  - `QuickReply` type **riga 23** (mirror del ramo `action`).
  - Click handler QR **riga ~669-684**: se `'action' in reply` → `router.push('/focus?taskId=…')`
    (riga ~676-677). Qui va aggiunto il ramo `action==='start_strict'`.

### 2d. Vincolo tecnico chiave
**Lo scudo nativo parte LATO CLIENT** (`startNativeShield` gira nella WebView via
Capacitor). Un tool LLM eseguito **lato server** (orchestrator) può creare la
*sessione* in DB ma **non** avviare lo scudo. Perciò la proposta di Shadow, su
"Sì", deve scatenare un'**azione client** (come fa il deep-link del body doubling),
non solo un side-effect server. → vedi `enterStrictMode` condiviso (Fase 3).

---

## 3. Prerequisiti & convenzioni

- **Branch**: lavora **direttamente su `feature/61-strict-onetap-proposta`** —
  GIÀ creato il 2026-06-27, basato su `main` (che ora contiene **tutto Task 60**:
  A/B/C/D + §5, mergiato e pushato da Antonio). Questo doc è già committato qui.
  `git checkout feature/61-strict-onetap-proposta` e prosegui. Se il branch non
  esiste più, ricrealo da `main`.
- Usa **`apiFetch`** (`src/lib/api/fetch.ts`, da Task 60 B) per le nuove fetch client
  (gestisce 401→re-login). Per i call-site con fallback silenzioso usa `{skipErrorToast:true}`.
- **Gate verdi a OGNI fase**: `bun run build` + `bun x tsc --noEmit` + `bun run test`
  (su Windows `bunx` non è nel PATH del Bash tool → usa `bun x`). Per cambi visibili,
  verifica anche nel **browser** (preview tools). Commit **atomici** su feature branch.
  **NON pushare/mergiare** (lo decide Antonio).
- TypeScript strict, zero `any` impliciti. Non toccare `src/components/ui/`.
- I prompt LLM restano **master in italiano** (CLAUDE.md regola 7): la copy della
  proposta in italiano.

---

## 4. Piano per fasi (in quest'ordine)

### Fase 1 — Body doubling usa `profile.blockedApps` *(piccola, file non protetti)*
**Obiettivo (D1):** il body doubling blocca le app del profilo.

In `src/features/body-double/useBodyDoubleSession.ts`:
1. Prima di `start()`, ottieni `blockedApps` in modo affidabile: **fetch
   `/api/profile`** con `apiFetch` (lo store può essere vuoto su `/focus`). Cache
   il risultato nel hook (state) così non rifai la fetch a ogni render.
2. Passa quella lista **sia** nel body del `POST /api/strict-mode` (riga ~291,
   `blockedApps: <lista>`) **sia** in `startShield({ sessionId, blockedApps: <lista> })`
   (riga ~310).
3. (Opz.) se la fetch profilo fallisce, fallback `[]` (comportamento attuale).

**Verifica:** tsc+test+build verdi. On-device (Antonio): avviando un body doubling,
le app selezionate vengono bloccate; su web resta no-op (nessuna regressione).

---

### Fase 2 — Attivazione one-tap dello strict *(file non protetti)*
**Obiettivo (D4 + principio "meno tap/menù").**

1. **Estrai una helper client condivisa** `enterStrictMode({ taskId, durationMinutes? })`
   in un file NON protetto, es. `src/lib/strict-mode/enter.ts` (serve anche alla
   chat in Fase 3). Cosa fa:
   - ottiene `blockedApps` (da `store.userProfile?.blockedApps`, e se null fetch `/api/profile`);
   - chiama `startStrictModeSession('strict', taskId, durationMinutes ?? default, blockedApps)`
     (riusa la funzione esistente — eventualmente spostala qui da `tasks/page.tsx`,
     o esponila/importala);
   - setta lo store: `selectedTaskId`, `focusModeType='strict'`, `focusModeActive`,
     `strictModeState='active_strict'`, `strictSessionId`, `strictSession*`, `strictBlockedApps`,
     `strictExitAttempts=0` (vedi cosa fa oggi `handleStartSession` per lo strict);
   - **navigazione**: porta l'utente al focus view del task (da `tasks/page.tsx`:
     `setCurrentView('focus')`; dalla chat: `router.push('/tasks')` — lo store
     Zustand è un singleton condiviso tra `/` e `/tasks`, lo stato sopravvive alla
     client-nav). Per disaccoppiare, la helper può **non** navigare e lasciare la
     navigazione al chiamante.
   - usa `triggerType` opportuno (`'manual'` dal bottone, `'chat_proactive'` dalla chat) —
     aggiungi il parametro a `startStrictModeSession`.
2. **Today card → one-tap.** Nel rispetto di "meno tasti/menù":
   - Implementazione minima: rendi l'azione primaria "Inizia" un **ingresso diretto
     nello strict** (il default dell'utente), **bypassando il ModeSelector**. Il
     menu modalità (Soft / Body doubling) resta accessibile come scelta **secondaria**
     (es. icona/voce "…" o long-press), non come schermata obbligatoria.
   - Antonio ha scelto "pulsante one-tap": realizzalo come **una sola affordance**
     che entra in strict in 1 tap — NON due bottoni grandi affiancati. Tieni la card
     pulita.
3. (Opz.) sfrutta `userProfile.focusModeDefault` per ricordare la preferenza.

**Verifica:** browser (preview) — dalla Today, **1 tap** → strict attivo (banner
rosso), **0 menu**. tsc+test+build verdi.

---

### Fase 3 — Proposta proattiva in chat *(FILE PROTETTI — pre-autorizzati, D3)*
**Obiettivo:** in `morning_checkin`, dopo il commit del piano, Shadow propone
*"Vuoi attivare la modalità strict per lavorare un paio d'ore?"* `[[QR: Sì | Dopo]]`;
su "Sì" parte lo strict (D2: strict puro) sul top task di oggi.

Rispecchia **esattamente** `offer_body_double`. Edit minimi e mirati:

1. **`src/lib/chat/tools.ts`** (PROTETTO):
   - Nuovo tool **`offer_strict_mode`** (mirror di `offer_body_double` ~riga 291):
     description in italiano, input schema con `taskId` (opz., default top-today)
     e `durationMinutes` (opz.).
   - Esponilo in **`getToolsForMode`** (~riga 527) per `morning_checkin` (e
     `planning` se sensato) — **solo** lì.
   - `case 'offer_strict_mode'` in **`executeTool`** (~riga 732, accanto a
     `offer_body_double`): executor che garantisce un `taskId` (il primo "today"
     del piano) e ritorna `{ kind:'sideEffect', success:true, data:{ taskId,
     durationMinutes } }`.
2. **`src/lib/chat/orchestrator.ts`** (PROTETTO):
   - Estendi la `QuickReply` union (riga 112) con:
     `| { label: string; action: 'start_strict'; taskId: string; durationMinutes: number }`.
   - Cattura il risultato di `offer_strict_mode` nel loop (mirror riga ~816).
   - Push della QR con `action:'start_strict'` (mirror riga ~977-980), con
     `taskId` e `durationMinutes` dal tool result.
3. **`src/lib/chat/prompts.ts`** (PROTETTO):
   - Nel prompt `morning_checkin`, **dopo** la "REGOLA CRITICA SUL COMMIT" /
     `commit_today_plan`, aggiungi: dopo aver committato il piano, **opzionalmente**
     proponi lo strict — *"Vuoi attivare la modalità strict per lavorare un paio
     d'ore?"* + chiama `offer_strict_mode` quando l'utente acconsente. Non
     insistere se rifiuta. Copy in italiano.
4. **`src/features/chat/ChatView.tsx`** (NON protetto):
   - Estendi il `QuickReply` type (riga 23) col ramo `start_strict`.
   - Nel click handler QR (~riga 676): se `reply.action === 'start_strict'` →
     chiama **`enterStrictMode({ taskId: reply.taskId, durationMinutes: reply.durationMinutes })`**
     (la helper di Fase 2) e poi `router.push('/tasks')` per portare l'utente al
     focus del task. Il ramo `body_double` resta invariato.
5. **`src/app/api/strict-mode/route.ts`**: nessuna modifica necessaria (accetta
   `triggerType` come stringa libera). Usa `'chat_proactive'` da `enterStrictMode`
   quando l'origine è la chat.

**Verifica:** in `morning_checkin`, dopo aver committato il piano, compare la QR
[Sì | Dopo]; su "Sì" lo strict parte (store + shield) e l'utente arriva al focus
del task. tsc+test+build verdi; e2e chat se esiste un probe in `scripts/e2e/*`;
on-device per il blocco reale (Antonio). **Importante:** poiché tocchi i file
protetti, nel report finale elenca esplicitamente cosa hai cambiato in
`tools.ts`/`prompts.ts`/`orchestrator.ts` (sono edit pre-autorizzati ma vanno
rendicontati).

---

## 5. Vincoli tecnici (NON aggirare)

- **Scudo client-side**: la chat non può avviare lo scudo nativo lato server →
  l'azione QR `start_strict` DEVE chiamare `enterStrictMode` **lato client**.
- **`/focus` deep-link**: store potenzialmente vuoto → leggi `blockedApps` via
  `/api/profile`, non dallo store.
- **Una sola sessione strict attiva/utente**: il `POST /api/strict-mode` termina
  le altre sessioni attive (comportamento esistente, accettato). Se l'utente è
  già in una sessione, avviarne un'altra la sostituisce.
- **File protetti**: in `tools.ts`/`prompts.ts`/`orchestrator.ts` modifica SOLO
  le parti descritte (nuovo tool + QR action + paragrafo prompt). Non riscrivere
  il loop dell'orchestrator né l'identità/prompt core.
- **Store Zustand singleton**: condiviso tra route `/` (ChatView) e `/tasks`
  (TasksApp) nella stessa sessione SPA → lo stato strict settato dalla chat è
  visibile dopo `router.push('/tasks')` (no full reload).

---

## 6. Self-verification (Workflow v2)
A ogni fase: `bun run build` + `bun x tsc --noEmit` + `bun run test` verdi.
Fase 1/2: verifica browser (preview) dei cambi visibili. Fase 3: e2e chat se
presente. Commit atomici, niente push. Report finale: file toccati (segnando i
**protetti**), comandi di test manuale, e cosa resta da validare on-device.

---

## 7. Fuori scope (NON fare)
- Avatar/body doubling come esito della proposta proattiva (deciso D2: strict puro).
- Secondo tap per scegliere la durata (deciso: default, niente tap extra).
- Proposta proattiva mid-day o in modalità diverse da morning_checkin (per ora solo lì).
- Scudo iOS (differito, è solo Android).
- Cambiare la logica di friction/uscita dello strict (i 4 step restano).

---

## 8. File toccati (riepilogo)

| File | Protetto? | Cosa |
|---|---|---|
| `src/features/body-double/useBodyDoubleSession.ts` | no | Fase 1: fetch profilo + passa `blockedApps` reali ad avvio + `startShield` |
| `src/lib/strict-mode/enter.ts` (nuovo) | no | Fase 2: helper condivisa `enterStrictMode` |
| `src/app/tasks/page.tsx` | no | Fase 2: one-tap strict dalla Today, bypass ModeSelector; usa `enterStrictMode` |
| `src/features/chat/ChatView.tsx` | no | Fase 3: ramo QR `action:'start_strict'` → `enterStrictMode` + nav |
| `src/lib/chat/tools.ts` | **SÌ** (pre-autorizzato) | Fase 3: tool `offer_strict_mode` + getToolsForMode + executeTool |
| `src/lib/chat/orchestrator.ts` | **SÌ** (pre-autorizzato) | Fase 3: `QuickReply` action `start_strict` + cattura + push QR |
| `src/lib/chat/prompts.ts` | **SÌ** (pre-autorizzato) | Fase 3: paragrafo proposta strict in `morning_checkin` post-commit |

---

## 9. Contesto utile per la nuova sessione
- Memorie rilevanti: `shadow-task59-app-nativa-android` (scudo/APK), `shadow-task55`/`56`/`57`
  (beta), `shadow-task44-piano-conversazionale` (commit_today_plan), `shadow-beta-readiness-audit`
  (stato beta + cosa resta ad Antonio). La beta NON è ancora lanciata: questo task è
  un miglioramento UX/feature, non un beta-blocker — coordina con Antonio se va dentro
  la beta o dopo.
- L'APK nativo del 19/6 è native-current e installabile; lo scudo on-device funziona
  (confermato da Antonio 2026-06-27).
