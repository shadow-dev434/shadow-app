# J13 passo 1 — API sotto carico — collaudo68-sommerso@probe.local cmr67ie4y0066ibmkagt8b1rm

## DB pre: task per status = {"inbox":40,"planned":15}

## GET /api/tasks -> HTTP 200, 55 elementi (payload 48242 byte)
DB: totale=55 non-terminali=55
Paginazione/cap: NESSUNA — la route restituisce TUTTO (nessun take/limit, confermato a codice src/app/api/tasks/route.ts:35-38)
GET /api/tasks?status=inbox -> HTTP 200, 40 elementi
GET /api/tasks?status=planned -> HTTP 200, 15 elementi

## GET /api/daily-plan -> HTTP 200
plan = null