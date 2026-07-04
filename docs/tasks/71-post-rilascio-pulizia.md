# Task 71 — Post-rilascio: pulizia + robustezza

> Spec preparata il 2026-07-04 a valle del Task 70, dal batch §9 del report
> del collaudo 68 (`docs/tasks/68-report-collaudo.md`) + rimozioni §6 + i
> "fuori perimetro" annotati nel Task 70 (§2). **Base di partenza:
> `feature/70-ux-pre-rilascio`** (contiene i batch D→L) — creare
> `feature/71-post-rilascio-pulizia` da lì. È l'**ultimo anello** della catena
> 63→64→65→66→67→69→70→71: push/merge dell'intera catena = decisione Antonio.

---

## 1. Contesto

Il collaudo 68 (NO-GO condizionato) è stato smontato in tre batch: Task 69
(S1+S2 bloccanti, sblocca il GO), Task 70 (UX ad alta frequenza), e questo
Task 71 — la **coda di robustezza e pulizia** che non blocca il rilascio ma
riduce superficie di rischio, debito e incoerenze prima che l'app cresca in
utenti (e prima di attivare le integrazioni v3). Nessuno di questi item è
"perde dati" o "rompe una promessa core"; sono validazioni API mancanti,
timezone, dead-code e una nota di sicurezza su una superficie orfana.

## 2. Perimetro (dal report 68 §6 rimozioni + §9 batch "Task 71" + fuori-perimetro del 70)

Ordinati per rischio × frequenza. **A** = robustezza/validazione (impatto su
stabilità/telemetria), **B** = pulizia/dead-code (superficie), **C** =
sicurezza da chiudere *prima* delle integrazioni v3.

| # | ID | Cosa | Tipo | Effort | File noti (dal collaudo) |
|---|----|------|------|--------|--------------------------|
| A | **N19 / S2-I** | `POST /api/notifications` con `type` libero permette a un client di scrivere `type='evening_review_prompt'` (= PROMPT_TYPE del dedup) e sopprimere il proprio promemoria serale del cron | A | S | `notifications/route.ts:61`, `cron/evening-review/route.ts:75-84` |
| B | **N50b / S2-J** | `GET /api/memory` e `/api/learning-signal` → 500 non tracciato su `?limit=abc` (NaN → Prisma throw, nessun try/catch, fuori telemetria) | A | S | `memory/route.ts:12-33`, `learning-signal/route.ts:16-28` |
| C | **N24** | `PATCH /api/strict-mode` accetta `status` arbitrario → sessione orfana invisibile alla GET | A | S | `strict-mode/route.ts` (PATCH, whitelist status) |
| D | **N25** | `POST /api/streaks` non-numerico → 500 (nessuna validazione input) | A | S | `streaks/route.ts` |
| E | **N16** | `PATCH status=completed` senza `completedAt` → sfugge a calibrazione/viste | A | S | `tasks/[id]/route.ts` (default completedAt) |
| F | **N13** | Fasce orarie a 3 orologi (ai-assistant UTC vs execution-engine Roma vs client): in prod la sera lo slot ai-assistant slitta (mascherato in dev) | A | M | `getCurrentTimeSlot` (unificare su Europe/Rome) |
| G | **N33** | Onboarding→profilo: logica inline diverge da `initializeProfileFromOnboarding` (dead code divergente) | B | M | `onboarding/complete` route + `initializeProfileFromOnboarding` |
| H | **§6 rimozioni** | `POST /api/review` legacy scrivente (N56); route orfane `streaks`/`patterns`/`contacts`; tabelle `Streak`/`UserPattern` stantie; dead-code engine `prioritizeTaskAdaptive`/`selectTaskForNow`/`adaptiveDetectExecutionMode` (o COLLEGA al piano); `next-intl` inusato; config `decomp_preference` mai triggerato; `/chat` doppione | B | M | `fase34/coerenza-architettura.md` |
| I | **D47 / S2-L** | Unpin impossibile + il modello dichiara il falso ("pin tolto" ma resta): schema tool union-only, prompt prescrive di *dire* che in V1 non si toglie | A | M | `update-plan-preview-tool.ts:19-28,143`, `prompts.ts:1146-1147` (**PROTETTI**) |
| J | **J11 body doubling** | "Ho finito" auto-completa TUTTO il task e i sotto-step a prescindere dal lavoro reale; su task senza step il summary è spoglio ("0 minuti") | A | M | `useBodyDoubleSession` + summary; segnale bd (completa il loop del 70 G) |
| K | **N11** | Troncatura share senza indicazione | B | S | share target |
| L | **N60** | `calendar/oauth/callback` senza `state` anti-CSRF | **C** | M | superficie orfana (calendar v3): chiudere PRIMA di attivare l'integrazione |
| M | **N61** | Email/notifiche OS non conoscono lo stato focus; backoff email inattività | A | M | cron email + stato strict/body-double |

