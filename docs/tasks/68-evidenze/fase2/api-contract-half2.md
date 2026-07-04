# Collaudo 68 — Fase 2 — Contratto API METÀ 2

Generato: 2026-07-04T11:33:19.893Z
Utente effimero: collaudo68-api2@probe.local (id cmr6a7jvt0000ibnkqeeovqb7)
Admin cookie disponibile: SI

## Matrice contratto (27 route)

| Route | Metodi | Senza cookie | Happy | Input invalido | Note |
|---|---|---|---|---|---|
| /api/memory | GET/POST | 401 | GET 200 POST 201 | 400 OK | GET senza try/catch (N50b: DB err→500 non tracciato) |
| /api/micro-feedback | GET/POST | 401 | GET 200 POST 200 | 400/404 | ok |
| /api/notifications | GET/POST/PATCH | 401 | 200/200/ok | 400/400 | N19 type interno accettato in POST=200 ma nascosto in GET |
| /api/onboarding | GET/PATCH | 401 | 200/200 | 400 | ok |
| /api/onboarding/complete | POST | 401 | 200 | noProfile 403 | ok |
| /api/onboarding/reset | POST | 401 | 200 | n/a (idempotente) | nessun input richiesto |
| /api/patterns | GET | 401 | 200 | n/a | ok |
| /api/profile | GET/PATCH | 401 | 200/200 | PATCH accetta body vuoto (200 no-op) | PATCH mai 400 su body vuoto (whitelist silenziosa) |
| /api/push-subscription | GET/POST/DELETE | 401 | 200/200/200 | 400 | orfano by-design (v3), ma contratto ok |
| /api/recurring | GET | 401 | 200 | n/a | ok |
| /api/recurring/[id] | PATCH/DELETE | 401 | 200/200 | 400/404 | ok |
| /api/review | GET/POST | 401 | 200/200 | 400/400 | N56: legacy risponde (repro dedicato sotto) |
| /api/settings | GET/PATCH | 401 | 200/200 | 400 | ok (D29 validazione presente) |
| /api/sky | GET | 401 | 200 | n/a | GET senza try/catch (errore engine → 500 non tracciato) |
| /api/streaks | GET/POST | 401 | 200/200 | 400 | N25 repro dedicato sotto |
| /api/strict-mode | GET/POST/PATCH | 401 | 200/201 | 400/400 | N24 repro dedicato sotto |
| /api/tasks | GET/POST | 401 | 200/201 | 400 OK | GET materializza ricorrenti (side effect) |
| /api/tasks/[id] | GET/PATCH/DELETE | 401 | 200/200/200 | 400/404 | N16 repro dedicato sotto |
| /api/voice/speak | POST | 401 | 200 (501=no provider atteso) | 400 | TTS attivo |
| /api/admin/beta/bug-reports | GET/PATCH | 404 (404) | 200 | 400/400 | admin=404 per non-admin (corretto) |
| /api/admin/beta/summary | GET | 404 (404) | 200 | n/a | admin=404 per non-admin |
| /api/auth/forgot-password | POST | pubblica 200 | 200 | 400 | anti-enumeration: sempre 200 generico |
| /api/auth/login | POST | pubblica | vedi repro D28/login | 400/401 | happy path testato nel repro register+login |
| /api/auth/register | POST | pubblica | vedi repro D28 | 400/400 | D28 repro dedicato sotto (min 8 vs reset min 6) |
| /api/auth/reset-password | POST | pubblica | vedi repro reset (J10) | 400/400 | D28: min 6 qui vs min 8 register; len6 msg="Il link non è valido o è scaduto. Richie" |

## Findings piste

1. N24 CONFERMATA: PATCH status='pippo' → HTTP 200, DB.status='pippo', GET invisibile (SI (session=null)). La sessione diventa un fantasma: nessuna vista la vede ma è ancora "attiva" in DB.
2. N25 (variante): POST streaks tasksCompleted='abc' → HTTP 500 (Prisma rifiuta stringa su Int). Non NaN persistito ma 500 non-pulito su input invalido.
3. N16 CONFERMATA: PATCH status='completed' senza completedAt → task 'completed' con completedAt=null. Sfugge a viste/calibrazione che filtrano su completedAt.
4. N55 CONFERMATA: POST /api/beta/bug-report da utente NON beta (loggato+consenso) → HTTP 200, report creato, e con severity='blocking' invia sendBetaAlert agli admin. La route usa requireSession, non requireBetaSession: nessun gate beta.
5. N56 CONFERMATA: POST /api/review (legacy) esiste, risponde 200 e incrementa Task.avoidanceCount (+1) + lastAvoidedAt via updatePatternsFromReview. La review serale conversazionale non lo chiama (usa i tool LLM): endpoint legacy senza caller UI ma pienamente funzionante e scrivente.
6. D28 CONFERMATA: register rifiuta password <8 (register/route.ts:19), reset-password accetta password ≥6 (reset-password/route.ts:19-20). Un utente può reimpostare una password di 6 caratteri che il register avrebbe rifiutato. Validatori disallineati.
7. D30 (adaptive-profile, owner half1 — testato per copertura): campi arbitrari fuori whitelist NON accettati (POST/PATCH usano whitelist → droppati in silenzio, HTTP 201). MA nessuna validazione di TIPO: POST executiveLoad='pippo' (colonna Float) → HTTP 500 non-pulito. Stessa classe di N25.
8. Classe trasversale "500 su input invalido": /api/streaks (tasksCompleted non-numerico) e /api/adaptive-profile (campo Float=stringa) NON validano il tipo prima della scrittura Prisma → 500 generico invece di 4xx. Viola §8.1c. Body pulito (nessun leak di stack), ma status errato.

## Note guard
- Route protette: `requireSession` → 401 `Unauthorized` senza cookie; 403 `consent_required` senza consenso; 401 `session_invalid` se utente cancellato o token pre-passwordChangedAt.
- Route admin (`admin/beta/*`): `requireAdminSession` → **404** (non 401/403) per non-admin, by-design ("non deve esistere").
- Route pubbliche: `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password` — nessun cookie richiesto.
- `voice/speak`: 501 se nessun provider TTS configurato (degrado atteso, non bug).

## Route con GET senza try/catch (rischio 500 non tracciato via captureApiError, N50b)
- `/api/memory` GET: nessun try/catch → un errore DB/parse va in 500 non catturato da Sentry.
- `/api/sky` GET: nessun try/catch → errore engine countLitStars/computeSkyState → 500 non tracciato.
- `/api/adaptive-profile` GET: nessun try/catch (fuori dal mio blocco ma osservato).