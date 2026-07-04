# Fase 2 — Engine deterministici + Loop apprendimento + Observability + Rolling summary + Onboarding→profilo

Blocco §8.6/§8.7/§8.8/§8.9/§8.10. Eseguito su main, DB dev royal-feather, dev :3000.
Script: `scripts/e2e/collaudo-68/f2-engine.ts`, `f2-learning.ts`, `f2-api-observability.ts`,
`f2-onboarding-profile.ts` + `scripts/e2e/probe-rolling-summary.ts` (riusato).

## Esiti sintetici

| Pista | Esito | Evidenza |
|---|---|---|
| Eisenhower ≥4 | CONFERMATA (soglia AND regge; ma quadrant≠decision ai bordi) | f2-eisenhower-grid.txt |
| Decomposizione pattern | SMENTITA (fallback pattern-aware, non fotocopia) | f2-decompose-*.json |
| N13 tre orologi | CONFERMATA (a codice + consumer) | vedi §N13 |
| N5 task_completed | CONFERMATA | f2-n5-chat-complete.json |
| N6 processed=false | CONFERMATA (0/14) | f2-learning-report.md |
| N7 prioritizeTaskAdaptive dead | CONFERMATA | grep |
| N18 Streak/UserPattern | CONFERMATA | f2-learning-report.md |
| N19 notifications type libero | CONFERMATA | f2-api-observability-report.md |
| N24 strict-mode status libero | CONFERMATA | f2-api-observability-report.md |
| N25 streaks non-numerici | CONFERMATA (variante: 500 non 4xx, no NaN) | f2-n25-streaks.json |
| N50 captureApiError coverage | PARZIALE (6 route senza) | vedi §N50 |
| N50b memory/learning-signal GET | CONFERMATA (no try/catch) | codice |
| Scrubbing art.9 | CONFERMATA solida (a codice) | sentry-scrub.ts |
| N12 rolling summary | SMENTITA (fold sensato, watermark ok) | probe-rolling-summary |
| N33 onboarding→profilo drift | CONFERMATA | f2-onboarding-profile-drift.md |

## N13 — tre orologi
- `execution-engine.getCurrentTimeSlot()` → `nowHourInRome()` (Rome). Idem `decompose/route.ts:57`.
- `ai-assistant/route.ts:98-104 getTimeSlot()` → `new Date().getHours()` = ora locale server (UTC su Vercel).
  Consumato a `:182,:212,:265,:437` per `getAdaptiveScore` (scoring raccomandazione) + telemetria `timeSlotPerformance`.
- client = ora browser. Su prod (UTC) la fascia serale slitta → raccomandazioni/telemetria di fascia sbagliata la sera. Mascherato in dev locale (macchina in fuso Rome).

## N50 — captureApiError coverage
Route.ts SENZA captureApiError (6/54): auth/forgot-password, auth/reset-password, auth/[...nextauth],
calendar/oauth, health, sky. (health e [...nextauth] accettabili; sky è una route viva).
N50b: GET /api/memory e GET /api/learning-signal NON hanno try/catch → un errore DB in `findMany`
produce un 500 fuori da captureApiError (le rispettive POST invece sono coperte).

## Nota Eisenhower (coerenza)
Grid ai bordi: (3,4)→quadrant=delegate/decision=postpone; (4,3)→quadrant=schedule/decision=do_now.
`quadrant` e `decision` possono DIVERGERE ai bordi (stesso task, due etichette diverse) — potenziale confusione UI.

## Nota input-invalid → 500 (non 4xx)
`POST /api/ai-classify` e `POST /api/streaks` restituiscono 500 su body malformato/non-numerico
(req.json() o Prisma-Int throw dentro il try). Il 500 è tracciato, ma viola il contratto §8.1(c) "mai 500 su input invalido".
