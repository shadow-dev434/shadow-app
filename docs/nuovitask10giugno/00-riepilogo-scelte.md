# Nuovi task — riepilogo scelte (sessione 2026-06-10/11)

> Documento riepilogativo delle decisioni prese nella sessione di analisi
> pre-beta del 10-11 giugno 2026: analisi completa dello stato dell'app,
> verifica di 2 bug UX segnalati da Antonio, diagnosi latenza chat, analisi
> grafica con proposte. Tutte le affermazioni sono state verificate a
> sorgente nella sessione (citazioni `file:riga` controllate a HEAD
> `6eccbcc`).
>
> Questo file è l'**indice delle decisioni**, non una spec: le spec
> operative dei singoli task nascono come file separati (in questa cartella
> per i task nuovi; `docs/tasks/04-pre-beta-hardening.md` resta al path già
> previsto dalla guida beta).
>
> Convenzione: ✅ chiuso · ⚠️ parziale · ⏳ non iniziato.

---

## 0. Stato verificato di partenza

Sintesi della verifica (10-11 giugno). I documenti di pianificazione
(`STATE.md`, `ROADMAP.md`) sono **indietro rispetto a HEAD**: la realtà del
repo è più avanti di quanto dichiarino.

| Area | Stato | Evidenza |
|---|---|---|
| Track 1 — cuore conversazionale (6c, Bug #3, 8a, 8b, 8c, Bolletta V1.2.4, caching) | ✅ COMPLETO | Bug #3 server-side in `src/lib/evening-review/dates.ts` (`formatDeadlineLabel`); caching `cache_control` in `src/lib/llm/client.ts:219`; 8c campagna 47/47; Bug #7 chiuso MORTO (10/10) |
| Typecheck a HEAD | ✅ pulito (exit 0) | `ignoreBuildErrors` RIMOSSO da `next.config.ts` |
| Track 3 — GDPR a sorgente | ✅ (legale ⏳) | consent gate Art. 9 (`versione '0.2-draft'`), DELETE /api/account cascade, export, retention dry-run, /privacy /terms /account-deletion |
| Track 2 — hardening | ⏳ **A ZERO** | zero rate limiting (registrazione e AI), zero Sentry, password ≥6 char |
| Track 4 — infra | ⚠️ | SW hand-rolled (decisione 3.7 de facto presa dal TWA, mai formalizzata); no `.gitattributes`; no pre-commit gate; Vercel 4 progetti; backup Neon ⏳ |
| Track 5 — kickoff automatico review | ⚠️ | card + click; auto-start assente. Vincolo F7: ogni trigger DEVE passare `threadId=null` |
| Harness E2E | ⚠️ quasi pronto | `scripts/e2e/driver.ts` + `campaign.ts` + scorer esistono; manca wiring `package.json` (`e2e:*`, `seed:*`) |
| Igiene repo | ⚠️ | doc chiave untracked (guida beta, STATE.md, bug7, TWA runbook), `.gitignore` modificato non committato |
| Push/deploy | ✅ | main = origin/main, ultimo push 2026-06-10 16:01 |

---

## 1. Decisioni prese

### D1 — Piano a fasi verso la beta (conferma dei 5 track + sequenza)

| Fase | Contenuto | Sforzo | Gate |
|---|---|---|---|
| **0 — Igiene e verità documentale** | commit `.gitignore`; sorte git degli untracked; aggiornare STATE/ROADMAP; registrare esito V1.2.4 nel changelog del prereg; `.gitattributes` (`* text=auto eol=lf`) | ½-1 g | `git status` pulito, typecheck verde, STATE coerente con HEAD |
| **1 — Hardening (Track 2)** | PRIMA la spec `docs/tasks/04-pre-beta-hardening.md` ratificata, POI: rate limiting registrazione (3/IP/g) + AI (quota/utente/g), password ≥8, Sentry, UptimeRobot, doc test isolamento; + fix deterministici: morning check-in UTC→Rome (`src/app/api/chat/bootstrap/route.ts:146`), `userId` da NextAuth invece che Zustand | ~1 sett | build verde, test manuali spec, **zero modifiche a prompt/orchestrator** |
| **2 — Kickoff automatico (Track 5) + wiring harness** | design breve con F7 (`threadId=null`) revisionato prima del codice; mini-campagna E2E pre-registrata (3-4 celle); script `e2e:*`/`seed:*` in package.json | 2-4 g | campagna a soglia; non-regressione aperture 8a/8b/8c (precedenza crisi > scarico/burnout > re-entry) |
| **3 — Infra (Track 4)** | consolidamento Vercel; procedura `migrate deploy` documentata; backup Neon Pro PRIMA dei tester; formalizzare 3.7 (SW hand-rolled resta per beta v1, @serwist post-beta); build cross-platform (`fs.cpSync`); pre-commit gate tsc | 2-3 g + esterni | — |
| **4 — GDPR finale** | consulenza legale (AVVIARE SUBITO, lead time lungo); consent `0.2-draft` → v1.0 + strategia re-consent; retention da dry-run a runbook | parallela | — |
| **5 — TWA closed testing** | (Giulio) step 8-9 runbook `22-twa-packaging.md`: verifica barra URL, track, scheda store + Data safety | parallela | — |
| **6 — Beta readiness gate** | checklist finale; monitoraggio trigger di sorveglianza su `payloadJson` (Bug #7 override, 8b crisi, 8c re-entry); guida tester + canale feedback; go/no-go con primo gruppo 5-10 | 2-3 g | tutti i gate 1-5 verdi |

**Rimandati consapevolmente a durante/dopo la beta:** history pruning (il
caching ha tolto l'argomento costo; V1.3.2 contiene il comportamento;
toccarlo ora invaliderebbe cache + campagne 8a/8b/8c), Slice 9, mossa D 8b,
walk-scarico, `Settings.timezone` (al primo utente non-Rome).

### D2 — Fase UX parallela (decisa l'11 giugno, motivata da retention)

| Task | Contenuto | Sforzo | Rischio |
|---|---|---|---|
| **UX-1** | Chat come prima voce della BottomNav (+ `router.push('/')` al posto di `window.location.href`); `devIndicators: false`; `whitespace-pre-wrap` sulle bolle; `export const maxDuration` sulla route turn | ~½ g | zero |
| **UX-2** | Latenza Stadio A (indicatore di stato a fasi al posto dei 3 puntini; fix doppio fetch AdaptiveProfile; cap fetch task) + brand Livello 1 (token palette sito, gradient signature, glow accenti, avatar S, timestamp, EveningReviewCard ridisegnata) | 1-2 g | zero (UI + DB read-path) |
| **UX-3** | **Streaming SSE** — cambio di *trasporto*, non di comportamento: stessi prompt/tool, stesso `payloadJson` persistito. Tocca `orchestrator.ts` → design-doc prima del codice + regression smoke con harness (probe-8a/8b) come gate | 2-3 g | medio (file sensibile) |
| **UX-4** | Motion Livello 2 (framer-motion già installata, 0 import oggi: entrata messaggi, orb "thinking" con glow, stagger quick replies, tab pill animata, card tool per la review) + intro Livello 3 (particle brain in **canvas 2D custom ~3-5KB**, NO Three.js nel bundle; once-per-session, skip, reduced-motion off) | 2-3 g | basso |

Vincoli ADHD-aware fissati: motion ≤300ms, niente loop infiniti nel campo
visivo durante la lettura, niente parallax, glow solo sugli accenti mai sul
contenuto, `prefers-reduced-motion` rispettato ovunque.

### D3 — Bug navigazione chat: CONFERMATO, fix scelto

La `BottomNav` (`src/app/tasks/page.tsx:1823`) ha 5 tab senza Chat; l'unico
ritorno è il bottone header (`:1769`) condizionato a
`!isExecuting && currentView !== 'task' && currentView !== 'eisenhower'` —
nei 3 stati esclusi l'utente è intrappolato. **Fix: Chat sempre presente
come prima tab della BottomNav**, navigazione client-side. (= UX-1)

### D4 — Icona "N" in basso a sinistra: NON è un bug dell'app

È il **dev indicator di Next.js 16** (solo `bun run dev`; nessun elemento
custom nel codice; `devIndicators` non configurato). I beta tester NON la
vedranno. Si spegne comunque anche in dev con `devIndicators: false`. (= UX-1)

### D5 — Latenza chat: diagnosi e strategia a due stadi

Cause verificate: **zero streaming** (`messages.create` senza stream,
`client.ts:230`; route JSON monolitico; client `await res.json()`), loop
tool **sequenziale fino a 8 chiamate LLM/turno** (`orchestrator.ts:90,482`),
Sonnet 4.6 sulle modalità strutturate, fetch task non limitato al primo
turno review, `AdaptiveProfile` fetchato 2 volte, `maxDuration` assente.
Telemetria già disponibile: `TurnResponse.latencyMs`.

**Strategia:** Stadio A percettivo subito (UX-2), Stadio B streaming SSE
(UX-3) come upgrade UX principale pre-beta. Lo streaming è trasporto-only:
le campagne 8a/8b/8c restano valide, ma serve regression smoke perché si
tocca l'orchestrator.

### D6 — Direzione grafica: portare il design system del sito dentro l'app

L'app oggi: tema shadcn default mai personalizzato (`globals.css`
monocromo), ambra Tailwind generico ≠ ambra brand, **zero animazioni**
(framer-motion installata, 0 import), bolle flat senza avatar/timestamp,
a-capo collassati (manca `whitespace-pre-wrap`), `ToolExecutionCard` solo
per 2 tool su tutti, `EveningReviewCard` anonima.

Il riferimento è il prototipo sito (`cowork/site-prototype`): palette
`#E8911E / #F4A93C / #F7C873 / #B5651D` su `#0A0A0B`, gradient signature
`135deg oro→ambra→rame`, glow ambra, particle brain Three.js (caos→cervello),
intro skippabile once-per-session. Decisione: **adottare quel linguaggio
nell'app a 3 livelli** (token CSS → micro-motion → intro), senza portare
Three.js nel bundle (canvas 2D custom per l'intro).

### D7 — Disciplina invariata

Spec/design prima del codice; gate pre-registrati; commit atomici, NO push
automatico; revisione preventiva per tutto ciò che tocca il flusso
conversazionale; `prompts.ts`/`orchestrator.ts` friction-strict (modifiche
solo con campagna/regression); `bun run test`, mai `bun test`.

---

## 2. Strategia anti-collisione per lavoro in parallelo

Decisa per gestire più task contemporanei senza incroci. Dettagli operativi
nella sezione finale; regole vincolanti:

1. **Git worktree per lane, massimo 2 lane attive** + il tronco:
   - `C:\shadow-app` = tronco: SOLO merge, build di verifica, campagne E2E.
   - `C:\shadow-wt\ux` (branch `task/ux`) = lane UX (UX-1→UX-4, sequenziali
     tra loro).
   - `C:\shadow-wt\hardening` (branch `task/hardening`) = lane hardening
     (Fase 1) e doc/infra.
2. **Mappa di proprietà dei file (hotspot):**
   - `ChatView.tsx`, `globals.css`, `orchestrator.ts`, `client.ts`,
     `chat/turn/route.ts` → SOLO lane UX.
   - `api/auth/register`, nuova lib rate-limit, Sentry config,
     `bootstrap/route.ts` → SOLO lane hardening.
   - `src/app/tasks/page.tsx` è conteso (UX-1 BottomNav + hardening userId):
     **UX-1 si fa per prima e si merge subito** (½ giornata), poi la lane
     hardening riparte da main aggiornato.
   - `docs/`, `.gitattributes`, `.gitignore` → Fase 0, direttamente sul
     tronco, prima di aprire le lane.
3. **Branch corti, merge frequenti**: un task = un branch = pochi commit =
   merge in main appena verde. Rebase su main prima di iniziare e prima di
   mergiare. Mai due lane sullo stesso hotspot nello stesso momento.
4. **Gate di merge**: typecheck + `bun run build` + suite vitest nel
   worktree; ri-build sul tronco dopo merge. Il pre-commit gate tsc
   (pianificato in Fase 3) viene **anticipato a Fase 0**: protegge proprio
   i merge paralleli.
5. **`.gitattributes` PRIMA di aprire le lane** — senza, il churn CRLF/LF
   già visto (+20k righe fantasma) inquina ogni merge.
6. **DB condiviso (Neon main)**: i dev server delle lane puntano allo stesso
   DB → un solo dev server attivo di default (la lane che ne ha bisogno);
   se servono due: `PORT=3001` nella seconda. Campagne E2E SOLO dal tronco,
   una alla volta. Nessun task pianificato tocca `schema.prisma`; se uno
   dovesse, diventa esclusivo (zero parallelismo durante una migration).
7. **Ogni worktree è autosufficiente**: copia di `.env.local` (gitignored,
   non viaggia col worktree), `bun install`, `bun x prisma generate` propri.
   Bonus Windows: node_modules separati = niente EPERM incrociato tra lane.
8. **Una sessione Claude Code per worktree** (contesto isolato, CLAUDE.md
   condiviso via repo). In alternativa le sessioni spawnate da Claude Code
   Desktop creano già worktree isolati in automatico.

---

## 3. Decisioni ancora aperte (da sciogliere con Antonio)

1. **Dimensionamento rate limit AI** (proposta: derivare dal costo/sessione
   post-caching; es. 2 review/g + N turni general per tester).
2. **Sorte git degli untracked** (proposta: committare doc + tooling probe,
   escludere `.out`/log/json di run) — è la "sorte git = R6" rimandata nei
   doc Bug #7.
3. **Versione consent finale** e strategia re-consent per account esistenti.
4. **Dimensione primo gruppo tester** (proposta: 5-10 prima dei 20-100).
5. **History pruning**: confermata la collocazione "durante la beta" (D1).

---

## 4. Riferimenti

- Analisi completa e verifiche: sessione Claude Code 2026-06-10/11.
- Master plan beta: `docs/tasks/SHADOW-guida-beta-v1.md` (§2 i 5 track).
- Stato slice: `docs/tasks/05-slices.md` · snapshot: `cowork/STATE.md`
  (da aggiornare in Fase 0).
- TWA: `docs/tasks/22-twa-packaging.md`.
- Chiusure recenti: `docs/tasks/12-bug7-chiusura.md` (Bug #7),
  `docs/tasks/2x-slice-8*.md` (8a/8b/8c).
- Design di riferimento: `cowork/site-prototype/` (palette in
  `assets/styles.css:4-5`, intro/particle brain in `assets/app.js`).

---

*Aggiornare questo file quando una decisione aperta (§3) viene sciolta o
una fase (§1/D1, D2) si chiude. Le spec operative nascono come file
separati, una per task, secondo il pattern di lavoro consolidato.*
