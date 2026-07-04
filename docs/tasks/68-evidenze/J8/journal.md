# J8 — Strict e focus (one-tap end-to-end), browser reale, collaudo68-strict — 2026-07-04

Login reale via /api/auth/callback/credentials (200). Today `?view=today`.

## Esiti
- **R3 CONFERMATA (one-tap)**: dalla Today, 1 tap su "Inizia" → parte la sessione strict con
  timer che SCORRE da solo (49:59 → 49:46 → 48:50 → 47:06 nel corso del test, senza tap
  ulteriori). "Fai ora"/"Inizia" sono due bottoni per task (coerenza: due label per la
  stessa azione? — L9, da annotare).
- **R2 CONFERMATA (rehydrate)**: F5 durante la friction → la SESSIONE strict si rehydrata
  (timer residuo 48:50 corretto, "MODALITÀ STRICT ATTIVA", "Finisce alle 13:40",
  3 app bloccate). Il dialog friction è UI transitoria e riparte da STEP 1 (non è un bug:
  lo stato persistito è la sessione, non il modale). "Tentativi di uscita" mostrato 0 anche
  dopo un tentativo interrotto dal reload → il contatore si incrementa solo al
  completamento della friction (exitAttempts=1 in DB dopo l'uscita completa).
- **Friction 4 STEP CONFERMATI (N42)**: STEP1 "Vuoi davvero uscire?" → STEP2 "Aspetta 15
  secondi" (countdown) → STEP3 "Perché vuoi uscire?" (textarea, motivo salvato in
  exitReason) → STEP4 'Digita "VOGLIO USCIRE"'. La guida ne descrive 3 → drift documentale
  (il tour in-app, invece, li elenca giusti). Copy severo ma coerente col patto strict.
- **D9 CONFERMATA (sfumata)**: il task del piano resta `status=planned` in DB per tutto il
  ciclo. Il one-tap crea la StrictModeSession + LearningSignal `task_started`, ma NON porta
  mai il task a `in_progress` a livello DB, benché la UI mostri "In corso · 0/3 step". Dopo
  l'uscita: planned. → nessuna traccia persistente del "ho iniziato".
- **D24 CONFERMATA**: alla chiusura la StrictModeSession diventa status=exited con
  exitReason+exitAttempts, MA **non viene emesso alcun LearningSignal `strict_exited` né
  segnale positivo**. Segnali totali dell'utente: solo `strict_activated` + `task_started`.
  → `strictModeEffectiveness` può solo peggiorare (mai riceve un segnale positivo al
  completamento). File: da confermare in fase 2/§8.7.
- **FINDING NUOVO (stale store post-focus, imparentato D-res1/N15b)**: subito dopo l'uscita
  dalla strict, la Today mostra per un istante "Nessun piano per oggi. Costruiamone uno
  insieme con 'Pianifica con Shadow'" — MA il DailyPlan esiste in DB (top3Ids con 2 task) e
  al reload il piano riappare ("LE 3 COSE DI OGGI"). È uno stato client stantio: al ritorno
  dalla execution view lo store non rilegge il DailyPlan. UX: l'utente che ha appena
  faticato in un focus si trova un empty-state "freddo" che lo invita a ri-pianificare da
  zero (L4/L7 — momento delicato).

## DB evidenza (j8-dbcheck.md)
StrictModeSession: status=exited, exitReason="Test di collaudo…", exitAttempts=1.
Task t1/t2 status=planned. DailyPlan date=2026-07-04 top3Ids=[t1,t2].
LearningSignal: strict_activated + task_started (NESSUN strict_exited).

## Altri esiti J8
- **R13 CONFERMATA**: deep-link `/tasks?view=focus` SENZA sessione attiva → risolve a
  `?view=today` col piano visibile (non rompe, non lascia una focus vuota).
- **D51 CONFERMATA**: tab "Focus" nella nav senza task selezionato → schermata
  "Nessun task selezionato" con UNICA azione "Vai a Today". Vicolo cieco (L2): l'utente ha
  un piano con 2 task ma la tab Focus non li elenca né offre di sceglierne uno lì.
- Coerenza ingressi al focus (L9): il tab "Focus" e la vista `?view=focus` sono la stessa
  superficie; l'avvio vero avviene solo da Today ("Inizia"/"Fai ora"). Il tab Focus è di
  fatto un contenitore della sessione in corso, non un punto di partenza → naming ambiguo.

## Coperto meccanicamente (non ripetuto in browser)
soft/strict cycle R4 = task64/a9-soft-cycle (PASS). timer-a-0 D27 = non testabile senza
attendere 50 min reali (throttle tab peggiora): verifica statica in §8/§10. N27 (race
?view=focus con sessione attiva) e N54 (back hardware) → simulati via history in fase 2.
