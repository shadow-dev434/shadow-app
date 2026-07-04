# J9 — error path API (2026-07-04T11:14:46.100Z)

## P1 POST /api/chat/turn (senza consenso)
status=403
body={"error":"consent_required"}

## P1 GET /api/tasks (senza consenso)
status=403
body={"error":"consent_required"}

## P1 GET /api/daily-plan (senza consenso)
status=403
body={"error":"consent_required"}

## P1 POST /api/consent acceptArt9=false
status=400
body={"error":"Entrambi i consensi sono obbligatori: Termini di servizio e dati relativi alla salute (art. 9)."}

## P1 POST /api/consent JSON malformato
status=400
body={"error":"Invalid JSON"}

## P1 GET /api/onboarding (senza consenso)
status=403
body={"error":"consent_required"}

nota: GET /api/onboarding senza consenso → 403 consent_required
## P1 PATCH /api/onboarding (senza consenso)
status=403
body={"error":"consent_required"}

## P2a msg 4100 char
status=400
body={"error":"Messaggio troppo lungo: il massimo è 4000 caratteri."}

## P2b PDF 4.2MB
status=400
body={"error":"Allegato troppo grande: il massimo è 4MB."}

## P2c 5 allegati
status=400
body={"error":"Troppi allegati: al massimo 4 per messaggio."}

## P2d .docx
status=400
body={"error":"Formato non supportato: immagini (JPEG, PNG, GIF, WebP) o PDF."}

## P5 attachments non-array
status=400
body={"error":"Allegati non validi."}

## P5 item non-oggetto
status=400
body={"error":"Allegato non valido."}

## P5 data vuota
status=400
body={"error":"Allegato vuoto o non leggibile."}

## P5 data non-string
status=400
body={"error":"Allegato vuoto o non leggibile."}

## P5 kind sconosciuto
status=400
body={"error":"Formato non supportato: immagini (JPEG, PNG, GIF, WebP) o PDF."}

## P5 mediaType finto
status=400
body={"error":"Formato non supportato: immagini (JPEG, PNG, GIF, WebP) o PDF."}

## P5 base64 corrotto (run 1)
status=500
body={"error":"Errore interno"}

## P5 base64 corrotto (run 2)
status=500
body={"error":"Errore interno"}

## P5 /api/chat/turn JSON malformato
status=500
body={"error":"Errore interno"}

## P3 doppio submit A
status=200
body={"threadId":"cmr69lbpf027yibe4u7wl1za6","mode":"general","assistantMessage":"Era già in lista. Niente di nuovo aggiunto.","toolsExecuted":[{"name":"create_task","input":{"title":"Chiamare il dentista per fissare la visita","urgency":3,"importance":3,"category":"admin"},"result":{"alreadyExists":true,"id":"cmr69llqh028eibe494n7fq0p","title":"Chiamare il dentista per fissare la visita","status":"inbox","note":"Task with the same title already open: no duplicate created. Tell the user it is already

## P3 doppio submit B
status=200
body={"threadId":"cmr69lbpf027yibe4u7wl1za6","mode":"general","assistantMessage":"Aggiunto. Hai altre cose da fare oggi?","toolsExecuted":[{"name":"create_task","input":{"title":"Chiamare il dentista per fissare la visita","urgency":3,"importance":3,"category":"admin"},"result":{"id":"cmr69llqh028eibe494n7fq0p","title":"Chiamare il dentista per fissare la visita","urgency":3,"importance":3,"category":"admin"}}],"quickReplies":[],"costUsd":0.0027316,"tokensIn":242,"tokensOut":135,"modelUsed":"claude-h

## P3 esito DB
messaggi utente duplicati nel thread=2
task "dentista"=[{"id":"cmr69llqh028eibe494n7fq0p","title":"Chiamare il dentista per fissare la visita","status":"inbox"}]

P3 dedup task: 1 task creato/i
## P4 threadId inesistente
status=200
body={"threadId":"cmr69lrxn028qibe4obojlcwr","mode":"general","assistantMessage":"Non ho capito. Sei in chat con me adesso — questa è la schermata giusta.\n\nSe vuoi vedere i task di oggi o iniziare il morning check-in, dimmi.","toolsExecuted":[],"quickReplies":[],"costUsd":0.00127,"tokensIn":417,"tokensOut":48,"modelUsed":"claude-haiku-4-5","latencyMs":1622}

## P4 threadId altrui
status=200
body={"threadId":"cmr69m43j029eibe4gh6zlyc7","mode":"general","assistantMessage":"Non posso aiutarti con quello — Shadow non ha accesso a thread altrui né a funzioni di modifica esterna.\n\nSe stai cercando di collaborare su un documento condiviso o di lasciare un messaggio da qualche parte, dipende dalla piattaforma: usa direttamente quella app (Google Docs, Slack, ecc.).\n\nCosa stai cercando di fare, in realtà?","toolsExecuted":[],"quickReplies":[],"costUsd":0.001538,"tokensIn":420,"tokensOut":101

## P6 D39 lato server
400 di validazione: messaggio MAI scritto in DB.
Turno accettato: user message scritto PRIMA della callLLM (orchestrator.ts:503) → un 500 a metà turno lo lascia in DB, recuperabile dallo storico thread.


## Spesa LLM collaudo68-j9-api: $0.0110