**Note:** L (N60) è su superficie orfana (nessun entry-point UI, `GOOGLE_CLIENT_ID`
assente in prod) → non blocca il rilascio, ma è **debito da chiudere prima di
attivare calendar (v3 W8)**. I (D47) e J toccano file core chat: dichiararli nel
piano. Le rimozioni H vanno fatte con cautela (verificare zero consumer prima
di cancellare tabelle/route).

## 3. Prompt di avvio (per la nuova sessione)

```
Vai con il Task 71 (post-rilascio: pulizia + robustezza), ultimo della catena.
La spec è in docs/tasks/71-post-rilascio-pulizia.md — perimetro §2, decisioni
da pormi §4. Parti da feature/70-ux-pre-rilascio (NON da main: la catena
63→70 non è ancora mergiata), crea feature/71-post-rilascio-pulizia. Workflow
v2: esplora, fammi le domande di prodotto in un colpo solo, poi piano in plan
mode e implementa end-to-end con commit checkpoint. Riusa l'harness
scripts/e2e/task70/ e scripts/e2e/collaudo-68/ (gotcha: api() vuole
{cookie, body} come terzo argomento). Attenzione: I/D47 e J toccano file core
chat (prompts.ts, update-plan-preview-tool.ts); le rimozioni H richiedono
verifica di zero-consumer prima di cancellare. Push e merge dell'intera
catena: li decido io alla fine.
```

## 4. Decisioni di prodotto da porre a inizio sessione (AskUserQuestion)

1. **H/rimozioni** — Quanto aggressiva la pulizia: (a) solo dead-code sicuro
   (engine mai chiamati, config mai triggerata, `next-intl`) lasciando
   route/tabelle in piedi (raccomandata, rischio minimo pre-crescita) vs
   (b) rimozione completa incluse tabelle `Streak`/`UserPattern` (serve
   migration DROP — sotto conferma) vs (c) COLLEGARE il dead-code engine al
   piano invece di rimuoverlo (recupera lavoro, più effort).
2. **I/D47 unpin** — (a) aggiungere l'unpin reale (schema tool + prompt: il
   pin si toglie) (raccomandata: chiude la promessa falsa) vs (b) solo far
   dire al modello la verità ("in questa versione il pin resta") senza
   aggiungere la capacità (meno tocco ai file core).
3. **J/body doubling** — (a) "Ho finito" chiede quali step sono davvero fatti
   prima di completare (raccomandata) vs (b) completa solo il task, lascia i
   sotto-step allo stato attuale vs (c) lascia com'è (fuori scope, → v1.1).
4. **L/N60 calendar CSRF** — (a) implementare `state` param ora, anche se la
   superficie è orfana (raccomandata: si chiude e non si riapre) vs (b)
   rimandare a v3 W8 con un TODO tracciato (la superficie è irraggiungibile
   in prod).

## 5. Vincoli e note operative

- **File protetti attesi**: `prompts.ts` + `update-plan-preview-tool.ts` (item
  I/D47), eventuale `orchestrator.ts` (J). Dichiararli nel piano.
- Migration DB **solo** se si sceglie 1(b) (DROP tabelle) — sotto conferma
  esplicita di Antonio, come da regola.
- Verifica: build+tsc+test (baseline attesa ~1087+), probe e2e mirati (riuso
  `scripts/e2e/task70` e `collaudo-68/lib`), 1 run LLM per D47 se si tocca il
  prompt del pin. La coorte `collaudo68-*` resta viva; effimeri
  `collaudo68-t71-*`.
- Zero regressioni sui batch 63→70: girare i probe delle sessioni precedenti
  come smoke prima di chiudere.

## 6. Esito atteso

Batch pulizia/robustezza completo su `feature/71-post-rilascio-pulizia`, commit
atomici, report finale con: file toccati, esiti probe/LLM, tabella item→stato,
rimozioni effettuate (con la lista dei consumer verificati a zero), stato del
debito N60. **Questo è l'ultimo task della catena**: a valle, il report deve
elencare l'intera sequenza di branch da mergiare in ordine
(63→64→65→66→67→69→70→71) e le verifiche di produzione post-merge (env Vercel,
migrate-on-deploy, smoke).
