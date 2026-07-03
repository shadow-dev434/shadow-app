# J8 — Strict, focus e body doubling — journal UI [seriale]

Utente: collaudo-strict@probe.local (id cmr2nfpmi002cib00v1yvabu1), profilo con
blockedApps=[instagram, tiktok, twitter], DailyPlan oggi con 2 task planned.
Sessione browser via token mintato + localStorage shadow-user (D-auth: la UI si fida
del localStorage per l'identità client).

## Esiti passo-passo

| # | Passo | Esito | Evidenza / DB |
|---|-------|-------|---------------|
| 1 | Today mostra "LE 3 COSE DI OGGI" con 2 task e bottone **Inizia** | PASS | one-tap presente su ogni riga + "Altre modalità" (icona senza label, D52). |
| 2 | **one-tap "Inizia"** | PASS meccanica, **D32 confermato** | Overlay "STRICT MODE ATTIVA · 3 app bloccate · Finisce alle HH:MM", DB StrictModeSession status=`active_strict`, plannedDuration=50, exitAttempts=0. MA il timer atterra **"In pausa / 50:00"** con banner **"LAUNCH — Sblocca e inizia"**: serve un TAP ULTERIORE per far partire il timer. La promessa "one-tap = al lavoro" (Task 61) non regge: sono 2 tap. |
| 3 | Scudo su web | no-op (atteso) | "3 app bloccate" è dichiarativo; nessun blocco reale in web (solo APK). D-w7: nessuna superficie web per **preparare** blockedApps (le ho dovute settare via seed). |
| 4 | **Refresh durante strict** | **D8 confermato (S1)** | Dopo `location.reload()` con sessione `active_strict` viva: l'app rimonta su **Inbox pulita**, nessun overlay strict, timer sparito. La sessione resta **`active_strict` in DB, endedAt=null** → fuga totale dalla friction + sessione orfana. Riproducibile. |
| 5 | Friction di uscita completa (4 step) | PASS meccanica | STEP 1/4 "Vuoi davvero uscire?" → 2/4 countdown 15s reale (bottone "Continua" appare a 0) → 3/4 "Perché vuoi uscire?" (textarea obbligatoria) → 4/4 "Digita VOGLIO USCIRE". DB dopo: status=`exited`, **exitAttempts=1**, exitReason="mi sono ricordato di una cosa urgente", actualDur=2. Friction robusta e ben scritta (L-friction). |
| 6 | **endedAt dopo exit** | **FINDING dati** | Entrambe le sessioni `exited` hanno **endedAt=null**: il path di uscita non valorizza `endedAt`. Statistiche di durata sporche. |
| 7 | **Chiusura-per-sostituzione** (2ª "Inizia" con sessione orfana viva) | **D10 confermato** | La sessione orfana viene chiusa con status=`exited`, **actualDurationMinutes=0, exitReason=""** → conteggi falsati (una sessione "uscita" a 0 minuti senza motivo). |
| 8 | Stato task dopo exit | D9 plausibile | Task torna a `planned` (era planned da seed → l'angolo "era in_progress" non isolabile qui, ma il forcing a planned è coerente col codice `page.tsx:1131`). |
| 9 | Tab **Focus** dopo strict | **D-store** | Today/Focus restano sull'**execution view** del task uscito (isExecuting persistente nello store dopo la friction): "Inizia sessione / Fine sessione" invece del piano. Serve reload per tornare al piano. |
| 10 | **`/focus` senza related task** | **D51 confermato** | GET /focus diretto → "Nessun task selezionato per la sessione. / Torna ai task" = vicolo cieco (un solo bottone, nessun modo di scegliere un task da qui). |
| 11 | Body doubling meccanica | PASS (probe) | `probe-body-double.ts` PASS: POST /api/strict-mode triggerType=body_double, check-in session_start/step_done (Haiku, ≤2 frasi, costo ≈$0.0005/turno), PATCH extend (25→40), PATCH exited, GET nessuna sessione attiva. |

## Confermati (dossier)
- **D32** timer in pausa dopo one-tap (S2, rompe la promessa Task 61).
- **D8** refresh = fuga totale + sessione orfana (S1).
- **D10** chiusura-per-sostituzione con actualDur=0/exitReason vuoto (S3 dati).
- **D51** /focus senza task = vicolo cieco.
- **D52** "Altre modalità" icona senza label.
- **D-w7** nessuna superficie web per preparare blockedApps.
- **Nuovo**: endedAt mai valorizzato all'uscita strict (dati).
- **Nuovo (D-store)**: execution view persiste nello store dopo l'uscita, "sporca" Today/Focus fino al reload.

## uxNotes ADHD
- La friction è **eccellente** come design anti-impulso (countdown + typing + motivo): esattamente ciò che serve a un cervello ADHD. Ma è **aggirabile con un reload** (D8): l'intero valore anti-fuga crolla sul web.
- one-tap→pausa (D32) è il difetto più contro-promessa: l'utente ADHD che ha appena vinto l'attrito di iniziare trova un ALTRO bottone ("Sblocca e inizia") tra sé e il lavoro. L3-AUTOMAZIONE: il timer dovrebbe partire da solo dopo il one-tap.
- "LAUNCH / HOLD / RECOVERY" e "active_strict" sono label EN/tecniche esposte (D50).
- leftForUiPass on-device (APK): scudo reale, dialog 4 permessi + riga batteria (D19), tasto Indietro.
