# CLAUDE.md — Shadow ADHD App

> Questo file è letto automaticamente da Claude Code a ogni sessione.
> Contiene il contesto permanente del progetto. Non contiene task:
> i task sono in `docs/ROADMAP.md` e nei file `docs/tasks/*.md`.
> Riscritto il 2026-06-11 (Workflow v2, ultraplan post-beta).

---

## Cos'è Shadow

App per adulti con ADHD. Core loop: inbox ovunque → chat come punto d'ingresso →
review serale conversazionale che produce il piano di domani. Feature:
- **Chat conversazionale** su Claude API (morning check-in, review serale, chat libera)
- **Review serale** (`evening_review`): triage inbox voce per voce, decomposizione,
  piano del giorno dopo (Slice 5-8 chiuse)
- **Profilazione adattiva** (`AdaptiveProfile`, 60+ dimensioni comportamentali)
- **Memoria rinforzata per-utente** (`UserMemory` con strength/evidence)
- **Priority/decomposition/nudge/learning engine** — euristiche deterministiche in-house
- **Strict mode** anti-distrazione con friction intenzionale
- In arrivo (**Shadow v3**, piano approvato 2026-06-11, spec `docs/tasks/30..39-v3-*.md`):
  **4 piani BASE/PLUS/PRO/MAX** con model router per tier (W2-W3), **app native
  iOS/Android via Capacitor** con strict mode che blocca davvero le app (W5-W6),
  **body doubling con avatar 3D** (W7, MAX — supera Task 27; voce in v1.1),
  **Google Calendar ingest** (W8, PRO — supera Task 26; Gmail fase 2),
  **bilinguismo it/en** (W4). Task 25 superato da W2. Cfr. supersessioni in ROADMAP.

Target deploy: web (Vercel) + Android TWA via Bubblewrap (closed testing, interim);
in v3: app native iOS + Android via **Capacitor** (stesso package — W5-M2 sostituisce la TWA).

---

## Stack

- **Next.js 16** (App Router) + React 19 + **TypeScript strict**
- **Prisma ORM** su **Postgres Neon** (branch `main`)
- **NextAuth v4** — login **solo CredentialsProvider** (email+password, JWT strategy).
  `GOOGLE_CLIENT_ID/SECRET` servono al flusso OAuth separato delle integrazioni
  (Task 26), NON al login.
- **LLM: Claude API** (`@anthropic-ai/sdk`) via `src/lib/llm/client.ts` —
  tier `fast` = `claude-haiku-4-5` (chat generale), tier `smart` = `claude-sonnet-4-6`
  (review serale). Prompt caching static/dynamic attivo, cost tracking per messaggio.
- **Engine euristici deterministici** in `src/lib/engines/` (GLM/Z.ai rimosso 2026-06-09)
- **Zustand** per state client (`src/store/shadow-store.ts`, senza persist)
- **Tailwind CSS** + **shadcn/ui** + Radix; **framer-motion** per animazioni
- **bun** come package manager e runtime dev; **vitest** per i test

## Struttura cartelle (aggiornata 2026-06-11)

```
src/
├── app/
│   ├── page.tsx                  ← 33 righe: monta ChatView (split completato)
│   ├── tasks/page.tsx            ← monolite residuo ~3100 righe (inbox, execution,
│   │                                strict mode, settings) — estrazioni minime
│   ├── api/                      ← ~27 route, tutte protette con requireSession
│   │   ├── chat/turn, chat/bootstrap, chat/active-thread
│   │   ├── tasks, daily-plan, review, strict-mode, settings, calendar, export, …
│   └── layout.tsx
├── features/
│   └── chat/ChatView.tsx         ← UI chat (~350 righe), POST /api/chat/turn sincrono
├── lib/
│   ├── auth.ts, auth-guard.ts    ← NextAuth config + requireSession
│   ├── llm/client.ts             ← callLLM (tier, caching, costi) — unico client LLM
│   ├── chat/
│   │   ├── orchestrator.ts       ← loop multi-iterazione (max 8) + tool execution
│   │   ├── prompts.ts            ← CORE_IDENTITY, mode prompt, voice profile, varianti
│   │   ├── tools.ts + tools/     ← tool LLM (flavor sideEffect/mutator/…) + gating per fase
│   ├── evening-review/           ← triage, plan-preview, slot-allocation, config
│   ├── engines/                  ← engine euristici (NON riscrivere, riusare)
│   └── types/shadow.ts
├── store/shadow-store.ts
├── components/ui/                ← shadcn, NON MODIFICARE
└── middleware.ts                 ← gate auth + tour/consent/onboarding (matcher esplicito!)
prisma/schema.prisma              ← User, Task, ChatThread/ChatMessage, AdaptiveProfile,
                                    StrictModeSession, DailyPlan, Review, UserMemory, …
scripts/                          ← script operativi bun + probe e2e (scripts/e2e/*)
```

