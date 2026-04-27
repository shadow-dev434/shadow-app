# Task 5 — Piano di slicing per la review serale

**Stato:** piano validato il 25 aprile 2026, dopo chiusura Slice 1.
**Scope:** scomposizione di Task 5 (review serale conversazionale) in slice incrementali.
**Audience:** Claude Code (per ogni sessione di lavoro su Task 5) + autore (riferimento).

---

## Convenzioni

- Le slice sono **sequenziali**: ogni slice dipende dalle precedenti. Non si saltano.
- Ogni slice produce un **deliverable osservabile** (testabile a mano o via test automatici).
- Ogni slice si chiude con uno o più commit puliti, conventional commits.
- Quando una slice tocca per la prima volta una decisione di Area 7 della spec, **chiude** quella decisione documentando la scelta.
- Il riferimento di prodotto è sempre `docs/tasks/05-review-serale-spec.md`. Questo file documenta solo l'**ordine di costruzione**, non le decisioni di prodotto.

---

## Stato attuale

**Slice 1 — Foundation** ✅ chiuso (commit `5cceea3`, 25 aprile 2026)
- Schema DB esteso: `Task.postponedCount`, `Task.source`, `DailyPlan.threadId/pinnedIds/originalPlanJson`, `Review.threadId`, `Settings.eveningWindowStart/End`, back-relation su `ChatThread`.
- Migration audited (`0_init` baseline + `add_evening_review_fields`).
- Workflow Prisma dev/prod separato.
- Config centrale in `src/lib/evening-review/config.ts` con 25 costanti calibrabili.
- Spec di prodotto versionata (`docs/tasks/05-review-serale-spec.md`).
- Deploy notes (`docs/tasks/05-deploy-notes.md`) con 5 issues pre-esistenti tracciate.

---

## Slice 2 — Trigger e finestra serale

**Stato:** ✅ chiuso (commit `e770d34`, 26 aprile 2026).

**Scope:**
- Helper `isInsideEveningWindow(now, settings)` che dice "siamo dentro la finestra dell'utente?".
- Estensione di `/api/chat/active-thread` (guard di Task 3): se utente apre Shadow dentro la finestra + nessuna `Review` per oggi + nessun thread `evening_review` aperto → segnala al client di avviare la review.
- Solo placeholder di apertura, nessun flow conversazionale vero.

**Decisioni spec coperte:** 1.1 (trigger principale), 1.2 (apertura fuori finestra).

**Out of scope:** logica salti (1.3, 1.4), conversazione vera, selezione perimetro.

**Deliverable osservabile:** test manuale — apro Shadow alle 21:00 con finestra 20:00-23:00 → vedo segnale "vuoi iniziare la review?". Apro alle 14:00 → vedo chat normale.

---

## Slice 3 — Lazy archive + pause

**Stato:** ✅ chiuso (commit `803a9fa`, 27 aprile 2026).

**Scope:**
- Quando l'utente apre Shadow fuori dalla finestra serale e c'è un `evening_review` orfano (in stato `paused` o `active` da prima), Shadow lo archivia automaticamente.
- Inattività ≥10 minuti dentro un thread review → transizione a `paused`.

**Decisioni spec coperte:** 5.1 (review interrotta).

**Decisioni Area 7 chiuse:** 7.5 (job schedulato per chiusura review abbandonate) → conferma scelta lazy check, niente cron.

**Razionale ordine:** va prima del flow conversazionale vero perché protegge il guard di Task 3 da thread orfani. Senza questa, gli slice successivi possono trovare stati inconsistenti.

**Deliverable osservabile:** apro un thread review alle 22:00, lo lascio paused, apro Shadow il giorno dopo alle 10:00 → il vecchio thread è archiviato, parte chat normale. Lascio una review aperta inattiva 11 minuti → va in `paused`.

---

## Slice 4 — Selezione del perimetro entry

**Scope:**
- Logica di triage: pesca dall'inbox le entry candidate per stasera (deadline ≤48h + nuove + carry-over).
- Apre la review con "ho N candidate stasera, ti va?".
- Accetta override conversazionale ("aggiungi quella", "togli quella").
- Nessuna decomposizione, nessuna decisione piano. Solo mostrare la lista.

