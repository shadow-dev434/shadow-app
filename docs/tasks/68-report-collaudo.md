# Task 68 — Report del collaudo finale pre-rilascio (Shadow)

> Esecuzione: 2026-07-04, sessione **Fable 5 + ultracode**, su `main = origin/main = 56e0f83`.
> Solo dev locale (:3000) contro il DB dev **royal-feather**, utenti dedicati `collaudo68-*`.
> Metodo: Fasi 0→6 con fan-out multi-agente (20 agenti journey in Fase 1, 4 di sweep in Fase 2,
> 4 di analisi UX/coerenza in Fase 3/4, 7 verificatori adversariali in Fase 5) + verifica
> browser diretta per J1/J8/J11/J12 e il walkthrough. Evidenze in `docs/tasks/68-evidenze/`.
> **Nessun fix applicato al codice dell'app** (solo report, come da mandato).
> Spesa LLM dell'app (AiUsage): **~$13–16** (parziale: gli utenti effimeri cancellati portano
> via le loro righe col cascade; la sola Fase 1 ha sommato ~$13,04 dai `llmSpend` pre-cleanup).

---

## 1. Executive summary

### (a) Verdetto: **NO-GO CONDIZIONATO** al rilascio agli utenti veri

L'app è **funzionalmente solida sui percorsi felici** e **tutti i 18 fix dei Task 63-67 (R1-R18)
reggono end-to-end** (§2): il one-tap Today parte davvero (R3), lo strict rehydrate tiene alla F5
(R2), la crisi è protetta (R5), il consenso/GDPR/reset revocano le sessioni (R6/R16), i ricorrenti
si auto-materializzano (R11), la review 0-candidate e la chiusura d'ufficio funzionano (R17/R18).
Il primo giorno (register→tour→consenso→onboarding→chat→cattura) fila senza vicoli ciechi.

**Ma non è pronta per "utenti veri" finché non si chiude un pacchetto ristretto di difetti** che
o **rompe la promessa centrale del prodotto** o è un **obbligo legale/sicurezza pre-rilascio**:

**Blocker S1 (1):**
- **S1-1 — Perdita silenziosa di task alla cattura** (J3, CONFERMATO adversarialmente). In un
  thread lungo con catture rapide, il modello dichiara "Creato il task" **senza eseguire il tool
  e senza scrivere nulla in DB** (5 catture su 16 nel walk reale), e alla contestazione *raddoppia*
  ("è già stato creato prima", falso). È un difetto **probabilistico** (emerge sotto stress:
  thread lungo + rolling summary + conferme vaghe), non deterministico, ma colpisce **la promessa
  n.1 dell'app — catturare senza pensarci** — e non dà alcun segnale all'utente. La cattura pulita
  con conferma esplicita regge (15/15). `orchestrator.ts` + `claim-guard.ts:59-65` (l'escape-hatch
  della guidance è la radice).

**Must-fix pre-rilascio non-S1 ma bloccanti per policy (legale/sicurezza):**
- **Consenso in "bozza 0.2-draft" mostrato all'utente** (`ConsentView`, footer visibile;
  `CONSENT_VERSION='0.2-draft'`). Un'app che tratta dati art.9 GDPR non può andare live con un
  consenso dichiaratamente bozza. (S2, §Appendice C).
- **Bypass sessioni pre-reset sulle guard admin/beta** (N21, CONFERMATO S2): dopo un reset
  password, il vecchio cookie è respinto da `requireSession` ma **passa ancora** su `/api/admin/*`
  e `PATCH /api/beta/assessment` (`admin-guard.ts:53-102` non legge `passwordChangedAt`).
- **Export GDPR raggiungibile solo dai beta in UI** (N22/D66, S2): il diritto art.20 esiste per
  tutti via `/api/export`, ma la card è `isBetaTester`-only → nessuna superficie per l'utente vero.

**Cluster S2 che tradisce promesse core (fortemente raccomandato prima del rilascio):**
- La review serale **perde dati o promette senza mantenere** in tre punti distinti
  (D45 review interrotta persa; D46 "le altre due dopodomani" senza ripescaggio — *ed è il prompt
  stesso a far dire la formula*; shame-day: il carryover dei falliti di ieri è **strutturalmente
  impossibile**), tutti CONFERMATI S2.
