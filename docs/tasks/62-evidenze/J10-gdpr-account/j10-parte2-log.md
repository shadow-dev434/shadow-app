# J10 parte 2 — GDPR e ciclo di vita account (2026-07-01T23:25:40.036Z)
BASE_URL=http://localhost:3000
seed: gdpr=cmr2pepqa0000ibp8suvh0cb1 (tasks=2 thread=cmr2perji000bibp8zu48trpq)
seed: del=cmr2pespn000eibp89blhlvob (tasks=2 thread=cmr2petva000pibp8e2u6j9en)

## STEP 1 — export GDPR
GET /api/export senza cookie → 401 (atteso 401)
GET /api/export?format=json (cookie SENZA claim beta) → 200
contenuto: tasks=2 (dei miei 2 seed: 2/2), chatThreads=1 (il mio thread c'e'=true, messaggi=2), profile presente=true (occupation=string)
chiavi totali nell'export: 155; match pattern sensibile: []
di cui solo-contenitore calendarTokens (metadati, senza valori token): []
chiave 'password' presente: false; 'adminNotes' presente: false
GET /api/export?format=csv → 200 content-type=text/csv; charset=utf-8 righe=3 (header + 2 task) header=id,title,description,importance,urgency,resistance,size,category,context,quadrant,decision,status,priorityScore,avoidanceCount,deadline,completedAt,createdAt
>> NB: il CSV copre SOLO i task, non e' un export GDPR completo (route export/route.ts:72-100).
>> Gate UI: la card "Esporta dati" in Impostazioni e' beta-only (tasks/page.tsx:3394 isBetaTester), ma l'API /api/export richiede solo la sessione → il diritto e' esercitabile solo via API o da tester (D66).