Nota: ogni route nuova sotto `src/app/` va aggiunta al `matcher` di `middleware.ts`,
altrimenti il gate auth non gira.

## Stato attuale (11 giugno 2026)

- ✅ Produzione su Vercel: `https://shadow-app2.vercel.app/` (consolidamento 4 progetti = Task 3.6)
- ✅ Review serale conversazionale live (Slice 5-8: triage, varianti per source,
  plan preview, closing, burnout/scarico emotivo)
- ✅ Prompt caching V2b + cost tracking V2c
- 🔄 Beta in preparazione: Task 22 (TWA packaging, runbook pronto), Task 23 (BugOps)
- 🆕 Fase 4 post-beta pianificata (ultraplan 2026-06-11): task 24-27 in
  `docs/ROADMAP.md` + `docs/tasks/24..27-*.md`. Tag rollback: `pre-ultraplan-2026-06-11`.
- 🆕 **Shadow v3 approvato (sessione ultraplan v3, 2026-06-11)**: monetizzazione 4 tier,
  model router, Capacitor iOS/Android, bilinguismo. Spec in `docs/tasks/30..39-v3-*.md`
  (+ tabella e supersessioni in ROADMAP, Fase v3). W0 (checklist amministrativa,
  doc 30) in carico ad Antonio — più urgente: richiesta entitlement FamilyControls.

## Regole non negoziabili per Claude Code

1. **TypeScript strict** — zero `any` impliciti, tutti gli import devono risolvere
2. **Non riscrivere logica già corretta** — riusa engine, orchestrator, llm client
3. **Non introdurre dipendenze nuove** senza necessità esplicita documentata
   (Google/voce = REST via fetch, zero SDK vendor)
4. **Non toccare `src/components/ui/`** — componenti shadcn generati
5. **Ogni modifica deve compilare**: `bun run build` deve passare prima di dichiarare finito
6. **Commit atomici** con messaggi descrittivi in italiano (es. `fix(auth): isolate tasks by userId`)
7. **Testi utente bilingui it/en** (dal piano v3, W4): nelle viste già estratte
   niente stringhe hardcoded — chiavi next-intl in `messages/{it,en}.json`.
   I prompt LLM restano master in italiano con direttiva lingua + esempi
   localizzati (cfr. `docs/tasks/34-v3-w4-i18n.md`). Nelle viste non ancora
   estratte vale la regola precedente: testi in italiano.
8. **Se una scelta di design è ambigua**: se è una decisione di prodotto, chiedi ad
   Antonio con AskUserQuestion (opzioni + raccomandazione + trade-off); se è minore,
   scegli tu e annotala nel report. Mai inventare in silenzio su scelte di prodotto.
9. **Dentro un piano approvato in plan mode**: implementa end-to-end senza conferme
   intermedie, anche su file >500 righe. **Fuori da un piano approvato**: per file
   grandi o fuori scope, proponi prima il piano.
10. **Commit autonomi su feature branch** (`feature/NN-nome`) a build verde.
    Push del feature branch solo su conferma (serve per i preview deploy Vercel).
    **Push/merge su `main` decide solo Antonio** — il push verso main è anche
    bloccato hard dall'hook.

## Workflow v2 (dal 2026-06-11)

Contratto completo in `docs/tasks/24-workflow-v2.md`. Ciclo per macro-task:

1. Antonio dà il **brief di prodotto** in chat.
2. Code esplora, fa le **domande di prodotto** (AskUserQuestion, scelta multipla con
   raccomandazione e costi), scrive la **spec** in `docs/tasks/NN-nome.md` e propone
   il **piano** in plan mode.
3. **Approvazione del piano = unico checkpoint umano.**
4. Implementazione end-to-end con **self-verification a ogni step**:
   `bun run build` + `bunx tsc --noEmit` + `bun run test` + probe e2e (`scripts/e2e/*`)
   + verifica browser (preview tools) per cambi visibili.