**Decisioni spec coperte:** 2.1 (perimetro), 2.2 (rimandi — la lettura del contatore, non l'incremento).

**Deliverable osservabile:** apro una review con inbox pre-popolato → vedo la lista corretta delle candidate. Dico "togli la fattura" → la fattura sparisce dalla lista.

---

## Slice 5 — Conversazione per-entry

**Scope:**
- Variazione mossa apertura per `source × preferredPromptStyle` (Gmail/manual/carry-over × direct/gentle/challenge).
- Decomposizione opportunistica scatenata da: blocco esplicito dell'utente, o `postponedCount ≥ 3`.
- Riconoscimento frizione emotiva (3.3 → α): "sento che è pesante, la lasciamo?".
- Si ferma prima di costruire il piano.

**Decisioni spec coperte:** Area 3 completa (3.1, 3.2, 3.3).

**Decisioni Area 7 chiuse:** 7.7 (provenance del Task) — `Task.source` già aggiunto in Slice 1, qui si esercita.

**Out of scope:** override etico di registro (è in Slice 8 con 6.3).

**Deliverable osservabile:** review con 3 entry di tipi diversi → 3 aperture diverse. Dico "non so da dove iniziare" su un task → Shadow propone decomposizione. Dico "uffa lasciamo perdere" → Shadow nomina la pesantezza e offre uscita.

---

## Slice 6 — Piano del giorno dopo

**⚠️ Attenzione:** questa è la fetta più grossa del piano. Validato il 25 aprile che **va probabilmente spezzata in sotto-slice** quando ci si arriva. Proposta:

- **6a** — Stima durate (4.1) + fasce qualitative (4.2)
- **6b** — Taglio piano (4.4) + pinning (con stato in `ChatThread.contextJson`)
- **6c** — Buffer calibrato + floor/soffitto (4.5)
- **6d** — Suggerimenti energia (4.3) — eventualmente inline in 6a

**Quando Claude Code proporrà Slice 6 in un colpo, fermarsi e ridiscutere lo spezzamento.**

**Decisioni spec coperte:** Area 4 completa.

**Decisioni Area 7 chiuse:** 7.4 (stato user-pinned in `ChatThread.contextJson`) — qui si decide il formato JSON definitivo.

**Out of scope:** chiusura atomica e produzione artefatti (è Slice 7).

**Deliverable osservabile:** a fine review vedo un'**anteprima** del piano per domani con fasce, durate qualitative, taglio nominato, pin riconosciuti. Niente è ancora persistito su DB.

---

## Slice 7 — Mood intake + chiusura atomica

**Scope:**
- Mossa apertura mood/energy 1-5 (sotto-decisione consuntiva di Area 5, posizionata all'inizio della review).
- Chiusura atomica con transazione: `Review` + `DailyPlan` + `originalPlanJson` snapshot + thread `completed` + FK `threadId` su entrambi gli artefatti.

**Decisioni spec coperte:** 5.3 (chiusura atomica), sotto-decisione consuntiva di Area 5 (mood/energy intake).

**Decisioni Area 7 chiuse:** 7.1 (FK `threadId` su Review/DailyPlan — già nello schema, qui si esercita), 7.2 (`originalPlanJson` come campo JSON).

**Fine Slice 7 = flow base end-to-end funzionante, beta-shippable senza edge case ADHD.**

**Deliverable osservabile:** review completa dall'apertura alla chiusura → in DB trovo una `Review` con mood, un `DailyPlan` con i task, `originalPlanJson` popolato, thread in `completed`, FK linkate. Cancellando il `ChatThread` la `Review` e il `DailyPlan` sopravvivono con `threadId = null` (`SetNull`).

---

## Slice 8 — Edge case ADHD

**⚠️ Disciplina richiesta.** Gli edge case di Area 6 toccano utenti vulnerabili. Validato il 25 aprile: **ogni sotto-slice di Slice 8 viene revisionata prima dell'implementazione** (riconoscimento semantico, falsi positivi/negativi, override di registro). Non è "Claude Code propone, tu approvi" — è "Claude Code propone, tu chiedi conferma all'autore prima di procedere".

**Spezzata in commit per case:**

- **8a — 6.1 burnout** ("non ce la faccio stasera"). Default A + eccezione condizionata.
- **8b — 6.3 spirale negativa** con override etico `gentle` (alta priorità etica). Mossa B + ascolto breve, no terapia improvvisata, no domande aperte.
- **8c — 6.4 rientro ≥14 giorni** (decisione: V1.1, vedi sotto).
- **6.2 (iper-motivato)** è già dentro Slice 6c col soffitto 85%, non serve sotto-slice dedicata.

**Decisioni spec coperte:** 6.1, 6.3 (parziale), 6.4.

**Decisioni Area 7 chiuse:** 7.6 (`LearningSignal.signalType: emotional_offload`).

---

## Slice 9 — Calibrazione learning

**Scope:**
- Nuovi `LearningSignal.signalType`: `task_postponed`, `emotional_offload`.
- Calibrazione del fill ratio dal rapporto reale "pianificato vs completato" (4.5).

**Last-mile.** Può girare anche durante la beta — non blocca lo ship.

---

## V1 beta vs V1.1

**Essenziali per beta** (senza queste la review serale non funziona davvero):

- Slice 2, 3, 4, 5, 6, 7 → flow completo end-to-end
- Slice 8a (6.1 burnout) → frequente in ADHD, "non ce la faccio stasera" è scenario quotidiano
- Slice 8b (6.3 spirale negativa con override `gentle`) → etico, non opzionale
- `originalPlanJson` snapshot frozen (già in Slice 7)

**Possono aspettare V1.1** (utili ma non bloccanti per i primi tester):

- Slice 8c (6.4 rientro ≥14 giorni) → tester nuovi non lo triggerano nei primi 30 giorni
- Mossa D condizionata di 6.3 ("vale la pena parlarne con qualcuno") → nuance fine
- Slice 9 calibrazione fill ratio via learning → beta usa default fisso, calibrazione vera richiede 2-3 settimane di signal comunque
- Visualizzazione `emotional_offload` in vista statistiche → la signal va scritta da subito (in Slice 8b), la UI può aspettare
- Pattern recognition fine per "intent forte di pin" → beta accetta solo "pinna questa" esplicito

**Minimo viable per beta:** Slice 2-7 + 8a + 8b. Slice 8c, 9, e parti V1.1 di 8b sono fattibili anche dopo che i tester sono dentro.

---

## Tre cose che NON sono in questo piano (e che vanno aggiunte come task paralleli)

Le 9 slice di Task 5 danno il **flow conversazionale** della review serale. Non danno la **beta spedibile**. Per arrivare a utenti veri servono task paralleli a Task 5:

- **Task X — PWA + mobile UX** (manifest, service worker, install prompt, safe-area iOS, font ≥16px, tap target 44×44).
- **Task Y — GDPR + privacy** (privacy policy, consent flow, export dati, cancellazione account, data retention).
- **Task Z — Limiti operativi** (history pruning chat lunghi, storage quotas Neon, rate limit, error monitoring, logging strutturato).

Non vanno fatti dentro Task 5. Ma vanno fatti **prima** della beta, in parallelo o subito dopo Slice 7.

---

## Issues pre-esistenti da chiudere prima della beta

Tracciate in `docs/tasks/05-deploy-notes.md`. Non urgenti per Slice 2, ma **da risolvere prima di Slice 8-9**:

- TS validation skipped da `next build`
- `src/app/tasks/page.tsx:2355` errore TS2367
- `bun run build` fallisce su Windows allo step `cp -r`
- Inconsistenza tra output `tsc` e exit code

Aprire un mini-task dedicato quando c'è un momento. Niente di drammatico, ma se trascinati fino alla beta diventano ansia.

---

## Pattern di lavoro su ogni slice

Replicato da Slice 1 perché ha funzionato:

1. **Briefing iniziale a Claude Code:** stato post-slice precedente + riferimento alla spec + richiesta di piano dettagliato in plan mode.
2. **Niente codice nella prima risposta.** Claude Code propone: file da toccare, helper da creare, logica in pseudocodice, cosa testerà.
3. **Allineamento con autore prima del codice.** Per slice complessi (5, 6, 7, 8): autore copia il piano in chat con assistente strategico per second opinion.
4. **Codice in piccoli incrementi.** Diff prima di applicare per decisioni strutturali (schema, FK, endpoint nuovi).
5. **Commit alla fine di ogni slice.** Niente "implementiamo Slice N e N+1 insieme che vanno veloci". Se Slice N ha un bug e ci hai costruito sopra Slice N+1, il debug raddoppia.
6. **Testabilità di ogni slice in isolamento.** Se una slice si chiude senza un modo per esercitarla a mano o via test, qualcosa è andato storto.
7. **Post-mortem se il debug è stato non-banale.** Skill `/post-mortem` disponibile in `.claude/skills/`.

---

*Documento di pianificazione. Aggiornare quando una slice si chiude (segnando ✅ + commit hash) o quando emerge una decisione che cambia l'ordine.*
