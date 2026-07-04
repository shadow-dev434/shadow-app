# J11 — Body doubling completo (/focus), browser reale, collaudo68-body — 2026-07-04

Login reale. Ingresso `/focus?taskId=<task con 3 microSteps>`.

## Esiti
- **Setup PASS**: schermata "BODY DOUBLING" col titolo del task, scelta durata 25/50/90,
  "Inizia con Shadow" / "Non ora, torna ai task" (uscita chiara, L2 ok).
- **Avatar 3D PASS (con caveat)**: canvas WebGL montato, VRM `avatar-v1.vrm` caricato.
  Console: `GLTFMToonMaterialParamsAssignHelper: Failed to load texture. The rendering
  result may be wrong` (×3) → una texture dell'avatar non carica: l'avatar si vede ma
  potenzialmente sbagliato. Da annotare (qualità dell'esperienza MAX-tier).
- **Timer + step PASS**: parte a 24:58 e scorre; 3 micro-step tappabili, Pausa, Ho finito.
- **N43 CONFERMATA (app ONESTA)**: "Pausa" → la UI DICHIARA "In pausa — il timer continua"
  e il timer infatti scorre (24:46 → 24:42). Il drift è nella GUIDA (promette pausa vera),
  non inganno in-app → finding documentale, non S2. La "Pausa" innesca anche un check-in
  del companion.
- **Companion LLM reale PASS**: "Sono bloccato" → risposta pertinente e specifica al task
  ("…raccoglierle tutte in un'unica pila fisica prima di pensare al resto—due minuti…").
  Tono caldo, un micro-passo alla volta (buon L8). step_done → step barrato (opacity-50) +
  altro check-in del companion.
- **BUG "Ho finito" auto-completa tutto**: barrato manualmente SOLO 1 step su 3, poi
  "Ho finito" → summary "3/3 passi fatti" e in DB il task risulta `status=completed` con
  **tutti e 3** i microSteps `done:true`. "Ho finito" forza il completamento dell'intero
  task + tutti i sotto-step a prescindere dal lavoro reale. Non esiste un "mi fermo qui" che
  preservi il progresso granulare (solo abbandono via nav). Rischio: chi tocca "Ho finito"
  intendendo "stop" perde lo stato reale e il task viene chiuso a torto.
- **D20 CONFERMATA**: sul task SENZA microSteps ("Stirare le camicie") → "Ho finito" →
  summary spoglio "0 minuti con Shadow" (NESSUNA riga di completamento/celebrazione), MA in
  DB il task è `status=completed` con completedAt. La sessione completa il task ma non lo
  riconosce nel summary (taskCompletedDuringSession=false per i task senza step) → l'utente
  non riceve alcun senso di conclusione (L7, esperienza MAX-tier "fredda").
- **N5 CONFERMATA (forte)**: completare un task via body doubling emette **0 LearningSignal**
  (verificato in DB dopo 2 completamenti: totale segnali = 0). Nessun `task_completed` →
  `whatDone` vuoto in review e calibrazione sottostimata per chi lavora col body doubling.
- **Persistenza server-side ASSENTE**: nessun modello `BodyDoubleSession` in DB → la
  sessione è client-only (localStorage). Il recovery "Riprendi" dopo reload dipende dallo
  stato client → da verificare la robustezza (F5/kill) in Appendice B on-device.

## Metriche
- Cap chat/check-in companion (BODY_DOUBLE_DAILY_*): non stressati fino al cap in browser
  (verifica a codice in fase 2). Check-in periodico ~10min non atteso live (sessione breve).
- TTS: ELEVENLABS_API_KEY presente ma audio non innescato/percepito nel flusso testato
  (verifica dedicata in fase 2 o Appendice B).

## Evidenze
j11-dbcheck.md (stati task + microSteps + 0 signals), scripts/e2e/collaudo-68/j11-dbcheck.ts.
