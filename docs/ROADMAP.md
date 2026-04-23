# ROADMAP — Shadow v2

> Aggiornata 2026-04-23 dopo review post-Task 1. La versione precedente è
> archiviata nella history git.

---

## Visione del prodotto

Shadow è un assistente conversazionale per adulti ADHD. Core loop:

1. **Inbox ovunque** — l'utente butta dentro qualsiasi cosa (compiti, scadenze,
   impegni, appuntamenti), senza categorizzare.
2. **Ingest automatico da Gmail** — scadenze e cose da fare dalle email finiscono
   nell'inbox senza input manuale.
3. **Apertura app = chat** — la chat è il punto di ingresso principale. Quando
   l'utente apre Shadow trova la chat pronta ad aiutarlo col piano già deciso la
   sera prima (body doubling).
4. **Review serale conversazionale** — ogni sera Shadow attraversa l'inbox voce
   per voce parlandone con l'utente: priorità, urgenza, blocchi, decomposizione.
   Produce il piano della giornata successiva distribuendo intelligentemente.
5. **Calendar bidirezionale** — appuntamenti e scadenze scritti su Google Calendar,
   eventi esistenti letti per evitare conflitti.

**Target orizzonte beta (4-6 settimane)**: 20-100 tester selezionati dalla
community ADHD.

---

## ✅ Completati

- **2026-04-XX** — 4 fix comportamentali (filtro contesto, timing feedback,
  completa-tutto, trigger strict mode). Vedi `CHANGELOG-4FIX.md`.
- **2026-04-23** — **Task 1: Data Isolation**. Tutte le 27 route protette con
  `requireSession`, schema userId obbligatorio con Cascade, tipi NextAuth puliti,
  hotfix `prisma generate` nel build. Vedi `docs/tasks/01-data-isolation.md` e
  `docs/schema-changes/2026-04-23-require-userid.md`.

---

## 🎯 Fase 1 — Fondamenta della chat

L'app deve funzionare per l'esperienza principale prima di aggiungere feature.

### 🔴 Task 2 — Fix flow onboarding iniziale *(IN CORSO)*

**Spec completa**: `docs/tasks/02-fix-onboarding.md`

L'onboarding esiste già ed è progettato bene, ma non parte al momento giusto.
Un utente nuovo registrato non lo vede; invece parte (in forma parziale) quando
si apre `/tasks`. Va spostato al primo accesso post-registrazione, rimosso da
`/tasks`, e il profilo adattivo deve essere popolato correttamente prima che
l'utente veda la chat.

**Perché prima di tutto**: la chat (Task 3) e la review serale (Task 5) leggono
dal profilo adattivo. Senza onboarding quei dati sono vuoti.

---

### 🔴 Task 3 — Fix bug chat (task duplicati + persistenza thread)

**Spec**: `docs/tasks/03-fix-chat-bugs.md` *(da creare dopo Task 2 done)*

Due bug distinti:

*3a — Task duplicati*: quando l'utente chiede un secondo task, il modello
ricrea anche il primo. Gestione del context LLM: tool_use già eseguiti non
devono generare nuove tool calls. Probabile fix: filtraggio context passato
al LLM o tracciatura server-side dei tool_call_id eseguiti.

*3b — Chat persa al ritorno*: navigare da chat a `/tasks` e tornare fa
perdere il thread. Persistenza lato client del `currentThreadId` (Zustand
persist parziale, solo questo campo, non tutto lo store).

**Acceptance**:
- Creazione 3 task consecutivi in chat → 3 task nel DB (non 6 o 9)
- Navigazione via e ritorno → conversazione continua
- Reload pagina → thread riprende

---

### 🟠 Task 4 — Hotfix pre-beta essenziali

**Spec**: `docs/tasks/04-pre-beta-hardening.md` *(da creare)*

Minimum hardening prima di invitare utenti reali.