5. **Commit checkpoint autonomi** su feature branch.
6. Report finale: file toccati, comandi di test manuale, costi/telemetria se rilevanti.
   Antonio decide push/merge.

Restano SEMPRE sotto conferma esplicita: migration DB (`prisma migrate`), edit di
`prisma/schema.prisma`, `.env*`, `next.config.*`, `package.json`, file core chat
(`orchestrator.ts`, `prompts.ts`, `update-plan-preview-handler.ts`), `.claude/*`, push.

## Setup Claude Code (.claude/)

- **`settings.json`** — `allow`: read/search, git status/diff/log/add/**commit**/
  **checkout -b**/**switch feature/***/**tag**, `bun run *`, `bun test`, `bunx tsc/next/prisma
  generate|format|validate` (checkout/switch generici restano in `ask`). `ask`: push/pull/merge/rebase/reset --hard,
  `prisma migrate|db push|db execute|db seed|studio`, rm/mv, curl/wget, edit dei file
  protetti elencati sopra.
- **Hook `block-dangerous.js`** (PreToolUse Bash): blocca `rm -rf`, `sudo`,
  pipe-to-shell, `git push --force` e **qualunque `git push` verso main/master**.
  Exit 2 = stop. Non aggirare un blocco: spiega ad Antonio cosa volevi fare.
- **Hook `protect-secrets.js`**: blocca lettura/edit di `.env*`, chiavi, credenziali.
- **Hook `auto-approve-safe-edits.js`**: auto-approva Edit/Write su
  `src/lib/**` (tranne core chat), `src/features/**`, `src/store/**`,
  `src/app/focus/**`, `src/app/api/voice/**`, `src/app/api/google/**`,
  `scripts/**`, `docs/**.md` — se non rimuovono export. Il resto passa al
  permission system normale. Audit in `.claude/hooks-audit.log`.
- **Hook `typecheck-on-ts-edit.js`** (PostToolUse): `bunx tsc --noEmit --incremental`
  dopo edit `.ts/.tsx`. Se gli errori sono preesistenti, segnalalo e continua.

## Variabili d'ambiente

In `.env.local` (già configurate in dev + Vercel):
- `DATABASE_URL`, `DIRECT_URL` — Postgres Neon
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — integrazioni Google (Task 26)
- `ANTHROPIC_API_KEY` — chat LLM

Previste (Task 27, da aggiungere quando si implementa): `DEEPGRAM_API_KEY`,
`ELEVENLABS_API_KEY?`, `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`,
`VOICE_TTS_VOICE_ID?`, `VOICE_DAILY_TURN_CAP`, `VOICE_DAILY_SESSION_CAP`.

Previste (Shadow v3, si aggiungono per workstream — cfr. `docs/tasks/30-v3-w0-checklist-amministrativa.md`):
`REVENUECAT_WEBHOOK_AUTH`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_{BASE,PLUS,PRO,MAX}_{MONTHLY,YEARLY}`,
`SHADOW_TRIAL_EPOCH`, `SHADOW_MODEL_ROUTING?`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`,
`CRON_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY`.

**Mai** committare `.env.local` o stampare secret nei log.

## Comandi utili

```bash
bun install              # installa dipendenze
bun run dev              # dev server su :3000
bun run build            # build di produzione (deve passare prima di commit)
bun run test             # vitest
bun run lint             # eslint
bunx prisma studio       # UI tabellare DB (ask)
bunx prisma migrate dev  # nuova migration dopo change schema (ask)
bunx prisma migrate status
```

## Troubleshooting Windows

### `bun run build`: EPERM su `query_engine` Prisma

**Sintomo.** `bun run build` fallisce allo step `prisma generate` con
`EPERM: operation not permitted` su
`node_modules/.prisma/client/query_engine-windows.dll.node`.

**Causa.** File locking dell'engine Prisma su Windows: `bun run dev` o
`bunx prisma studio` aperti in un altro terminale tengono un handle sulla DLL.
Windows-specific: non si manifesta su Linux/Vercel.

**Workaround.** Chiudere dev server e Studio in tutti i terminali, rilanciare il build.

**Check facoltativo** (PowerShell):

```powershell
Get-Process node, bun -ErrorAction SilentlyContinue |
  Select-Object Id, ProcessName, StartTime
```

I sub-process `node` zombie post-typecheck si auto-puliscono in 30-60s e non sono
la causa dell'EPERM.
