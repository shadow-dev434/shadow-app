# Task 65 — Pulizia superfici morte + automazioni (batch medio dal collaudo 62)

> Spec operativa per una **sessione pulita** di Claude Code (normale, non ultracode).
> Scritta il 2026-07-02 dalla sessione del Task 64, sulla base del report di collaudo
> (`git show docs/62-report:docs/tasks/62-report-collaudo.md`, §5/§6/§8-231) e del suo
> registro automazioni. Decisione di Antonio (2026-07-02): **batch medio** = pulizia +
> ricorrenti + timer + automazioni review (J4/J5/J2). D56 (URL per vista), D57 (economia
> interruzioni) e monitor Resend restano FUORI (→ task successivo o v3).
> Effort atteso: ~4-5 giorni.
>
> **Branch di partenza: `feature/64-ux-pre-lancio`** (stack 61+63+64, non mergiato) →
> creare **`feature/65-pulizia-automazioni`** da lì. Se nel frattempo lo stack è stato
> mergiato su main, partire da main — verificare con `git log --oneline -3 main`.
> Lo stato di partenza INCLUDE già dal 63/64: auto-classificazione quick-capture (A7),
> guard consenso server-side (§6.7), logout reale (A8/D5), oauth calendar 404 (B3),
> import Bell rimosso (B5), VALID_MODES ristretto (B4/D75), Today a fasce con conferma
> (A2), nudge/dialog col taskId giusto (A6). NON rifarle.

---

## 0. Regole operative (ereditate, NON negoziabili)

1. **Workflow v2**: esplora → domande di prodotto (AskUserQuestion) → piano in plan mode
   → approvazione = unico checkpoint → implementazione end-to-end con self-verification
   (build + tsc + test + probe + browser) → commit checkpoint su feature branch.
2. **Solo dev locale** (:3000) contro DB dev **royal-feather** (preflight host prima di
   ogni scrittura). MAI probe sui deploy Vercel (Preview/Dev condividono il DB di PROD).
3. **Utenti di test**: i 12 `collaudo-*@probe.local` vivi (pwd `Collaudo62!pass`) +
   effimeri `task65-*@probe.local` col pattern di `scripts/e2e/task63/lib.ts` e
   `scripts/e2e/task64/lib.ts` (riusarle). Bonus: `task64-browser@probe.local` è
   seminato con piano a fasce (`scripts/e2e/task64/seed-browser-user.ts` lo ricrea e
   stampa il cookie da iniettare).
4. **Una sola sessione Code sul repo**; verifica browser: preview MCP `shadow-dev`
   (il dev server è FERMO: riavviarlo con preview_start), disinstallare SW+cache prima,
   DOM probe invece di screenshot. Gotcha noti: un cookie HttpOnly stale vince
   sull'inject `document.cookie` → prima signout via `/api/auth/csrf` + POST
   `/api/auth/signout`; il nome utente nei Settings può restare stale da localStorage.
5. File **protetti** (conferma esplicita, da dichiarare nel piano): `orchestrator.ts`,
   `prompts.ts`, `update-plan-preview-handler.ts`, `schema.prisma`, `.env*`,
   `next.config.*`, `package.json`. Nel perimetro 65 il rischio è su **E (J4/J5/J2)**:
   se il piano di rientro o il triage richiedono di toccare prompt/plan-preview
   handler, dichiararlo esplicitamente nel piano. `components/ui/**` mai.
6. **Zero migration DB attese** per A-D. Per E e per l'eventuale reminder via email
   (D13 opzione b): se serve un campo nuovo, fermarsi e chiederlo esplicitamente
   nel piano (migration = sempre conferma esplicita).
7. Testi utente: **italiano hardcoded** (beta IT-only). I prompt LLM restano master IT.
8. Il manifest PWA e `sw.js` NON sono file protetti ma sono delicati (D68/D13 li
   toccano): commit separato + verifica browser con SW pulito dopo.

---

## 1. Perimetro — 5 gruppi

Riferimenti file:riga dal dossier 62 (rilevati su feature/61; 63/64 hanno spostato
`tasks/page.tsx` e `sw.js` può essere cambiato — **ricontrollare coi Grep, non fidarsi
dei numeri**).

### A. Pulizia superfici morte (rimozioni, effort S ciascuna)

**A1 — D13 · Reminder morto end-to-end.** Input orario nel TaskDetail (page.tsx
~:2902-2933 su feature/61) senza dispatcher; `sw.js:257-278` (`syncReminders`) chiama
un'API inesistente. **Decisione di prodotto DA FARE con AskUserQuestion** (Antonio,
2026-07-02: "decide la sessione 65 dopo l'esplorazione"):
- (a) **rimozione pulita** — via input + syncReminders; per la beta non si promette
  ciò che non c'è; reminder veri → v3 W5 push nativi. Effort S.
