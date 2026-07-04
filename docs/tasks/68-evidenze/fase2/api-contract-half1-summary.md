# Fase 2 — Contratto API METÀ 1: triage e verdetti

Fonte: `f2-api-contract-half1.ts` (103 asserzioni, matrice completa in `api-contract-half1.md`)
+ repro dedicati `f2-n19-notif-dedup.ts`, `n50b-daily-plan-500.txt`.
Dev :3000, DB royal-feather, utenti effimeri `collaudo68-f2*` (cleanup a fine run).

## Copertura: 27 route, tutti i metodi esportati

Tutte le route hanno superato 401-senza-cookie + happy 2xx. Nessun endpoint fa
autenticazione dopo il lavoro. Sotto solo le eccezioni e i finding.

## Fail grezzi del contract sweep → triage

| Riga fallita | Vero difetto? | Nota |
|---|---|---|
| GET learning-signal [invalid] → **500** | **SÌ — FINDING (N50b)** | `?limit=abc` → NaN → `take:NaN` → Prisma throw, **nessun try/catch**, 500 corpo vuoto, fuori Sentry |
| POST daily-plan [invalid] → **500** | **SÌ — FINDING** | `energy:'notanumber'` o `timeAvailable:'abc'` → 500 `Failed to generate daily plan` (tracciato, ma dovrebbe essere 400) |
| PATCH beta/assessment [401] → 404 | No | `requireBetaSession` restituisce 404 (gate "non esisti" per non-allowlist, by-design D66). Senza cookie = non-allowlist → 404. Accettabile |
| GET beta/assessment [invalid non-beta] → 200 | No | GET usa `requireSession` semplice (non beta-gated): torna le PROPRIE risposte. Aspettativa test errata |
| PATCH beta/assessment [happy] → 400 | No | id strumento corretto = `asrs` (non `ASRS`), wave `pre`/`post` (non `T0`). Con valori giusti → **200**, scoring server-side ok (totalScore=36 su asrs) |
| POST beta/feedback [happy] → 400 | No | kind valido = `daily_pulse` (non `pulse`). Con valore giusto → **200** (idempotente, `duplicate:true` su retry) |
| GET beta/feedback/status [happy] → 400 | No | richiede `?clientDate=YYYY-MM-DD&clientTime=HH:mm`. Con param → **200**. La 400 senza param È la validazione corretta |
| GET calendar/oauth [happy] → 404 | No | senza `GOOGLE_CLIENT_ID` in dev → 404 pulito by-design (D23). Non è un guasto |

## Findings confermati (dettaglio)

### F2-API-1 — GET /api/memory e GET /api/learning-signal: 500 non tracciato (N50b) — S2
`memory/route.ts:12-33` e `learning-signal/route.ts:16-28`: il ramo GET NON ha
try/catch. `limit = Math.min(100, Math.max(1, Number(param)))`: con `?limit=abc`,
`Number('abc')=NaN`, i clamp restano NaN, `take: NaN` → Prisma solleva →
**HTTP 500 con corpo VUOTO** e **senza `captureApiError`** (quindi invisibile a
Sentry/telemetria). Repro: `GET /api/memory?limit=abc` e
`GET /api/learning-signal?limit=abc` → entrambi 500 body="".
Evidenza: `n50b-daily-plan-500.txt`. **N50b CONFERMATA.**

### F2-API-2 — POST /api/daily-plan: 500 su energy/timeAvailable non numerici — S3
`daily-plan/route.ts:74-83`: `energy = body.energy ?? 3` non coerce/valida il tipo.
Con `energy:'notanumber'` o `timeAvailable:'abc'` il calcolo engine esplode →
**500** `{"error":"Failed to generate daily plan"}`. È dentro try/catch (tracciato),
ma un input client-controllabile che dà 500 dovrebbe essere un 400. `energy:99`
(fuori range 1-5) invece NON crasha → 200 (nessuna validazione di range, ma innocuo).
Evidenza: `n50b-daily-plan-500.txt`.

### F2-API-3 — POST /api/notifications con `type` libero sopprime il cron serale (N19) — S2
`notifications/route.ts:61`: `type: type || 'system'` — il valore arriva dal client
senza validazione contro `INTERNAL_NOTIFICATION_TYPES` né contro i type di sistema.
Il cron review serale (`cron/evening-review/route.ts:75-79`) deduplica cercando una
`Notification type='evening_review_prompt'` con `createdAt>=mezzanotte-Rome`: se la
trova, `skipped++; continue` **prima** del send email (riga 84).
Un client autenticato che fa `POST /api/notifications {type:'evening_review_prompt',
title,body}` scrive esattamente quella riga → per quel giorno il cron considera
l'utente "già sollecitato" e **non invia il promemoria serale reale** (core loop).
Repro deterministico (`f2-n19-notif-dedup.ts`): stesso utente candidato
(shouldStart:true), cron PULITO → utente nel ramo `failed` (email tentata, bounce su
dominio finto); cron SABOTATO (riga-cliente presente) → `skipped 54→55 (+1)`,
`failed 4→3 (-1)`: l'utente è deviato nel ramo dedup e l'email **non viene nemmeno
tentata**. Con un dominio reale il clean darebbe `sent:1`, il sabotato `sent:0`.
**N19 CONFERMATA.** Nota collaterale: `evening_review_prompt` NON è in
`INTERNAL_NOTIFICATION_TYPES`, quindi la riga fabbricata è anche VISIBILE all'utente
nella lista notifiche (rumore aggiuntivo).

## Pista a-codice

### N60 — calendar/oauth/callback senza `state` anti-CSRF — CONFERMATA (statica)
`calendar/oauth/route.ts:31-38` costruisce l'URL Google **senza** parametro `state`;
`calendar/oauth/callback/route.ts:7-27` non genera né valida alcun nonce `state`.
La sola difesa è `requireSession` (riga 11): un attaccante che induce la vittima
loggata a colpire `.../callback?code=<codice_attaccante>` collega il calendar
dell'attaccante all'account della vittima (CSRF classico su OAuth). Superficie orfana
in dev (no GOOGLE_CLIENT_ID) ma il codice è attivo. **N60 CONFERMATA a codice.**
