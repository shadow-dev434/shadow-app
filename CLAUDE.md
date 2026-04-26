# CLAUDE.md — Shadow ADHD App

> Questo file è letto automaticamente da Claude Code a ogni sessione.
> Contiene il contesto permanente del progetto. Non contiene task:
> i task sono in `docs/ROADMAP.md` e nei file `docs/tasks/*.md`.

---

## Cos'è Shadow

App per adulti con ADHD. Core features:
- **Profilazione adattiva** (`AdaptiveProfile`, 60+ dimensioni comportamentali)
- **Memoria rinforzata per-utente** (`UserMemory` con strength/evidence/EMA)
- **Priority engine** che propone task adeguati a tempo/contesto/stato
- **Decomposizione AI** di task grandi in micro-step
- **Strict mode** anti-distrazione con friction intenzionale
- **Nudge system** adattivo basato su `LearningSignal` pregressi

Target deploy: web (Vercel) + APK Android (wrapper WebView).

---

## Stack

- **Next.js 16** (App Router) + React 19 + **TypeScript strict**
- **Prisma ORM** su **Postgres Neon** (branch `main`)
- **NextAuth** (Credentials + Google OAuth)
- **Zustand** per state client (`src/store/shadow-store.ts`, attualmente senza persist)
- **z-ai-web-dev-sdk** per chiamate GLM (Z.ai) — orchestrate negli engine
- **Tailwind CSS** + **shadcn/ui** + Radix primitives
- **bun** come package manager e runtime dev

## Struttura cartelle

```
src/
├── app/
│   ├── page.tsx                  ← ~3934 righe, da splittare (TASK 2 ROADMAP)
│   ├── api/
│   │   ├── tasks/route.ts
│   │   ├── daily-plan/route.ts
│   │   ├── decompose/route.ts
│   │   ├── review/route.ts
│   │   ├── notifications/route.ts
│   │   ├── streaks/route.ts
│   │   ├── contacts/route.ts
│   │   ├── settings/route.ts
│   │   ├── export/route.ts
│   │   ├── calendar/route.ts
│   │   ├── strict-mode/route.ts
│   │   ├── patterns/route.ts
│   │   ├── onboarding/route.ts
│   │   ├── push-subscription/route.ts
│   │   ├── memory/route.ts
│   │   ├── learning-signal/route.ts
│   │   ├── micro-feedback/route.ts
│   │   ├── adaptive-profile/route.ts
│   │   ├── profile/route.ts
│   │   ├── ai-assistant/route.ts
│   │   └── ai-classify/route.ts
│   └── layout.tsx
├── lib/
│   ├── auth.ts                   ← config NextAuth
│   ├── engines/                  ← 9 engine AI (NON riscrivere, riusare)
│   │   ├── priority-engine.ts
│   │   ├── decomposition-engine.ts
│   │   ├── execution-engine.ts
│   │   ├── nudge-engine.ts
│   │   ├── learning-engine.ts
│   │   ├── memory-engine.ts
│   │   ├── profiling-engine.ts
│   │   └── ai-assistant.ts
│   └── types/shadow.ts           ← tipi condivisi
├── store/shadow-store.ts         ← Zustand (senza persist — TASK 3 ROADMAP)
├── components/ui/                ← shadcn, NON MODIFICARE
└── middleware.ts                 ← NextAuth middleware
prisma/
└── schema.prisma                 ← User, Task, AdaptiveProfile, LearningSignal,
                                    UserMemory, StrictModeSession, DailyPlan, …
```

## Stato attuale (25 aprile 2026)

- ✅ App deployata su Vercel, URL produzione: `https://shadow-app2.vercel.app/`
- ✅ DB Postgres Neon attivo, schema migrato
- ✅ Repo: `github.com/shadow-dev434/shadow-app`
- ✅ NextAuth funzionante (Credentials + Google)
- ✅ 4 fix comportamentali applicati e in produzione:
  - Filtro contesto hard nel priority engine
  - setTimeout feedback a 30s invece di 3s
  - Pulsante "Completa tutto" sempre visibile
  - Trigger strict mode indipendente dal task
- ✅ Task 3 — Persistenza thread chat (2026-04-24): rehydration del thread
  attivo on mount, skip della morning check-in se c'è già un thread attivo,
  nuovo endpoint `GET /api/chat/active-thread`, script di cleanup degli
  orfani. Commits `e459893`, `4cbe8fe`, `a6bb316`, `b7ae798`.
- ✅ Task 3.5 — Onboarding finish redirect (2026-04-25): root cause è
  `public/sw.js` che intercettava le HTML navigation con
  stale-while-revalidate, servendo redirect cached senza far girare il
  middleware. Fix in `73157d9`: bypass SW per `request.mode === 'navigate'`
  + bump cache v2→v3. Safety net in `OnboardingView` e `TourView`:
  try/catch attorno a `router.replace('/')` + fallback a 1s su
  `window.location.href` (`204ece7`, `9e1f4ed`, `a400f9b`).
- ⚠️ Problemi strutturali NON risolti (vedi `docs/ROADMAP.md`)

## Regole non negoziabili per Claude Code

