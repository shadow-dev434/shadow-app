# N61 — Cron email serale senza backoff di inattività (verifica a codice + simulazione)

Utente: collaudo68-fantasma@probe.local (cmr67hr4n001aibmkxwssloew) — fermo da 15 giorni (lastTurnAt 2026-06-19, ultima Review 2026-06-18).

## Analisi a codice (main @ 56e0f83)
- `src/app/api/cron/evening-review/route.ts:50-53`: candidati = `db.settings.findMany({ where: { notificationsEnabled: true } })`
  -> selezione di TUTTI gli opt-in, NESSUN filtro su ultima attività/lastTurnAt/ultima Review.
- `route.ts:65-72`: unico skip per-utente = `computeEveningReviewSignal(...).shouldStart === false`.
- `src/lib/evening-review/compute-signal.ts:58-79`: shouldStart=false SOLO se (fuori finestra) OR
  (Review di OGGI esiste) OR (thread evening attivo/paused). Nessuna nozione di inattività.
- `route.ts:75-82`: dedup = 1 email/giorno via Notification `evening_review_prompt` con
  `createdAt >= mezzanotte-Rome` -> azzera OGNI giorno, quindi NON è un backoff.
- `route.ts:84-111`: invio email; il marcatore si scrive solo su invio riuscito.

## Simulazione (senza cron, senza email)
computeEveningReviewSignal (la STESSA funzione del cron) chiamata per i 15 giorni 2026-06-20..2026-07-04
alle 21:30 Rome (ora del cron `30 19 * * *` UTC in estate): shouldStart=true in 15/15 giorni.

## Verdetto
CONFERMATA: un utente in drop-off da 15 giorni con notifiche attive avrebbe ricevuto 15 email
serali identiche ("È la tua finestra serale..."), una al giorno, senza alcuna rarefazione né stop.
Per un utente ADHD in shame-spiral è spam colpevolizzante quotidiano -> churn. Backoff di inattività: ZERO.

## Stato DB Notification del fantasma (evidenza b)
[]

## Dettaglio simulazione (evidenza c)
[
  {
    "date": "2026-06-20",
    "shouldStart": true
  },
  {
    "date": "2026-06-21",
    "shouldStart": true
  },
  {
    "date": "2026-06-22",
    "shouldStart": true
  },
  {
    "date": "2026-06-23",
    "shouldStart": true
  },
  {
    "date": "2026-06-24",
    "shouldStart": true
  },
  {
    "date": "2026-06-25",
    "shouldStart": true
  },
  {
    "date": "2026-06-26",
    "shouldStart": true
  },
  {
    "date": "2026-06-27",
    "shouldStart": true
  },
  {
    "date": "2026-06-28",
    "shouldStart": true
  },
  {
    "date": "2026-06-29",
    "shouldStart": true
  },
  {
    "date": "2026-06-30",
    "shouldStart": true
  },
  {
    "date": "2026-07-01",
    "shouldStart": true
  },
  {
    "date": "2026-07-02",
    "shouldStart": true
  },
  {
    "date": "2026-07-03",
    "shouldStart": true
  },
  {
    "date": "2026-07-04",
    "shouldStart": true
  }
]
## Nota di riproduzione (2 run)
- Run 1 (2026-07-04, prima dei passi LLM): 15/15 shouldStart=true.
- Run intermedia con il thread evening_review del passo 5 lasciato ATTIVO: 0/15 —
  conferma sperimentale che `compute-signal.ts:71-79` sopprime il segnale finché esiste
  un thread evening active/paused (il check NON è filtrato per data). Mitigazione
  parziale di N61 SOLO per chi ha lasciato una review a metà; il fantasma puro
  (app mai aperta) non ne beneficia.
- Run 2 (thread evening archiviato, stato equivalente al drop-off puro): 15/15 — verdetto CONFERMATA.
