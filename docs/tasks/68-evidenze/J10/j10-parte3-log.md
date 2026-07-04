# J10 parte 3 — reset/throttle/N21 (2026-07-04T12:00:48.557Z)

## STEP R16 — reset password → sessioni pre-reset revocate
utente effimero con password: collaudo68-j10-reset@probe.local id=cmr6b9jzs0000ib104khiq1lv

## STEP D28 — policy password: reset ≥6 vs register ≥8
>> D28 CONFERMATO: reset-password/route.ts:19 (min 6) vs register/route.ts:19 (min 8) — due validator diversi. Una password di 6-7 char valida via reset è rifiutata alla registrazione.
passwordChangedAt=2026-07-04T12:01:02.606Z iat(cookie pre-reset)=1783166457 (=2026-07-04T12:00:57.000Z)

## STEP N21 — token/sessione pre-reset su /api/admin/* e beta/assessment (admin-guard senza passwordChangedAt)
admin passwordChangedAt=2026-07-04T12:01:14.265Z iat(cookie pre-reset)=1783166467 (=2026-07-04T12:01:07.000Z)
>> N21 CONFERMATO: requireSession revoca il token pre-reset (401) ma requireAdminSession/requireBetaSession (admin-guard.ts:53-102) NON leggono passwordChangedAt né verificano l'esistenza utente → i sink admin/beta restano accessibili con una sessione che il reset password avrebbe dovuto chiudere. Delta: requireSession=401 vs admin-guard=200 vs beta-guard(assessment)=200.

## STEP D65 — throttle login (lockout senza countdown) + forgot ottimista
7 login sbagliati → status=[401,401,401,401,401,429,429]
messaggio lockout: "Troppi tentativi falliti. Riprova tra qualche minuto." — countdown presente=false (atteso false: "Riprova tra qualche minuto." è generico)

## STEP signout — JWT strategy: il signout pulisce il cookie del browser, il vecchio JWT resta valido
>> R7/signout: il logout reale invalida la sessione SOLO lato browser (Set-Cookie Max-Age=0). Con strategy JWT non esiste revoca server-side: un cookie catturato prima del signout resta accettato fino a scadenza (30gg) o cambio password. Nota di sicurezza, non un blocker: coerente col design NextAuth JWT documentato dal 62.

spesa LLM (admin, unico coorte toccato): 0 USD (attesa ~0)