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
