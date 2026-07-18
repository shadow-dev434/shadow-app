# Task 74 — Vista calendario interna (agenda settimanale)

> Brief: Antonio, 2026-07-18 — "valuta se è possibile inserire una grafica come
> quella di google calendar per una visualizzazione immediata di impegni e
> scadenze; l'ideale sarebbe che le attività programmate da Shadow vengano
> inserite in un calendar consultabile". Direzione ratificata col piano del
> 2026-07-18 (punto 3): vista interna subito, Google Calendar write-sync a W8
> post-lancio (verifica OAuth Google in corso lato Antonio).

## Perché agenda per fasce e non griglia oraria

I dati di Shadow NON hanno orari per-task: la pianificazione della review
serale scrive 3 fasce (morning/afternoon/evening in `DailyPlanTask.slot`),
l'unico istante a orologio è `Task.deadline` (`AllocatedTask.fixedTime` è un
hook inerte riservato alla calendar-awareness W8). Una griglia oraria alla
Google Calendar sarebbe vuota e falsamente precisa. La forma giusta è una
**agenda settimanale verticale**: 7 giorni, per ogni giorno le fasce del piano,
le scadenze con orario e i ricorrenti proiettati.

## Scope

### API — `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

La route esisteva ed era **orfana** (shape FullCalendar mai consumata: audit
2026-07-18). Retro-compatibilità: senza parametri risponde come prima; con
`from`/`to` (validati: formato YMD, `to ≥ from`, range ≤ 31 giorni, 400
parlante altrimenti) risponde con la nuova shape agenda:

```
{ days: [{
    date: 'YYYY-MM-DD',
    plan: null | { source: 'review'|'chat'|'engine',
                   slots: null | { morning: Item[], afternoon: Item[], evening: Item[] },
                   items: Item[] },          // items = piano piatto se senza fasce
    deadlines: [{ id, title, status, time: 'HH:mm' }],   // orario Europe/Rome
    recurring: [{ templateId, title, rule }],            // proiezioni future
}] }
```

Assemblaggio in un **builder puro** `src/lib/calendar/agenda.ts`
(unit-testabile senza mock di route):
- **plan**: DailyPlan+DailyPlanTask del range; derivazione slots/source
  identica alla GET /api/daily-plan (fasce presenti → review; slot 'today' →
  chat; altrimenti engine).
- **deadlines**: Task non-terminali con deadline nel range; giorno e orario
  derivati in Europe/Rome (`formatDateInRome` + nuovo helper `hhmmInRome`).
- **recurring**: proiezione dei template attivi via `occursOn` (riuso
  recurrence.ts, zero logica nuova), SOLO per giorni ≥ oggi, e SOLO se il
  piano di quel giorno non contiene già l'istanza materializzata (niente
  doppioni); etichetta regola via `describeRuleIt`.

### UI — vista `calendar` nella TasksApp

- Nuovo componente `src/features/calendar/CalendarView.tsx` (pattern ChatView:
  feature fuori dal monolite; il monolite riceve solo il mount).
- `ViewMode` + `'calendar'` (store), `URL_VIEWS` + `'calendar'` (deep-link
  `?view=calendar` e back di sistema gratis), tab "Agenda" nella BottomNav
  (icona CalendarDays, 6 tab).
- Layout mobile-first: header con label settimana + nav ‹ Oggi ›; 7 righe
  giorno (lun→dom, oggi evidenziato ambra); per giorno: fasce
  Mattina/Pomeriggio/Sera con chip task (tap → dettaglio task), scadenze con
  orario, ricorrenti come chip tratteggiati non interattivi. Giorno vuoto →
  riga sottile "Niente in agenda".
- "Oggi" e la settimana si calcolano sull'orologio del device (utenti target
  it-IT ≈ Europe/Rome, stessa convenzione del resto del client).
- Testi in italiano (regola pre-W4).

## Non-scope

- Vista mese, drag&drop, orari per-task (`fixedTime` resta a W8), scrittura
  eventi Google (W8 fase 2), ICS.

## Decisioni minori prese in autonomia (da annotare nel report)

- 6ª tab in BottomNav ("Agenda") invece di un entry-point secondario dentro
  Oggi: la visualizzazione immediata era il punto del brief.
- Ricorrenti proiettati solo da oggi in avanti: il passato reale vive già nel
  piano/istanze; proiezioni retroattive = rumore.
- Scadenze di task completati/archiviati escluse (coerente con la GET legacy).

## Verifica

- Unit: builder agenda (fasce/source, day-key e orario Rome delle deadline,
  proiezione ricorrenti con esclusione istanze già in piano, range).
- Probe e2e `scripts/e2e/task74/probe-agenda.ts`: seed piano+scadenza+
  ricorrente via db → GET range (shape, orario Rome, ghost), legacy senza
  parametri, 400 su range invalidi.
- Browser: vista, navigazione settimana, tap task → dettaglio.
- `tsc` + `bun run test` + `bun run build` verdi.

## File toccati

`src/lib/calendar/agenda.ts` (+test, nuovi), `src/lib/evening-review/dates.ts`
(+`hhmmInRome`), `src/app/api/calendar/route.ts` (GET esteso),
`src/features/calendar/CalendarView.tsx` (nuovo), `src/store/shadow-store.ts`
(ViewMode), `src/app/tasks/page.tsx` (mount+nav+URL_VIEWS),
`scripts/e2e/task74/probe-agenda.ts` (nuovo). Nessun file core chat, nessuna
migration, nessuna dipendenza nuova.
