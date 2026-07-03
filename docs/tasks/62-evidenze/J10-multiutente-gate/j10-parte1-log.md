# J10 parte 1 — gate beta/admin (2026-07-01T23:15:05.385Z)
utenti: beta=cmr2nfs0v002yib00mul4uku9 admin=cmr2nfsyn0034ib00dseug8ai nonbeta=cmr2nfttn003aib00tljpwtw2 — today(Rome)=2026-07-02

## STEP 1 — D4: claims del login reale
login beta: status=200 cookiePresente=true
claims beta (redatti): {"id":"cmr2nfs0v002yib00mul4uku9","sub":"cmr2nfs0v002yib00mul4uku9","email":"collaudo-beta@probe.local","name":"Collaudo Beta","tourCompleted":true,"onboardingComplete":true,"iat":1782947707,"exp":1785539707,"jti":"00a34525-f81b-4f70-a66f-953775f6f821"}
login admin: status=200 cookiePresente=true
claims admin (redatti): {"id":"cmr2nfsyn0034ib00dseug8ai","sub":"cmr2nfsyn0034ib00dseug8ai","email":"collaudo-admin@probe.local","name":"Collaudo Admin","tourCompleted":true,"onboardingComplete":true,"iat":1782947708,"exp":1785539708,"jti":"f8934cb7-7b9c-4fe5-8f8a-64c5dd2cc8b2"}
login nonbeta: status=200
claims nonbeta (redatti): {"id":"cmr2nfttn003aib00tljpwtw2","sub":"cmr2nfttn003aib00tljpwtw2","email":"collaudo-nonbeta@probe.local","name":"Collaudo Nonbeta","tourCompleted":true,"onboardingComplete":true,"iat":1782947709,"exp":1785539709,"jti":"4c872e43-3fad-45c3-85ff-0eccd7924bf3"}
>> claim isBetaTester nel token del login reale (beta): false
>> claim isBetaTester nel token del login reale (admin): false
>> claim admin/isAdmin nel token del login reale (admin): false
>> confronto codice: login/route.ts:61-70 minta SOLO {id,sub,email,name,tourCompleted,onboardingComplete}; auth.ts:50 (jwt callback NextAuth) minta token.isBetaTester; auth.ts:80 lo copia in session.user. Nessun claim admin esiste in NESSUN flusso: il gate admin ri-verifica l'email contro ADMIN_EMAILS a ogni request (admin-guard.ts:64).
controprova flusso NextAuth callback/credentials (beta): status=200 claims(redatti)={"name":"Collaudo Beta","email":"collaudo-beta@probe.local","picture":null,"sub":"cmr2nfs0v002yib00mul4uku9","id":"cmr2nfs0v002yib00mul4uku9","isBetaTester":true,"tourCompleted":true,"onboardingComplete":true,"consentGiven":true,"iat":1782947711,"exp":1785539711,"jti":"89b4df84-62fa-480f-9896-1822970fbe20"}
>> isBetaTester via flusso NextAuth: true (se true, l'allowlist BETA_TESTERS contiene collaudo-beta e il buco e' SOLO nel login custom)
GET /api/auth/session (cookie login REALE beta): status=200 session.user.isBetaTester=false
GET /api/auth/session (cookie MINTATO isBetaTester:true): status=200 session.user.isBetaTester=true
>> Le superfici UI beta (BugReportDialog.tsx:444, BetaCheckinCard.tsx:155, tasks/page.tsx:3364,3394) ritornano null se session.user.isBetaTester e' false → col login reale la strumentazione beta NON si monta.

## STEP 2 — superfici API beta: reale vs mintato
GET /api/beta/bug-report → reale=200 mintato=200
GET /api/beta/assessment → reale=200 mintato=200
GET /api/beta/feedback/status?clientDate=2026-07-02&clientTime=21:00 → reale=200 mintato=200
>> Delta atteso: NESSUNO a livello API (le route beta usano solo requireSession, nessun gate isBetaTester server-side). Il delta di D4 e' tutto in /api/auth/session (step 1).

