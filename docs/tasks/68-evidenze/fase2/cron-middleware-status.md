# Fase 2 — cron + middleware + matrice status + doppio-tab
data=2026-07-04T11:31:52.741Z  CRON_SECRET present=true

## §8.2 CRON /api/cron/evening-review
- no-Bearer: status=404 body={"error":"Not found"}
- bad-Bearer: status=404
- messi in pausa 62 altri opt-in per isolare il candidato
- run1: {"candidates":1,"sent":0,"skipped":0,"failed":1} (todayRome=2026-07-04)
- dopo run1: prompt-marker=false fail-marker=true
- R15 verificato: failed=1, fail-marker presente, prompt-marker assente (invio verso @probe.local respinto da Resend).
- run2 (dedup): {"candidates":1,"sent":0,"skipped":0,"failed":1}
- fail-marker count dopo 2 giri = 1 (dedup fail-marker ok); l'email però viene ri-tentata ogni giro finché non riesce.
- opt-out effimero: Notification count=0
- ripristinati 62 opt-in + finestra serale candidato

## §8.2 N30 — schedule fisso 30 19 UTC vs DST
- inverno: cron→20:30 Rome (in window=true); estate: cron→21:30 Rome (in window=true)
- N30: nessun buco per finestra default; edge only per finestre custom strette (≤1h) tra 20:30 e 21:30.

## §8.3 MIDDLEWARE — pagine pubbliche vs gated (anonime)
- /                  status=200 location=(none)
- /account-deletion  status=200 location=(none)
- /admin/beta        status=307 location=/?auth=login
- /beta/assessment   status=307 location=/?auth=login
- /chat              status=307 location=/?auth=login
- /consent           status=307 location=/?auth=login
- /focus             status=307 location=/?auth=login
- /onboarding        status=307 location=/?auth=login
- /privacy           status=200 location=(none)
- /reset-password    status=200 location=(none)
- /tasks             status=307 location=/?auth=login
- /terms             status=200 location=(none)
- /tour              status=307 location=/?auth=login
- matcher middleware NON include /privacy /terms /reset-password /account-deletion (pubbliche by-design): confermato dai 200 sopra.
- N31: /chat anonima status=307 location=/?auth=login

## §8.4 MATRICE STATUS Task
- creati task base: inbox/planned/in_progress/completed
- N17: 'active' e 'abandoned' sono nell'enum taskStatuses() → PATCH li accetta (nessun produttore nei flussi, ma il dato è legale).
- N16: dopo PATCH status=completed → row.completedAt=null (null = incoerenza dati confermata)
- GET /api/tasks (nessun filtro) ritorna TUTTI gli stati (incl. terminali): {"active":1,"abandoned":1,"completed":2,"inbox":1}

## §8.4 D22 — DELETE task presente nel piano → id orfano nel JSON
- top3Ids dopo DELETE = ["cmr6a9stk000wibgspvbka91q","cmr6a9t0e000yibgseg0twel4","cmr6a9t7k0010ibgsyzov2m25"] (contiene ancora cmr6a9stk000wibgspvbka91q=true)
- doNowIds dopo DELETE = ["cmr6a9stk000wibgspvbka91q"]
- join rows del task cancellato = 0 (rimosse); ma il JSON resta stale.
- GET /api/daily-plan breakdown.top3 renderizza 2 task (Top 3 → Top 2): id orfano nascosto a runtime ma persistito nel JSON.

## §8.5 N15 — rigenera piano (POST /api/daily-plan) dopo review con fasce
- pre: source=review morning=1 afternoon=1
- dopo POST: dailyPlanTask con fascia=0 (0 = fasce cancellate); source ora=engine
- radice: daily-plan/route.ts:117 fa dailyPlanTask.deleteMany del piano e ricrea solo top3/doNow/schedule/delegate/postpone — nessuna preservazione delle fasce, nessuna conferma server (la guardia D44 è SOLO client).

## §8.5 N15b/D55 — store reset energy/time al refresh (verifica a codice)
- shadow-store.ts:290-293 → energy:3, timeAvailable:480 come default hardcoded; lo store Zustand è "senza persist" (CLAUDE.md).
- CONFERMATA staticamente: ogni refresh riporta energy=3/time=480, perdendo i valori scelti dall'utente; il POST /api/daily-plan di default usa energy=3/timeAvailable=480 (route:74-75) coerentemente.

- cleanup effimeri f2cms-* completato.