## STEP 2 — revoca consenso
GET /tasks PRIMA della revoca → 200 (token senza claim consentGiven: se 200, il middleware rilegge dal DB — middleware.ts:114-131)
DELETE /api/consent → 200 body={"ok":true}
DB dopo revoca: consentGivenAt=null consentArt9=false consentVersion=collaudo-62 (resta come record storico)
GET /tasks DOPO la revoca (redirect:manual) → 307 location=/consent (atteso 307 → /consent)
GET /api/tasks con consenso REVOCATO → 200 tasks=2 (se 200: API non gated sul consenso)
POST /api/chat/turn con consenso REVOCATO → 200 threadId=cmr2pf7x300osib6sdwfp2bpx (se 200: il trattamento LLM continua dopo la revoca — la UI promette "ferma l'app")
POST /api/consent {acceptTerms:true} (parziale) → 400 (atteso 400, entrambe obbligatorie)
POST /api/consent completo → 200; DB: consentGivenAt=Thu Jul 02 2026 01:26:12 GMT+0200 (Ora legale dell’Europa centrale) consentArt9=true consentVersion=0.2-draft (nota: la versione ora e' quella del copy corrente — '0.2-draft' = consenso legale ancora in bozza)
GET /tasks dopo ri-consenso → 200 (utente di nuovo usabile)

## STEP 3 — eliminazione account (j10del)
sanity pre-delete: GET /api/tasks → 200 tasks=2; DB={"user":1,"tasks":2,"threads":1,"messages":2,"profile":1,"settings":1,"patterns":1}
DELETE /api/account SENZA stringa di conferma → 200 body={"ok":true} (spec attendeva 4xx: la conferma "ELIMINA" e' SOLO client-side — il server elimina incondizionatamente)
cascade DB post-delete: {"user":0,"tasks":0,"threads":0,"messages":0,"profile":0,"settings":0,"patterns":0} (atteso tutto 0)
cookie POST-delete su /api/tasks → 200 tasks=0 (401 atteso se invalidato; 200 = sessione fantasma)
cookie POST-delete su /api/auth/session → 200 body={"user":{"name":"Collaudo J10del","email":"collaudo-j10del@probe.local","id":"cmr2pespn000eibp89blhlvob","tourCompleted":true,"onboardingComplete":true,"consentGiven":false,"isBetaTester":false},"expi
cookie POST-delete su /tasks (pagina) → 307 location=/tour (il middleware non trova il profilo → tourCompleted false → rimbalzo /tour da utente INESISTENTE)
>> La UI mitiga chiamando signOut() dopo la delete (tasks/page.tsx:3287), ma il JWT in se' resta decodificabile e accettato da requireSession (auth-guard.ts: nessun check di esistenza utente).

## STEP 4 — /account-deletion pubblica
GET /account-deletion SENZA cookie → 200 bytes=33231 (cita ELIMINA=true, cita "Esporta JSON"=true, cita scheda "Impost."=true)
>> Confronto col codice: la card "Elimina account e dati" (Account) NON e' beta-gated → Metodo 1 vale per tutti. La sezione §5 pero' istruisce "Esporta dati → Esporta JSON": quella card e' SOLO beta (tasks/page.tsx:3394) → un utente non-beta segue le istruzioni e NON trova la sezione (D66).

## STEP 5 — logout finto D5
codice: tasks/page.tsx:614-625 handleLogout = SOLO store Zustand + localStorage.removeItem + setCurrentView('auth') — NESSUNA chiamata server, NESSUN signOut(): il cookie httpOnly next-auth resta intatto.
GET /api/tasks col cookie dopo il "logout" client → 200 tasks=2 (200 = D5 CONFERMATO: chiunque riapra il browser rientra senza credenziali per 30gg)
GET /api/auth/signout → 200 (pagina HTML di conferma NextAuth, bytes=5456)
POST /api/auth/signout (con csrfToken) → 200 — Set-Cookie azzera il session-token: true
replay del VECCHIO cookie dopo il signout → 200 (200 = il signout pulisce solo il browser; il JWT non e' revocabile server-side — strategy jwt)

## STEP 6 — forgot/reset password
RESEND_API_KEY presente nell'ambiente dev: true (valore mai letto/stampato)
POST forgot-password (email esistente) → 200 body={"ok":true,"message":"Se l’email è registrata, riceverai un link per reimpostare la password. Controlla anche lo spam."}
POST forgot-password (email INESISTENTE) → 200 body={"ok":true,"message":"Se l’email è registrata, riceverai un link per reimpostare la password. Controlla anche lo spam."} (anti-enumeration: identica?)
POST forgot-password (email sintatticamente invalida) → 400 body={"error":"Email non valida"}
>> D65: la risposta promette "riceverai un link" INCONDIZIONATAMENTE (forgot-password/route.ts:12-16,38-44): stessa risposta se Resend manca, fallisce (sandbox consegna solo al titolare: probe.local NON riceve nulla) o il rate limit scatta.
token di reset in DB per collaudo-j10gdpr@probe.local: 1 (in DB c'e' solo lo sha256: il raw viaggia SOLO nell'email)
token di reset FABBRICATO via DB (stessa pipeline sha256) per completare il flusso
POST reset-password con password di 5 char → 400 body={"error":"Password deve essere almeno 6 caratteri"} (atteso 400 "almeno 6")
POST reset-password con password di 6 char → 200 body={"ok":true} (D28: il reset accetta 6)
token residui per l'email dopo il reset: 0 (atteso 0: monouso, brucia tutti)
POST /api/auth/login con la NUOVA password di 6 char → 200 (200 = una password che il register rifiuterebbe e' ora valida end-to-end)
POST register con password di 7 char → 400 body={"error":"La password deve essere di almeno 8 caratteri"} (server: min 8, register/route.ts:18; il CLIENT valida min 6, tasks/page.tsx:781; il reset accetta 6, reset-password/route.ts:19 → D28 CONFERMATO: tre policy diverse)
utente collaudo-j10reg creato dal 400? 0 (atteso 0)
4 forgot consecutivi → status=[200,200,200,200] — token attivi in DB: 3 (cap atteso 3; la 4a e' ignorata in silenzio, risposta identica)
ripristino password standard collaudo + purge token → login di verifica 200 (j10gdpr VIVO)

stato finale: collaudo-j10gdpr VIVO=true; collaudo-j10del ELIMINATO=true
spendUsd: gdpr=0.008741500000000001 del=0 (le righe AiUsage di j10del sono state cancellate in cascade) totale=0.008741500000000001