## STEP 3 — collaudo-nonbeta su superfici beta (D66)
GET  /api/beta/bug-report  (nonbeta) → 200
POST /api/beta/bug-report  (nonbeta) → 200 body={"report":{"id":"cmr2p19xu00nyib6s8malcl5r","status":"new","createdAt":"2026-07-01T23:15:15.474Z"}}
POST /api/beta/feedback pulse (nonbeta) → 200 body={"feedback":{"id":"cmr2p1amb00o0ib6smxhegn9v","kind":"daily_pulse","day":"2026-07-02"}}
PATCH /api/beta/assessment ASRS a1 (nonbeta, art.9!) → 200 body={"response":{"instrument":"asrs","wave":"pre","totalScore":2,"completedAt":null,"answered":1,"totalItems":18}}
GET /beta/assessment (pagina, nonbeta autenticato) → status=200 htmlBytes=24436 markerQuestionario=false

## STEP 4 — bug report e2e (tester → admin → tester)
hop1 POST /api/beta/bug-report (beta, login reale) → 200 id=cmr2p1chl00o4ib6sgaf66zno
hop2 GET /api/admin/beta/bug-reports?status=new (admin, login reale) → 200 trovatoIlReport=true emailUtenteVisibile=collaudo-beta@probe.local
hop3 PATCH admin status=fixed → 200 status=fixed resolvedAt=2026-07-01T23:15:20.253Z
hop4 GET /api/beta/bug-report (beta) → 200 report.status=fixed resolvedAt=2026-07-01T23:15:20.253Z priority=P2
hop5 righe Notification per il tester: 0 (atteso 0: il toast "risolta" e' client-side, BugReportDialog.tsx:87-114 confronta resolvedAt con localStorage — nessuna notifica server)

## STEP 5 — pulse giornaliero (idempotenza)
POST 1 → 200 body={"feedback":{"id":"cmr2p1efu00o6ib6sfbxek0ti","kind":"daily_pulse","day":"2026-07-02"}}
POST 2 (stesso giorno) → 200 body={"feedback":null,"duplicate":true}
righe DB (userId,kind,day): 1 — answers={"mood":4,"usedToday":true,"note":"primo invio collaudo"}

## STEP 6 — questionario T0 (ASRS pre): resume a meta'
GET iniziale → 200 responses=0
PATCH meta' (9/18 item) → 200 body={"response":{"instrument":"asrs","wave":"pre","totalScore":19,"completedAt":null,"answered":9,"totalItems":18}}
GET resume → 200 bozzaASRS: item salvati=9/18 completedAt=null
PATCH completamento → 200 body={"response":{"instrument":"asrs","wave":"pre","totalScore":36,"completedAt":"2026-07-01T23:15:23.362Z","answered":18,"totalItems":18}}
PATCH ADEXI completo → 200 body={"response":{"instrument":"adexi","wave":"pre","totalScore":44,"completedAt":"2026-07-01T23:15:23.816Z","answered":14,"totalItems":14}}
DB assessment: asrs/pre total=36 completed=true; adexi/pre total=44 completed=true — totale ASRS atteso=36
GET feedback/status dopo T0 → 200 body={"betaDay":1,"pulseDue":false,"weeklyDue":false,"assessmentDue":null}

## STEP 7 — gate admin
GET /admin/beta (admin, login reale) → 200 bytes=24336
GET /admin/beta (nonbeta) → 404 (atteso 404 "non esiste")
GET /admin/beta (anonimo) → 307 location=/?auth=login
GET /api/admin/beta/bug-reports (nonbeta) → 404 body={"error":"Not found"}
GET /api/admin/beta/summary (nonbeta) → 404
GET /api/admin/beta/bug-reports (beta NON admin) → 404
GET /api/admin/beta/bug-reports (anonimo) → 404
PATCH /api/admin/beta/bug-reports (nonbeta prova a cambiare status) → 404
status del report dopo il tentativo non-admin: fixed (atteso: fixed, invariato)

spendUsd totale (beta+admin+nonbeta): 0