- (b) **implementazione minima via email** — campo orario (ATTENZIONE: probabile
  migration → conferma esplicita) + cron dispatcher che riusa il canale Resend del
  Task 58. Effort M.
Proporre (a) come raccomandata se l'esplorazione non rivela un dispatcher parziale.

**A2 — D68 · Shortcuts manifest + `?action=` + quick-capture offline.** Il manifest
dichiara shortcuts con `?action=` che NESSUN client legge; il SW ha percorsi
quick-capture offline orfani. Contratto: rimuovere gli shortcuts dal manifest O
implementare il reader di `?action=` (pattern `?draft=`/`?plan=today` già in
ChatView:246+ — se il costo è una manciata di righe, il reader è preferibile:
proporre la scelta nel piano con raccomandazione). Il push handler senza sender
resta morto → rimuoverlo.

**A3 — D71 · Campi Settings morti.** `defaultEnergy/Context/Duration/Format`,
`productiveSlots`, `theme`, `reminderMinutes` scrivibili da API ma invisibili in UI
(`wakeTime/sleepTime` ora validati dal 64-B2 ma sempre senza UI). **Decisione di
prodotto**: nascondere (togliere dalla whitelist PATCH ciò che non ha UI) vs esporre
in Settings. Proporre nel piano: esporre SOLO wake/sleep + theme se già consumati da
qualche engine, nascondere il resto (verificare coi grep chi li legge davvero).

**A4 — D72 · Delega senza flusso.** Quadrante "delegate" + Contact CRUD senza alcun
flusso di assegnazione. Per la beta: nascondere il quadrante delegate dalle viste e
le API Contacts restano (non fanno danno) ma zero ingressi UI. NON cancellare le
route (v3 le riprende).

**A5 — Residui D69/D70.** D69: verificare zero menzioni UI di Google Calendar
(l'oauth già risponde 404 dal 64). D70: decidere le route `push-subscription`/
`notifications` orfane — lasciarle (v3 W5 le usa) ma verificare che nessun client le
chiami a vuoto. Solo verifica+eventuale pulizia leggera, non riscrivere.

### B. Ricorrenti che si materializzano da soli

**B1 — ADV-ricorrenti · Materializzazione su Today/inbox.** Oggi
`materializeRecurringForDate` (`src/lib/recurring/materialize.ts`) gira solo nel
percorso chat: chi non chatta non vede l'istanza del giorno. Contratto: materializzare
anche in `GET /api/tasks` e/o `GET /api/daily-plan` (idempotente, già lazy) — scegliere
il punto con l'esplorazione (uno solo, niente doppioni; attenzione alla latenza della
GET: se il costo è alto, valutare fire-and-forget o cron).

**B2 — J7 · Materializzazione retroattiva.** Se non apri l'app, l'istanza di ieri non
nasce mai: rollover/backfill al primo accesso del giorno dopo (decidere finestra max,
es. 7 giorni) O cron giornaliero (c'è già il pattern cron del Task 58 con CRON_SECRET).
Proporre nel piano la via più semplice e testabile.

**B3 — D49 · Gestione ricorrenze da UI.** Oggi le ricorrenze si creano/gestiscono solo
in chat. Contratto minimo: una lista "Ricorrenti" (dove: Settings o sezione del Cielo —
**decisione di prodotto, proporre 2 opzioni con mockup testuale**) con: elenco template
(frequenza leggibile in italiano), pausa/riattiva, elimina (con conferma pattern 63).
Creazione/modifica restano in chat (la CTA del Cielo del 64 già ce la porta) — NON
costruire un form di ricorrenza completo.

### C. Micro-fix esecuzione

**C1 — D32 · Timer che parte da solo.** Dopo lo strict one-tap (Task 61) la FocusView
atterra col timer in pausa: farlo partire subito. Rilevato su feature/61 — verificare
che 63/64 non l'abbiano già cambiato (l'arming effect della FocusView inizializza il
timer: cercare `isExecuting`/arming effect in page.tsx).

**C2 — §6.8 · Invalidazione sessioni al delete/reset.** Dopo delete account la vecchia
sessione JWT resta valida fino a scadenza (ADV-delete "sessione fantasma"). Contratto:
claim di versione (`userVersion`/`passwordChangedAt`) verificato in `requireSession`
— MA richiede un campo/claim: se serve migration fermarsi e chiedere; se basta
verificare l'esistenza dell'utente a ogni `requireSession` (una query in più),
proporre quel trade-off nel piano.

### D. Verifiche pre-lavoro (non rifare ciò che è chiuso)

Prima del piano, verificare lo stato REALE di queste voci del registro §6 (potrebbero
essere già chiuse dallo stack 61-64): §6.10 D4 (beta senza logout — il 63 ha toccato
il gate beta), §6.1 D32 (vedi C1). Se chiuse, dichiararle nel report e toglierle dal
piano.

### E. Automazioni review (il pezzo delicato — file protetti possibili)

