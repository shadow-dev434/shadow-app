# W8 — PRO: Google Calendar ingest al lancio, Gmail in fase 2

> Decisione D8. L'OAuth Calendar (readonly + events, `CalendarToken`) è GIÀ
> implementato (`api/calendar/oauth` + callback): qui si productizza l'ingest.

## Fase 1 (lancio) — Calendar ingest

- Job di scan (riuso del cron di W5-M4 o on-open): legge gli eventi dei
  prossimi 7-14 giorni dal calendario collegato → propone voci inbox/scadenze
  con `source: 'calendar'` e link all'evento. Dedupe per eventId:
  `Task.calendarEventId` ESISTE GIÀ (`prisma/schema.prisma:126`, già usato da
  `GET /api/calendar`) → a schema invariato; un'eventuale tabella di appoggio
  richiederebbe edit di schema.prisma + migration (entrambi sotto conferma).
- Le proposte NON diventano task automaticamente: entrano nel triage della
  review serale (riuso del flusso esistente). NOTA: le varianti di apertura per
  source in `src/lib/chat/prompts.ts` (righe ~452-513) coprono solo
  gmail | manual | review_carryover — la variante `calendar` va AGGIUNTA
  (⚠️ prompts.ts è file core → conferma esplicita; aggiornare anche il commento
  source in `triage.ts:25`).
- Gating: `withCapability('calendar_ingest')` su tutte le route calendar (W2).
- Mobile: il flusso OAuth passa da `@capacitor/browser` + App/Universal Link
  (W5-M3/W6-M7), MAI nel webview (`disallowed_useragent`).
- **Verifica Google OAuth** (scope sensitive): submission avviata in W0; finché
  non approvata, cap ~100 utenti + schermata "unverified". Non bloccante per
  la beta, bloccante per il lancio pubblico → tenerla nel critical path di W9.

## Fase 2 (post-lancio) — Gmail ingest

- Scope `gmail.readonly` = **restricted** → richiede CASA security assessment
  (annuale, settimane di lead time, costi variabili a seconda del tier/vendor).
  Decisione di avvio SOLO dopo: (a) lancio avvenuto, (b) PRO con trazione,
  (c) preventivo CASA aggiornato.
- Design previsto (da dettagliare allora): scan batch notturno dei messaggi
  recenti (metadata + snippet), estrazione scadenze/azioni con Haiku
  (taskClass dedicata), proposte con `source: 'gmail'` nel triage serale —
  coerente con la visione ROADMAP ("Ingest automatico da Gmail").
- Alternativa documentata senza CASA: indirizzo di inoltro dedicato
  (l'utente inoltra/auto-inoltra email a un alias Shadow). UX e privacy diverse;
  da rivalutare solo se CASA risultasse proibitivo.
- Marketing PRO onesto fin dal lancio: "Calendar ora, Gmail in arrivo" —
  nessuna promessa di data.

## Acceptance (fase 1)

1. Utente PRO collega il calendario (web e mobile) → eventi imminenti appaiono
   come proposte nel triage serale con source corretto, senza duplicati al
   secondo scan.
2. Utente BASE/PLUS → 402 + paywall con trigger `calendar_ingest`.
3. Revoca consenso Google → ingest si ferma pulito, token rimosso.
4. Export dati include le proposte ingest; cancellazione account le elimina.