- La **famiglia "claim-senza-tool"** (il modello dice "lo segno fatto / li rimando tutti / piano
  bloccato / pin tolto" senza eseguire alcun tool) è **pervasiva dentro la review**, dove il
  claim-guard non arriva: erode la fiducia su ogni serata.
- Sotto sovraccarico la review **riempie invece di ridurre** (12 voci con energia dichiarata 2,
  presentate come "equilibrato") ed **esclude il backlog urgente** (J13): per un'app il cui pitch
  è *ridurre il carico*, è il fallimento più diretto del promise (ridimensionato da S1 a S2 perché
  è spec-conforme e i task restano visibili in Today, ma comportamentalmente pesante).
- Il **loop di apprendimento è cieco** (N5/N6/N7): completare via chat/body-double/triage non
  emette `task_completed`, i segnali server-side restano `processed=false` per sempre, e il piano
  engine **ignora il profilo appreso** (`prioritizeTaskAdaptive` è dead code). La promessa del tour
  "più lo usi, più si adatta" **non è mantenuta sul deliverable centrale** (il piano).

Nessuno di questi impedisce *tecnicamente* l'uso quotidiano felice, ma per un rilascio a utenti
veri il pacchetto S1 + legale/sicurezza + integrità-review va chiuso (Task 69). Verdetto del 62 era
identico ("NO-GO condizionato"): i 5 blocker del 62 sono stati chiusi dal 63; qui emergono nuovi
difetti più profondi perché il perimetro è più ampio (review, apprendimento, body doubling,
observability, offline) e la lente è "utenti veri", non più "beta interna".

### (b) Le 5 mosse a più alta leva su retention/soddisfazione

Pescate da UX + automazioni + coerenza, non solo dai bug:

1. **Estendere il claim-guard a review/plan + emettere `task_completed` server-side.** Un solo
   intervento di fiducia+dati: chiude la famiglia claim-senza-tool nella review (ogni-sessione) e
   sblocca il learning loop (N5). Effort S+M, impatto altissimo.
2. **Carryover automatico dei falliti di ieri nella review + includere il backlog urgente.** I due
   difetti che tradiscono il pitch "riduco il carico" (shame-day + J13). Effort M.
3. **Ponte Cielo: il completamento di un ricorrente porta/mostra il Cielo.** Oggi è solo un toast:
   l'unico anello di ricompensa dell'app è disaccoppiato dall'azione che lo genera. Effort S,
   impatto alto su soddisfazione (M-1).
4. **Navigazione chat↔tasks senza full reload.** Il giro più frequente dell'app costa ~3–5s per
   reload su WebView fredda (`window.location.href`); il rendering è già co-locato, serve solo la
   transizione client. Effort M, impatto alto su ogni sessione (N28b).
5. **Riuso del mood/energia del mattino nella review + review a superficie (non solo chat).** Il
   doppio rito mood/energy (N32) e la review 100% conversazionale sono il grosso del carico
   giornaliero *aggiunto* dall'app; una review a bottoni + il default "stamattina eri a 4, confermi?"
   lo dimezzano. Effort S+M.

### (c) Risposta secca alle 4 domande di prodotto

| Domanda | Misura (dal collaudo) |
|---|---|
| **Tempo-al-primo-valore** | ~**30 interazioni** e **~2 turni chat** (~45s di attese LLM cumulate) da register a 3 task organizzati con mini-piano (J1). Register→auto-login→tour(6)→consenso(2 switch)→onboarding(12)→3 QR intake→prima cattura. |
| **Interruzioni/giorno** | Popup ben governati dal coordinatore 66B; **max simultanee = 2** e accade al **completamento** (toast celebrativo + micro-feedback insieme, N26 — l'unico punto dove "una alla volta" si rompe, ed è ogni-completamento). **Durante strict/body-double: ZERO popup in-app** (target rispettato); rischio residuo = email/notifiche OS che ignorano lo stato di lavoro (N61). |
| **Durata review** | Normale (J6a): **13 turni utente / 137s** di sola latenza LLM (stima reale ~4-5 min con lettura+digitazione). Sotto carico (J13): **20 turni / ~249s** (stima reale ~8-10 min). L'intake mood da solo può bruciare 5 turni (D15). |
| **Carico giornaliero richiesto** | Check-in mattutino (3 domande obbligate: umore/energia/tempo) + mood/energy **ri-chiesti da capo la sera** (N32) + review conversazionale. È carico *aggiunto* dall'app: mood/energy chiesti 2×/giorno senza riuso, review sempre-conversazionale. |

---

## 2. Esito del pacchetto regressione R1-R18 (i fix 63-67 reggono?)

**Tutti verdi end-to-end.** Nessuna regressione reale dei fix 63-67. (Dettagli e path evidenza nel
consolidato `68-evidenze/fase1-consolidato.md` e nei probe di `fase0/probes/`.)

| Fix | Esito | Nota |
|---|---|---|
| R1 claim-guard | ✅ **regge** nel morning check-in (commit reale, zero claim prematuri). ⚠️ **ma NON copre evening_review/plan** → è la radice del cluster claim-senza-tool (S1-1 e §4). |
| R2 strict rehydrate | ✅ F5 in strict → sessione rehydrata, timer residuo corretto, strict attiva (browser J8). |
| R3 one-tap Today | ✅ 1 tap → timer che scorre da solo (browser J8: 49:59→47:06). Chiude il blocker L1 #1 del 62. |
| R4 focus/soft server | ✅ probe task64/a9-soft-cycle PASS. |
| R5 crisis-guard | ✅ 2/2 run: risorse reali, zero tool, zero segnali (J6d). |
| R6 consenso/sessioni | ✅ revoca → 403 ovunque; delete → 401; PATCH profile limitato a tour* (J10, J9). |
| R7 gate/logout reali | ✅ login reale minta isBetaTester nel JWT (J10). ⚠️ caveat D-auth (§4). |
| R8 auto-classify quick-capture | ✅ 5 POST paralleli → autoConfirmed, aiClassified persiste (J3). |
| R9 Today a fasce + conferma | ✅ DailyPlanTask 5/5 con slot; "Rigenera" chiede conferma (J2). ⚠️ slotContextsJson resta '{}'. |
| R10 429/errori IT | ✅ (coperto meccanicamente task64). |
| R11 ricorrenti self-materializing | ✅ istanza di oggi dal solo GET /api/tasks; rollover 1 occorrenza (J7). |
| R12 automazioni review (rientro/micro-step) | ✅ riga RIENTRO al 1° tentativo; micro-step da task_blocked ≤36h; outcome completed chiude (J4/J5). |
| R13 `?view=` URL | ✅ deep-link/refresh/back; `?view=focus` senza sessione → today (J8). |
| R14 economia interruzioni | ✅ budget 3/giorno + 15min persistito (J5). ⚠️ per-device (N14). |
| R15 observability beta | ✅ fixed reale → Notification+email tester, no re-stamp; email fallita → traccia+summary (J10, Fase 2). |
| R16 reset → revoca sessioni | ✅ sessione pre-reset → 401 su requireSession (J10). ⚠️ **ma NON su admin/beta guard — N21**. |
| R17 review 0-candidate | ✅ intake → preview vuota → Review+DailyPlan scritti, nessuna riproposta (J6f). |
| R18 share onesto + auto-decomp | ✅ share SW-mediated (J12); auto-decomp 67C step pregenerati + skip no-dup (J6g). ⚠️ dopo "Cambiali" gli step rigenerati si perdono (§4). |

---

## 3. Scorecard lente ADHD (L1-L10) con confronto al 62

| # | Criterio | Voto 68 | vs 62 | Sintesi |
|---|----------|:------:|:----:|---------|
| L1 | Tap-budget | **B+** | ↑ | One-tap Today RISOLTO (era il blocker #1); cattura ≤1; finestra serale/email ora da UI. Restano: completamento >2 tap, correzione classificazione a form-slider. |
| L2 | Zero vicoli ciechi | **B–** | = | Nessun vicolo cieco nei percorsi felici; ma: tab Focus senza task = "Vai a Today" (D51), "ho già fatto X" in review perso (N58), review interrotta persa (D45). |
| L3 | Automation-first | **C+** | ↑ (parziale) | Le 15 automazioni del 62 fatte; ma i due S1/S2 sono automazioni mancate (carryover, backlog), e la "giornata muta" perde mood/energy/review/apprendimento (§9.7). |
| L4 | Perdono | **B** | = | Resume onboarding ok, abbandono flussi ok; ma la review interrotta oltre finestra perde l'intake in silenzio (D45). |
| L5 | Rientro | **A–** | ↑ | 4gg e 15gg: zero shaming, mai conteggio giorni, rito abbreviato, un passo (J4/J4bis). Il punto più forte del prodotto. |
| L6 | Comprensione 10s | **B** | = | Schermate chiare; ma titoli tour EN, enum EN raw ("worker","personal"), "Focus" ambiguo (tab vs /focus). |
| L7 | Fiducia | **C** | ↓ | **Peggiorato**: famiglia claim-senza-tool (il modello dichiara azioni non fatte), consenso "0.2-draft" visibile, D46 promessa senza backing, drift guida-vs-app. |
| L8 | Carico conversazionale | **C+** | ↓ | Mood/energy 2×/giorno (N32), review più lunga del 62 (13 vs 8 turni), gergo esposto ("candidate","kept","tool"), leak "il sistema richiede". |
| L9 | Coerenza nomi/superfici | **C+** | = | "Oggi/Today", tab Focus vs /focus, "strict", "Piano bloccato" (ambiguo vs task bloccato), enum EN. |
| L10 | Economia attenzione | **B** | ↑ | Coordinatore 66B regge; ZERO interruzioni in-app durante focus. Buchi: toast+micro-feedback al completamento (N26), install banner solo /tasks (N29), email OS non conoscono lo stato focus (N61). |

**Lettura:** migliorati i criteri ad alta frequenza d'azione (L1/L5/L10); **peggiorati L7 e L8**
(fiducia e carico conversazionale) — ed è lì che il prodotto rischia di più con utenti veri.

---

## 4. Bug per severità (repro + evidenza + file:riga)

### S1 — blocca l'uso / perde dati

**S1-1 · Perdita silenziosa di task alla cattura in thread lungo** (J3, CONFERMATO 3 repro)
- *Repro:* thread general con ~15 catture consecutive (`collaudo68-caos`); 5 su 16 → "Creato il
  task."/"Creato senza scadenza." con `toolsExecuted=[]` e **0 righe DB** (titoli verificati assenti
  con grep sul dump). Alla contestazione: "è già stato creato nel turno precedente" (falso).
- *Radice:* il claim-guard fa fire ma la sua guidance (`claim-guard.ts:59-65`) offre un ramo di fuga
  ("se non serve azione, riscrivi senza affermare di averla fatta") che il modello imbocca allucinando
  pre-esistenza; retry singolo (cap costi) → task perso. Emerge sotto stress (thread lungo +
  rolling-summary + conferme vaghe); la cattura pulita con conferma esplicita regge 15/15.
- *File:* `src/lib/chat/orchestrator.ts` (loop tool + fallback 8b) + `src/lib/chat/claim-guard.ts:44-65`.
- *Evidenza:* `J3/trascrizione-catture-completa.md`, `retry-r1-results.json`, `state-catture.json`.

### S2 — rompe una promessa core / legale-sicurezza

| ID | Titolo | Repro/evidenza | File:riga |
|---|---|---|---|
| **S2-A** | **Famiglia claim-senza-tool in review/plan**: il modello dichiara "lo segno fatto / li rimando tutti / piano bloccato / pin tolto" senza eseguire tool; task/piano invariati. Il claim-guard non copre evening_review. Pervasiva (J6a/b/f/g/j/k, J2, J13). | Censimento 13 righe in `fase34/conversazionale-lingua.md §A.6` con trascrizioni per superficie | `orchestrator.ts:1009` (guard solo general/morning), `tools.ts:174-180`, `claim-guard.ts:44-52` |
| **S2-B** | **D45 — review interrotta persa in silenzio oltre finestra**: intake mood/energy (e gli outcome di triage, incl. un "completed") vivono solo nel `contextJson` archiviato, mai materializzati in una Review, mai riletti al mount successivo. | `J6/j6e2-d45-abbandono.json` + verifica live thread archiviato (Fase 5) | `normalize.ts:87-95`, `active-thread/route.ts:186-198` |
| **S2-C** | **D46 — "le altre due dopodomani" senza ripescaggio**: i task rimandati al plan preview sono solo filtro di stato (nessuna deadline/postpone/plan futuro/marker) e **è il prompt stesso a far dire la formula** al modello → promessa strutturalmente vuota. | `J6/j6j-db-finale.json` + `j6j-20-verdict.json` (LLM reale) | `update-plan-preview-handler.ts:117-131`, `close-review.ts:119-125`, **`prompts.ts:1239-1241`** |
| **S2-D** | **Shame-day: carryover dei falliti di ieri IMPOSSIBILE**: la review è cieca al DailyPlan di ieri; i 5 planned falliti non sono candidate (nessun ramo in `pickReason`), `avoidanceCount` bumpato solo dalla review legacy → restano fuori per sempre; il piano di domani chiude a 0-1 voci. | `J6/j6k-db-finale.json` + repro deterministico (Fase 5) | `triage.ts:107-126` (pickReason), `review/route.ts:148` |
| **S2-E** | **Review sotto carico riempie invece di ridurre**: 12 candidate con energia dichiarata 2, presentate come "mi sembra equilibrato"; `energyEnd` non entra MAI nel sizing del piano (`getFillRatio` ignora l'energia). | `J13/j13-40-plan-detail.md` + trascrizione ("equilibrato") | `config.ts:24` (cap 12), `plan-preview.ts:136` (fill-ratio senza energia) |
| **S2-F** | **J13 backlog urgente escluso dalla review** (ridimensionato da S1): 15 planned do_now urgenti senza deadline non entrano mai nel triage né nel piano di domani (spec-conforme, ma comportamentalmente il pitch "riduci il carico" fallisce sotto overwhelm). I task restano visibili in Today (non è data-loss). | `J13/j13-50-repro-selectcandidates.md` (deterministico 2/2) | `triage.ts:107-139` |
| **S2-G** | **Loop di apprendimento cieco** (N5/N6/N7): completare via chat/body-double/triage non emette `task_completed` (solo la UI lo fa) → whatDone vuoto + calibrazione sottostimata; i segnali server-side restano `processed=false`; il piano engine ignora il profilo (`prioritizeTaskAdaptive` dead code). | `fase2/f2-learning-report.md`, `f2-n5-chat-complete.json`; J11 (body doubling 0 signal) | `tools.ts:1321/1937`, `learning-signals-today.ts:43`, `daily-plan/route.ts:91`, `priority-engine.ts:380` |
| **S2-H** | **N21 — bypass sessioni pre-reset su guard admin/beta**: dopo reset password, il vecchio cookie è respinto da requireSession ma passa su `/api/admin/*` e `PATCH /api/beta/assessment`. | `J10/n21-admin-guard-bypass.json` (Fase 5 confermato) | `admin-guard.ts:53-102` |
| **S2-I** | **N19 — POST /api/notifications con `type` libero sopprime il promemoria serale del cron**: un client autenticato scrive `type='evening_review_prompt'` (= PROMPT_TYPE del dedup) e devia il proprio invio email nel ramo skip. | `fase2/n19-notif-dedup.txt` (2 repro) | `notifications/route.ts:61`, `cron/evening-review/route.ts:75-84` |
| **S2-J** | **N50b — GET /api/memory e /api/learning-signal: 500 non tracciato** su `?limit=abc` (NaN→Prisma throw, nessun try/catch → fuori telemetria). | `fase2/n50b-daily-plan-500.txt` | `memory/route.ts:12-33`, `learning-signal/route.ts:16-28` |
| **S2-K** | **J9 — 500 su allegato base64 corrotto**: `validateAttachments` non valida la decodificabilità → 500 "Errore interno" (viola il criterio "input invalidi → 4xx MAI 500"); anche body non-JSON → 500. | `J9/j9-20-repro-500.md` (4/4) | `chat/turn/route.ts:67-103, 248-252` |
| **S2-L** | **D47 — unpin impossibile + il modello dichiara il falso**: "pin tolto" ma il pin resta nel piano committato; lo schema del tool è union-only (nessun unpin) e il prompt prescrive di *dire* che in V1 non si toglie. | `J6/j6a-walk-log.txt` (turno 11) + `j6a-db-finale.json` | `update-plan-preview-tool.ts:19-28,143`, `prompts.ts:1146-1147` |
| **S2-M** | **N22/D66 — Export GDPR beta-only in UI**: diritto art.20 di tutti, ma la card è `isBetaTester`-only; per il non-beta solo via `/api/export` a mano. | `J10` (nonbeta export 200 via API) | `page.tsx:3956-3957` |
| **S2-N** | **D15 — "benissimo" rifiutato in silenzio**: la mappa mood non ha "benissimo"; l'intake degrada a 5 turni, il modello si ancora al valore inventato e leaka "il sistema richiede che tu mi dia il numero". | `J6/j6a-trascrizione-review-felice.md` (turni 2-5) | `mood-energy-parse.ts:28-39` |
| **S2-O** | **Consenso "bozza 0.2-draft" visibile** (legale): footer utente + `CONSENT_VERSION='0.2-draft'`. Pre-rilascio per un'app art.9. | browser J1 + `ConsentView.tsx:171` | `ConsentView.tsx`, `api/consent/route.ts:19` |

### S3 — fastidio / difetto minore (selezione; elenco completo in Appendice A)

- **D18** morning check-in soppresso tutto il giorno da un thread general aperto dopo mezzanotte (`bootstrap/route.ts:41-55`).
- **N24** `PATCH /api/strict-mode` accetta status arbitrario → sessione orfana invisibile alla GET.
- **N25** `POST /api/streaks` non-numerico → 500 (nessuna validazione input).
- **N13** fasce orarie a 3 orologi (ai-assistant UTC vs execution-engine Roma vs client): in prod la sera lo slot ai-assistant slitta (mascherato in dev).
- **N16** PATCH status=completed senza completedAt → sfugge a calibrazione/viste.
- **D25** ricorrente non completata ieri si **duplica** invece di carryover (J7).
- **D22** DELETE task nel piano → id orfano nei JSON (Top 3 → Top 2).
- **D9/D24** uscita friction lascia il task `planned` (mai `in_progress` in DB) e non emette segnale positivo → `strictModeEffectiveness` può solo peggiorare (browser J8).
- **N33** onboarding→profilo: logica inline diverge da `initializeProfileFromOnboarding` (dead code).
- **D40** due voci "Oggi" indistinguibili in sidebar durante la review.
- **D-auth** doppia fonte di verità client: `localStorage['shadow-user']` non pulito al signout → Settings può mostrare un'identità diversa da quella loggata (verificato in browser: cookie=tipo, Account=vergine).
- **J11 body doubling** "Ho finito" auto-completa TUTTO il task e i sotto-step a prescindere dal lavoro reale; sul task senza step il summary è spoglio ("0 minuti") pur completandolo (D20).
- **J3 nome-giorno** deadline da "venerdì/giovedì" sbagliate in modo **stocastico** (offset osservati 0/+1/−1/−5), non deterministico: inaffidabilità LLM sui nomi-giorno (ridimensionato da S2).
- **N46** errori grezzi: "HTTP 500" nei banner consent/onboarding, toast "Qualcosa e' andato storto (500)", `error.message` tecnico in chat.
- **N9** get_today_tasks take 15 senza `total` → il modello dichiara un carico falso ("Hai 15 cose" con 55 in DB) — già-noto/UX.

**Note sicurezza declassate/fuori scope:** **N60** (calendar/oauth/callback senza state anti-CSRF)
è un difetto reale ma su **superficie orfana fuori dal perimetro di rilascio** (calendar v3,
GOOGLE_CLIENT_ID assente, zero entry-point UI) → **ridimensionato a nota/debito da chiudere PRIMA di
attivare l'integrazione calendar**. **N55** (bug-report non beta-gated) è probabilmente by-design.

---

## 5. Finding UX ordinati per impatto × frequenza / effort — Top-10

Scala: **R3** = avvelena il core loop quotidiano o il primo giorno; **R2** = degrada un momento
ricorrente (review, rientro) o rompe fiducia; **R1** = fastidio su percorso raro. Freq: ogni-sessione
/ giornaliera / settimanale / rara.

| # | Finding | Impatto | Freq | Effort | Perché in alto |
|---|---|:---:|---|:---:|---|
| 1 | Claim-senza-tool nella review (S2-A) | R3 | ogni-sessione | S | Rompe la fiducia su ogni serata; fix = estendere il claim-guard |
| 2 | Review non riusa mood/energia del mattino (N32) | R2 | giornaliera | S | Doppio rito identico 2×/giorno, il grosso del carico *aggiunto* |
| 3 | Carryover falliti di ieri impossibile (S2-D) | R3 | giornaliera | M | Lo shame-day è il momento ADHD più delicato; oggi i falliti svaniscono |
| 4 | Review riempie invece di ridurre sotto carico (S2-E/F) | R3 | giornaliera | M | Fallimento diretto del pitch "riduci il carico" |
| 5 | Nav chat↔tasks full reload (N28b) | R2 | ogni-sessione | M | ~3–5s per il giro più frequente su WebView |
| 6 | Ponte Cielo assente (M-1) | R2 | giornaliera | S | Unico anello di ricompensa disaccoppiato dall'azione |
| 7 | Intake mood fragile — "benissimo"/"3 o 4" rifiutati (D15) | R2 | giornaliera | S | Degrada l'apertura di ogni review + leak di meccanica |
| 8 | Toast+micro-feedback insieme al completamento (N26) | R1 | ogni-sessione | S | Due celebrazioni sovrapposte, viola "una alla volta" |
| 9 | Empty-state Today chiede invece di generare (N36) + install banner solo /tasks (N29) | R2 | giornaliera/retention | S | Punti di attrito su generazione piano e installazione PWA |
| 10 | Enum EN raw + gergo esposto (N38/N37/A.4) | R1 | ogni-sessione | S | "worker","personal","candidate","kept","tool" nel parlato utente |

Tabella tap-budget completa (17 azioni, misurate) e il resto in `fase34/tap-budget-automazioni.md`
e `fase34/conversazionale-lingua.md`.

---

## 6. Cose di troppo — RIMUOVI / COLLEGA / UNIFICA (Fase 4)

**Prima del rilascio:**
1. **COLLEGA** ponte Cielo (completamento ricorrente → mostra/naviga il Cielo) — S.
2. **COLLEGA** chat↔tasks senza reload (rendering già co-locato) — M.
3. **RIMUOVI** `/chat` (doppione inferiore di `/`, senza idratazione sessione né stash share) o redirect 308 — S.
4. **UNIFICA il naming** tab "Focus" (strict) vs rotta `/focus` (body doubling): due esperienze, stesso nome — S.
5. **COLLEGA** card Ricorrenti (Settings) → chat con `/?draft=` come già fa il Cielo (N49) — S.

**Post-rilascio (pulizia, riduce superficie/rischio):** RIMUOVI `POST /api/review` legacy scrivente
(N56); route orfane `streaks`/`patterns`/`contacts`; tabelle `Streak`/`UserPattern` stantie (D-3);
dead code engine `prioritizeTaskAdaptive`/`selectTaskForNow`/`adaptiveDetectExecutionMode` **oppure
COLLEGA** al piano (O-3); `next-intl` inusato; config micro-feedback `decomp_preference` mai
triggerato; **COLLEGA** `/api/memory` a un job di consolidamento (memory-engine dormiente); UNIFICA
la logica profilo-onboarding su `initializeProfileFromOnboarding`. Dettagli con file:riga in
`fase34/coerenza-architettura.md`.

---

## 7. Registro automazioni (formula valore) + Top 5 pre-rilascio

Formula: `frequenza (v/sett) × attrito eliminato (tap+decisioni) / effort (S=1,M=2,L=3)`. Registro
completo (A1-A28, 34 semi del 62 estratti + i nuovi) in `fase34/tap-budget-automazioni.md`.

**Top 5 pre-rilascio (motivate dalla formula):**
1. **A1 — Carryover automatico dei falliti di ieri in review** (valore 17.5, M) — è S2-D, ogni serata.
2. **A2 — Selezione candidate: includere il backlog urgente, escludere il rumore** (17.5, M) — è S2-F.
3. **A16 — Claim-guard esteso a review/plan** (7, S) — è S2-A, rapporto valore/effort altissimo.
4. **A3+A6 — Auto-classify batch + riuso mood mattutino** (14 ciascuna, S) — eliminano il tap "Classifica" e il doppio rito N32.
5. **A9+A10 — Emettere e processare `task_completed`/segnali server-side** (7, M) — sblocca il pitch "più lo usi più si adatta" (S2-G).

**Menzioni d'onore non-formula (obbligatorie):** A8 (bypass admin/beta N21 — sicurezza), A19 (export
GDPR per tutti N22 — legale), A27 (backoff email inattività N61 — retention).

---

## 8. Quick win (≤1h ciascuno)

- Rimuovere la costante morta `CACHE_NAME='shadow-v2'` nel SW (N53 — l'aggiornamento bundle già funziona via v10).
- Aggiungere `total`/`hasMore` al result di `get_today_tasks` (N9 — il modello smette di dichiarare "Hai 15 cose").
- Aggiungere "benissimo"/"malissimo"/"3 o 4" alla mappa mood (D15).
- Sostituire "HTTP 500"/apostrofi (`e'`,`finche'`) con copy italiano corretto nei banner/toast (N46).
- Deep-link `/?draft=` sulla card Ricorrenti (N49).
- Validare base64 in `validateAttachments` → 400 invece di 500 (S2-K, parte).
- Pulire `localStorage['shadow-user']` al signout (D-auth).
- Instradare il toast celebrativo nel coordinatore 66B (N26).
- QR "Attiva strict" → copy italiano senza gergo (N37).

---

## 9. Proposta di batch dei fix (decide Antonio)

- **Task 69 — Pre-rilascio S1+S2 (bloccante il GO).** S1-1 (perdita task cattura), S2-A (claim-guard
  review), S2-B/C/D (review data-loss/promessa), S2-E/F (review sotto carico), S2-G (learning loop),
  S2-H (N21 admin bypass), S2-M (export GDPR), S2-K (500 base64), + **igiene legale** (consenso 0.2 →
  versione finale, S2-O). È il pacchetto che sblocca il "GO".
- **Task 70 — UX pre-rilascio.** N32 (riuso mood), N28b (nav senza reload), ponte Cielo (M-1), N36/N29
  (empty-state/install banner), D15/N38/N37 (intake+lingua), N26 (toast), N49 (deep-link ricorrenti),
  D9/D24 (strict status/effectiveness), N9 (total). + quick-win §8.
- **Task 71 — Post-rilascio (pulizia + robustezza).** Rimozioni/dead-code §6, N13 (timezone a 3
  orologi), N24/N25/N50b (validazione API), N33 (unifica profilo-onboarding), N60 (state CSRF calendar
  *prima* di attivare l'integrazione v3), N61 (backoff email), D46-analogo overwhelm, body doubling
  "Ho finito" (auto-complete), N11 (troncatura share).

---

## 10. Metriche di prodotto misurate

| Metrica | 68 | vs 62 |
|---|---|---|
| (a) Tempo-al-primo-valore | ~30 interazioni / ~2 turni chat / ~45s attese LLM (J1) | ~= |
| (b) Interruzioni giornata tipo | max simultanee 2 (completamento: toast+micro-feedback); ZERO in-app durante focus | ↑ (coordinatore 66B nuovo) |
| (c) Durata review — normale | 13 turni / 137s (J6a) | ↓ (era ~8 turni) |
| (c) Durata review — sotto carico | 20 turni / ~249s, piano 12 voci (J13) | nuovo |
| (d) Carico obbligatorio/giorno | check-in 3 domande + mood/energy ×2 (N32) + review conversazionale | ↓ (rito più lungo e duplicato) |
| Coverage | 13 journey, 54 route/~84 handler, ~15 schermate, R1-R18, ~105 piste dossier | ≈ 62 |
| Spesa LLM (AiUsage) | ~$13–16 (parziale, cascade effimeri) | ≈ |
| Baseline | tsc 0 errori, **940/940 test**, build verde | ↑ (872→940 test) |
| Regressione meccanica | 30 probe: 28 verdi + 2 stantii (sw-v9 assert, probe-42 senza consenso) | — |

---

## 11. Appendici

### Appendice A — Esito puntuale del dossier §12 (~105 piste)

Consolidati completi con nota per pista in `fase1-consolidato.md` (§Esito piste) e nei raw
`fase1-workflow-raw.json` / `fase2-workflow-raw.json` / `fase34-workflow-raw.json` /
`fase5-verifica-raw.json`. **Sintesi degli esiti:**

- **R1-R18: tutte CONFERMATE** (i fix reggono; R1 con la riserva che non copre la review).
- **CONFERMATE** (difetto reale): D9, D15, D17, D18, D22, D24, D25, D28, D39, D40, D41, D45, D46,
  D47, D59, D60, D65, D-auth, N1, N5, N6, N7, N9, N11, N13, N14, N16, N18, N19, N21, N22, N24, N25,
  N26, N29, N32, N33, N38, N39, N45, N46, N47, N49, N50, N50b, N52 (scoring corretto), N55, N56,
  N57, N58, N61, N62, D-tz.
- **RIDIMENSIONATE:** J13-backlog (S1→S2, spec-conforme), J3 nome-giorno (S2→S3, stocastico non
  deterministico), N9 (S2→UX, già-noto), N53 (costante morta, non fallimento update), N60 (S2→nota,
  calendar orfano fuori scope).
- **SMENTITE:** D52 (fix 64: aria-label presente), N2 (chiusura d'ufficio NON scavalca le modifiche
  dell'utente, 2/2), N4 dinamica (commit non è nel toolset general — statica confermata, dinamica
  non riproducibile), N12 (rolling summary funziona: fold sensato, merge preserva, idempotenza),
  N23 (export corretto: esclude token/password), idempotenza chiusura review (nessun doppione),
  decompose "fotocopia" (fallback pattern-aware, non identico).
- **NON RIPRODUCIBILE:** D16 (nessun turno con tool tutti-falliti hard nel journey).
- **NON TESTATE (dichiarate):** N8 (nudge→task_started, logica client, da chiudere in journey UI),
  N17 (stati active/abandoned — nell'enum, senza produttori, demandato allo sweep), la verifica
  browser piena di J12 (SW register/install → Appendice B on-device).

### Appendice B — Checklist on-device per Antonio (NON collaudabile in web)

> ⚠️ **AVVERTENZA PROD.** `capacitor.config.ts:12-22` punta la WebView nativa a
> `https://shadow-app2.vercel.app` → **qualunque prova on-device scrive sul DB di PRODUZIONE
> (purple-paper)**. Creare in prod **un utente di prova dedicato** e usare SOLO quello; MAI
> utenti reali, MAI probe automatici sul device.

Da verificare su telefono (con l'utente di prova prod):
- [ ] **Scudo strict reale**: le app in `blockedApps` sono davvero bloccate (non solo UI); dialog permessi + riga batteria (D19).
- [ ] **Tasto Indietro hardware** durante strict (non salta la friction), durante la review, e con `?view=` in history (interazione con popstate 66A + `native-bootstrap.tsx:19-26`, N54).
- [ ] **Share target Android reale**: condividere testo da un'altra app → task creato + banner "salvato" (con sessione valida) / login round-trip + testo precompilato (con sessione scaduta, R18); testo >500 char (N11).
- [ ] **Banner install PWA** su mobile (⚠️ oggi appare solo su /tasks, non nella chat che è la home — N29).
- [ ] **Notifica/email serale** su telefono (dominio Resend + CRON_SECRET in prod); che NON arrivi durante una sessione strict/body-double (N61 + assenza guardia focus nel cron).
- [ ] **Riavvio sessione** dopo grant permessi; **pausa/kill dell'app** durante strict e body doubling (recovery della sessione; il body doubling è client-only, nessun `BodyDoubleSession` server).
- [ ] **Avatar 3D** carica pulito (in dev una texture del VRM falliva — `GLTFMToonMaterialParamsAssignHelper`); fallback 2D senza WebGL; TTS ElevenLabs vs `speechSynthesis`.
- [ ] **Registrazione/aggiornamento SW** su PWA installata (i bundle si aggiornano davvero: verificato a codice che l'activate purga le cache non-v10).

### Appendice C — Igiene pre-rilascio non-codice

- **CONSENT_VERSION `0.2-draft`** → versione legale finale + rimuovere "bozza" dal footer (C1/C2, S2-O).
- **Guida da riallineare** (drift verificato): cap. 8 descrive la sezione "Review" rimossa dal 63
  (N40); uscita strict 3 step vs 4 reali (N42); pausa body doubling che "ferma" (in realtà il timer
  continua, e l'app lo dichiara onestamente — il drift è della guida, N43); onboarding-concept "zero
  attrito / salta sempre" vs 6+12 step obbligatori (N41); terminologia EN vs IT (N44).
  `/account-deletion` cita "accesso con Google" inesistente + card Export che i non-beta non hanno (N22).
- **Env prod**: `CRON_SECRET`, `BETA_TESTERS`, dominio **Resend**/`EVENING_EMAIL_FROM`, DSN Sentry.
- **Verificare `[migrate-on-deploy]`** al primo deploy prod: la migration `user_password_changed_at`
  deve applicarsi a **purple-paper** (in locale la guardia `VERCEL_ENV≠production` la salta
  correttamente — verificato al build del collaudo).
- **i18n EN**: `messages/{it,en}.json` NON esiste, `next-intl` installato e inusato → l'app è
  solo-italiano by-fact (stato di fatto vs regola 7 di CLAUDE.md).

---

## 12. Utenti di test lasciati vivi (per la QA manuale di Antonio)

La coorte `collaudo68-*@probe.local` (password **`Collaudo68!pass`**) resta sul DB dev royal-feather
per la QA manuale — ~20 ruoli: `-vergine` (registrato in J1), `-tipo`, `-caos`, `-rientro`,
`-fantasma`, `-procrastinatore`, `-review-a…k`, `-sommerso`, `-ricorrenti`, `-strict`, `-body`,
`-pwa`, `-errori`, `-beta`, `-admin`, `-nonbeta`, `-apprendista`. I 12 utenti `collaudo-*` del 62
sono **intatti** (non riusati). Gli utenti effimeri dei probe (`*-f2*`, `*-j*-avverso`, `*-verify-*`)
sono stati auto-cancellati. Cleanup della coorte 68 quando Antonio ha finito la QA:
`bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/seed-cohort.ts --cleanup`.

---

*Report generato dalla sessione di collaudo 68. Evidenze, script e trascrizioni in
`docs/tasks/68-evidenze/` e `scripts/e2e/collaudo-68/`. Nessuna modifica al codice dell'app.*