**E1 — J4 · Piano di rientro precompilato.** Al ritorno con N task scaduti, oggi la
chat parte vuota. Contratto: proporre in automatico i 2-3 critici in Top3 con UNA
conferma (quickReply "Sì, parti da questi" / "No, scelgo io"). Esplorare dove vive il
morning check-in / bootstrap chat; se il fix passa da `prompts.ts` o
`update-plan-preview-handler.ts` → **dichiarare i file protetti nel piano**.

**E2 — J5 · whatBlocked → primo micro-step armato.** La review cattura "non so da
dove partire" ma il giorno dopo non se lo ricorda. `generateRecoveryAction`
(engine, già esistente — NON riscrivere) genera il micro-step da 30s: la Today del
giorno dopo lo arma sul task evitato (badge/CTA sul task nella Top3/fasce).

**E3 — J2 · "l'ho fatta" nel triage completa il task.** Oggi nel triage della review
non esiste il percorso "già fatto" (né outcome 'done'). Contratto: la voce di triage
riconosce la conferma di completamento e chiude il task (status completed +
completedAt), senza rigirarlo nel piano. Esplorare `src/lib/evening-review/triage.ts`
+ il tool di review: se il fix richiede di toccare i prompt della review →
**dichiararlo** (probabile: estensione enum outcome + handler, i prompt master della
review potrebbero già contemplare la risposta).

### Fuori scope (→ task successivo o v3)
D56 URL per vista, D57 economia interruzioni (popup/nudge/micro-feedback), J10 monitor
Resend + notifica tester "fixed", §6.11 chiusura d'ufficio plan_preview, §6.12
auto-decomposizione, D21 share-target 401, i18n runtime (W4), nativo/APK (v3).

---

## 2. Ordine suggerito e verifica

1. **D (verifiche pre-lavoro)** + esplorazione → domande di prodotto → piano.
2. **A (pulizia)** — un commit per voce o per coppie affini; A1 dopo la decisione.
3. **C1 timer** (piccolo, isolato).
4. **B ricorrenti** (B1 → B2 → B3; probe DB per B1/B2).
5. **C2 sessioni** (dopo aver scelto il meccanismo).
6. **E automazioni review** (per ultimo: il più delicato, possibili file protetti,
   verifica conversazionale accurata).

Verifica per step: `bun run build` + `bunx tsc --noEmit` + `bun run test`; probe e2e in
`scripts/e2e/task65/` (riusare `task63/lib.ts` e `task64/lib.ts`): B1/B2 istanza
materializzata in GET senza chat (+ retroattiva), C2 sessione morta post-delete → 401,
A1 (se rimozione) SW senza syncReminders, E3 triage 'done' → task completed in DB;
browser (preview MCP, SW pulito): manifest senza shortcuts morti (o reader funzionante),
Settings senza campi fantasma, lista Ricorrenti (B3), timer che parte (C1), E1/E2 nel
flusso chat/Today reale. Attenzione build Windows: fermare il dev server prima di
`bun run build` (EPERM Prisma sulla DLL, troubleshooting in CLAUDE.md).
Report finale: file toccati, esiti probe, comandi di test manuale, costi.

Domande di prodotto da fare PRIMA del piano (AskUserQuestion, non inventare):
- A1: reminder — rimozione vs email minima (con l'evidenza dell'esplorazione).
- A3: quali campi Settings esporre vs nascondere (con l'elenco di chi li legge).
- B3: dove vive la lista Ricorrenti (Settings vs Cielo) + mockup 2 varianti.
- E1: copy/aggressività del piano di rientro (quanti task, quale conferma).
- Se Antonio non risponde: default raccomandati DICHIARATI nel piano, ratificati
  dall'approvazione (pattern del Task 64, ha funzionato).

---

## 3. Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`)

```
Leggi docs/tasks/65-post-lancio-pulizia-automazioni.md ed eseguila col workflow v2:
parti dal branch feature/64-ux-pre-lancio (o da main se lo stack 61-64 è già stato
mergiato), crea feature/65-pulizia-automazioni, fai le verifiche pre-lavoro §1-D,
esplora i punti indicati, fai le domande di prodotto previste dalla spec, poi proponi
il piano in plan mode dichiarando eventuali file protetti (perimetro E). Dopo
l'approvazione implementa end-to-end con self-verification (build, tsc, test, probe
e2e in scripts/e2e/task65/ riusando task63/lib.ts e task64/lib.ts, verifica browser
via preview MCP con SW pulito) e commit checkpoint. Solo dev locale contro il DB dev
royal-feather (preflight host). Utenti collaudo-* (pwd Collaudo62!pass) o effimeri
task65-*. Al termine: report con file toccati, esiti probe e comandi di test manuale.
```

Nota per Antonio: chiudere la sessione del Task 64 (o non usarla sul repo) mentre gira
la 65 — index git condiviso. Il dev server del preview è fermo: la 65 lo riavvia con
`preview_start shadow-dev`.