1. **TypeScript strict** — zero `any` impliciti, tutti gli import devono risolvere
2. **Non riscrivere logica già corretta** — riusa gli engine esistenti
3. **Non introdurre dipendenze nuove** senza necessità esplicita documentata
4. **Non toccare `src/components/ui/`** — sono componenti shadcn generati
5. **Ogni modifica deve compilare**: `bun run build` deve passare prima di dichiarare finito
6. **Commit atomici** con messaggi descrittivi in italiano (es. `fix(auth): isolate tasks by userId`)
7. **Testi utente in italiano** — prompt GLM e label UI in italiano
8. **Se una scelta di design è ambigua**, commenta `// TODO: decidere con Antonio` invece di inventare
9. **Prima di modificare un file grande (>500 righe), chiedi conferma** del piano
10. **Non fare push automatico** — fermati dopo `git commit`, lascio io decidere il push

## Workflow preferito

1. Claude Code legge `docs/ROADMAP.md` e il task specifico in `docs/tasks/<nome>.md`
2. Propone un **piano** prima di scrivere codice, aspetta OK dall'utente
3. Implementa in step verificabili (un sotto-step alla volta se il task è grande)
4. Dopo ogni step: `bun run build` — se fallisce, correggere prima di proseguire
5. Al termine del task: eseguire acceptance test del file task
6. Se tutto verde: `git add` + `git commit` con messaggio descrittivo (NO push)
7. Report finale: file modificati/creati/eliminati + comandi da eseguire per testare manualmente

## Variabili d'ambiente

In `.env.local` (già configurate in dev + Vercel):
- `DATABASE_URL` — Postgres Neon connection string
- `NEXTAUTH_URL` — `http://localhost:3000` in dev, URL Vercel in prod
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`
- `ZAI_API_KEY` (GLM)

**Mai** committare `.env.local` o stampare secret nei log.

## Comandi utili

```bash
bun install              # installa dipendenze
bun run dev              # dev server su :3000
bun run build            # build di produzione (deve passare prima di commit)
bun run lint             # eslint
bunx prisma studio       # UI tabellare DB
bunx prisma migrate dev  # nuova migration dopo change schema
bunx prisma migrate status
```
# Snippet per `CLAUDE.md`

Aggiungi questa sezione al `CLAUDE.md` esistente, in coda (o subito prima
delle "Regole non negoziabili"). Documenta a Claude Code il nuovo setup
così non ci sono sorprese a inizio sessione.

---

## Setup Claude Code (.claude/)

A partire dal 2026-04-26 il progetto ha un `.claude/` configurato con:

- **`settings.json`**: rules di permission che auto-approvano comandi safe
  (Read/Glob/Grep, `git status/diff/log`, `git add`, `bun run build`, `bunx
  tsc`, `bunx prisma generate/format/validate`) e chiedono conferma per
  comandi che toccano repo remoti, DB, schema, env (`git commit/push`,
  `prisma migrate/db push/db execute`, edit di `prisma/schema.prisma` e
  `.env*`).
- **Hook `block-dangerous.js`**: blocca pattern distruttivi (`rm -rf`,
  `git push --force`, `sudo`, pipe-to-shell). Exit code 2 = stop.
- **Hook `protect-secrets.js`**: blocca lettura/edit di `.env*`, file di
  chiavi (`.pem`, `.key`, `id_rsa`), credenziali Google.
- **Hook `typecheck-on-ts-edit.js`**: dopo Edit/Write su `.ts`/`.tsx`
  dentro `src/` o `prisma/`, lancia `bunx tsc --noEmit --incremental` e
  segnala errori. Non bloccante.
- **Skill `/post-mortem`**: invocabile manualmente da Antonio per
  generare doc strutturati di debug.

### Implicazioni operative

1. **Non chiedere conferma per comandi auto-approvati.** Se vedi un
   comando in `permissions.allow` di `settings.json`, eseguilo
   direttamente senza preambolo.

2. **Per comandi in `ask`** (commit, push, migrate, schema/env edit),
   continua a fermarti e chiedere conferma esplicita ad Antonio. La
   convenzione consolidata è opzione 1, mai opzione 2.

3. **Se un hook ti blocca**, leggi attentamente il messaggio stderr.
   Probabilmente stai per fare qualcosa di distruttivo. NON tentare di
   aggirare l'hook (es. spezzando il comando in più step) senza prima
   spiegare ad Antonio cosa stavi cercando di fare e perché.

4. **Errori TypeScript dal hook `typecheck-on-ts-edit.js`**: se vedi
   `[typecheck] N errori TS dopo edit di X`, valuta se sistemare prima
   di proseguire. Se gli errori sono preesistenti (non causati dal tuo
   edit), segnalalo ad Antonio e continua.

5. **`/post-mortem` non si auto-invoca.** Aspetti che Antonio lo digiti.

### File da non toccare in autonomia

Anche con permission "ask" che chiede conferma, questi file richiedono
discussione PRIMA del cambio (non solo conferma del diff):
- `prisma/schema.prisma` (qualunque modifica → impatto migration)
- `.env*` (qualunque modifica → potenziale rottura prod)
- `.claude/settings.json` (modifiche al setup permessi → impatto
  workflow)
- `.claude/hooks/*.js` (modifiche a hook di sicurezza)

Se proponi di modificarli, fermati e spiega cosa vuoi cambiare e perché,
prima di proporre il diff.