- Rate limiting registrazione (max 3/IP/giorno)
- Rate limiting chiamate AI (max N/utente/giorno, da dimensionare)
- Sentry free tier per error tracking
- UptimeRobot per uptime monitoring
- Documento di test manuale formale per isolation end-to-end

Non include password policy rigorosa, backup Neon Pro, migration baseline,
cross-platform build: tutti dentro Task 10.

---

## 🎯 Fase 2 — Il cuore del design

### 🔴 Task 5 — Review serale conversazionale

**Spec**: `docs/tasks/05-review-serale.md` *(da creare)*

Il cuore del design. Ogni sera (trigger: 21-22, o manuale) Shadow attraversa
conversazionalmente le voci inbox non ancora classificate:

- Domande su urgenza, importanza, deadline, blocchi, energia richiesta
- Decomposizione in micro-step se serve
- Scheduling intelligente distribuito su giorni successivi
- Creazione eventi Calendar (se integrazione pronta)
- Output: `DailyPlan` per domani e giorni seguenti

Riusa gli engine esistenti: `priority-engine`, `decomposition-engine`,
`profiling-engine`.

**Stima**: 1-2 settimane. Feature più sostanziosa della fase.

---

### 🟠 Task 6 — Ingest Gmail

**Spec**: `docs/tasks/06-gmail-ingest.md` *(da creare)*

Google OAuth è già configurato per login. Estendere scope per lettura Gmail.
Parsing intelligente di scadenze, pagamenti, appuntamenti, cose da fare.
Ingest verso inbox con `source: 'gmail'` e link email originale.

---

## 🎯 Fase 3 — Espansione

Priorità guidate dal feedback dei 20-100 tester.

### 🟡 Task 7 — Calendar sync bidirezionale
Lettura eventi esistenti da Google Calendar per scheduling intelligente senza
conflitti. Scrittura task schedulati come eventi.

### 🟡 Task 8 — Widget inbox sempre disponibile
Notifiche push per aggiungere voci inbox senza aprire l'app. Capability mobile
native richiesta.

### 🟡 Task 9 — Split `page.tsx`
Rimandato dalla roadmap originale. Refactor manutenibilità, non funzionalità.
Da fare quando il monolite blocca davvero lo sviluppo.

### 🟡 Task 10 — Hardening produzione completo

Include tutti i follow-up registrati durante Task 1:

1. Strict mode `mode` bug client-side (chiamata fallisce 400, preesistente)
2. 19 errori lint in shadcn/hook
3. Errore TS #2 in `src/app/tasks/page.tsx:3272`
4. Rimuovere `ignoreBuildErrors: true` dopo fix #2 e #3. **Nota**: durante
   Task 2 (2026-04-24) è stato applicato un fix tattico in
   `src/app/api/ai-assistant/route.ts` (helper locale `toDbAdaptiveDelta`)
   per sbloccare il learning su nudge/proactive/micro-feedback. Quando
   verrà fatto il rewrite sistematico qui, rimuovere quell'helper locale
   e centralizzare in `src/lib/engines/`.
5. `cp -r` nel build script non cross-platform
6. Middleware deprecato Next 16.2.4 → migrare a `proxy.ts`
7. `prisma migrate` baseline invece di `db push`
8. `prisma validate` + `DATABASE_URL` reachability in fase build

Più: password policy, backup Neon Pro, Plausible analytics, Sentry advanced.

---

## Come lavorare su un task

1. Aprire Claude Code: `claude` in `C:\shadow-app`
2. Dire: `Leggi docs/tasks/NN-nome.md. Fai il piano e aspetta OK prima di scrivere codice.`
3. Approvare piano, implementare a step verificabili
4. `bun run build` deve passare prima di commit
5. Commit locale con messaggio descrittivo (no push automatico)
6. Discutere qui con Antonio prima del push
7. `git push`, verifica deploy Vercel, acceptance test
8. Marcare task come ✅ in questo file
