# Fase 0 — Riepilogo (2026-07-04)

## Baseline (0.1)
- `main` = `origin/main` = `56e0f83` (conforme spec).
- `tsc --noEmit`: 0 errori. `bun run test`: **940/940 verdi (61 file)**. `bun run build`: verde
  (con log `[migrate-on-deploy]` atteso).

## Env (0.0)
Obbligatori §3.1-4 tutti presenti (dopo 2 iterazioni con Antonio: BETA_TESTERS/ADMIN_EMAILS/CRON_SECRET).
Facoltativi TUTTI presenti: RESEND_API_KEY, ELEVENLABS_API_KEY, SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN
→ nessun degrado dichiarato: copertura piena per email/TTS/observability.

## DB (0.2, 0.3)
- royal-feather, schema up to date (9 migration, inclusa `user_password_changed_at`).
- Inventario: 14 utenti @probe.local pre-esistenti (12 collaudo-* del 62 + 2 task6x-browser).
  4 con finestre serali residue 00:00-23:59 (lezione §2.12 confermata). 6 utenti reali (non toccati).
- **Decisione**: coorte 62 INTATTA (QA manuale Antonio); il 68 usa utenti nuovi `collaudo68-*`.

## Seed coorte 68 (0.6)
26 ruoli creati (password `Collaudo68!pass`): tipo, caos, rientro, fantasma, procrastinatore,
review-a..k (11), sommerso (40 inbox + 15 candidate), ricorrenti (assenza 10gg), strict, body,
pwa, errori (senza consenso/onboarding), beta, admin, nonbeta, apprendista (14 segnali).
`collaudo68-vergine` NON creato (register reale in J1).

## Regressione meccanica (0.4) — VERDETTO: ZERO regressioni reali
30 probe eseguiti (log in `probes/`):
- 28 VERDI, inclusi tutti i probe LLM reali (claim-crisis, a7-autoclassify, rientro-bootstrap,
  b-plan-close, c-decompose) e probe-c1 (side-effect ripristinato).
- `task65/probe-contracts` 1 FAIL **STANTIO**: assert `sw.js cache v9` superato dal bump a v10
  del Task 67 (il resto 20 PASS). Non regressione.
- `probe-task53-readonly`: primo run su porta hardcoded :3153 → rilanciato con arg
  `http://localhost:3000` → **ALL PASS**.
- `probe-chat-task-tools`: 7 FAIL = `403 consent_required` — il probe (era Task 42) crea
  l'utente SENZA UserProfile/consenso: è il gate consenso del Task 63 (R6) che funziona.
  Probe stantio, non regressione. Copertura equivalente: journey J3 con utenti consentiti.

## Server (0.5)
`shadow-dev` su :3000 via preview MCP, `/api/health` = 200 `{"status":"ok","version":"0.2.0"}`.
