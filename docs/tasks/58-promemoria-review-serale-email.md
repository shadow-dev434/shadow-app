# Task 58 — Promemoria review serale via email (ponte beta)

> Spec del 2026-06-16. Follow-up del fix client "review serale ad app aperta"
> (feature/57, `/api/chat/evening-signal` + polling). Qui copriamo il caso
> **app chiusa**: se l'utente non apre Shadow la sera, oggi non riceve nulla.

## Contesto e decisione di canale

Il trigger della review serale è **pull-only**: parte solo quando ChatView è
montata e il polling vede l'ingresso nella finestra serale. Ad app chiusa nessun
sollecito.

Per il sollecito ad app chiusa erano sul tavolo: web push, push native
(FCM/APNS), email. **Decisione di Antonio (2026-06-16): email serale come ponte
per la beta.** Razionale:
- Il **web push** si sovrappone alle push native FCM/APNS già pianificate per
  Capacitor (v3 W5, `docs/tasks/35`), ed è fragile su iPhone (richiede PWA
  installata + iOS 16.4+). Costruirlo ora sarebbe in parte throwaway.
- L'**email** funziona su TUTTI i device (incl. iPhone) senza opt-in browser, e
  riusa un'infrastruttura **già esistente** (Resend via REST).

Le push native restano l'obiettivo a regime (v3 W5); questa email è il ponte beta.

## Cosa riusiamo (già esistente)

- **Decisione "è ora della review?"** — `computeEveningReviewSignal(userId, clientTime, clientDate)`
  in `src/lib/evening-review/compute-signal.ts`: pura, read-only, già con l'antidup
  a granularità giorno (`Review.date`) e il check "thread evening_review attivo".
- **Finestra serale** — `isInsideEveningWindow` (`window.ts`) + default 20:00–23:00
  (`config.ts`).
- **Invio email Resend** — pattern di `src/lib/beta/alert.ts` e
  `src/lib/password-reset.ts`: POST `https://api.resend.com/emails` con
  `Authorization: Bearer ${RESEND_API_KEY}`, body `{from,to,subject,text,html}`,
  timeout 5s, **mai throw**. Nessun SDK (regola CLAUDE.md #3).
- **Data/ora Rome** — `formatTodayInRome` (`dates.ts`); `nowHHMMInRome()` esiste in
  `bootstrap/route.ts` → da estrarre in `dates.ts` per riuso.
- **Dedup + feed** — modello `Notification` (`schema.prisma`, campi type/title/body/
  read/actionUrl/userId/createdAt): usato come **marcatore "promemoria inviato oggi"**
  → **zero migration**.
- **Opt-in** — `Settings.notificationsEnabled` (default true) come master switch.

## Cosa creiamo

1. `src/lib/evening-review/evening-email.ts` — `sendEveningReviewEmail(email)`:
   copy gentile, non colpevolizzante; link a `NEXTAUTH_URL` (apre la chat → il
   polling client mostra il banner review). Pattern Resend REST, mai throw.
2. `src/app/api/cron/evening-review/route.ts` — `GET` protetto da
   `Authorization: Bearer ${CRON_SECRET}` (il middleware non blocca le API, route
   coperta dal matcher `/api/:path*`). Logica:
   - calcola `nowHHMMRome` + `todayRome` una volta;
   - enumera i candidati: `Settings` con `notificationsEnabled=true` + utente con
     email; per ciascuno `computeEveningReviewSignal` → se `shouldStart` **e** non
     già inviato oggi (nessuna `Notification type='evening_review_prompt'` con
     `createdAt` nel giorno-Rome) → invia email + crea la `Notification` marker;
   - resiliente: un invio fallito non blocca gli altri; ritorna un riepilogo
     `{candidates, sent, skipped, failed}` (mascherato nei log).
3. `vercel.json` (nuovo, **sotto conferma**) — un cron **giornaliero** (Vercel
   Hobby = solo daily). Orario consigliato `30 19 * * *` UTC = 20:30 CET (inverno)
   / 21:30 CEST (estate): entrambi **dentro** la finestra 20:00–23:00 tutto l'anno.

## Decisioni di prodotto (CONFERMATE da Antonio, 2026-06-16)

1. **Timezone** — ✅ *Europe/Rome hardcoded* per la beta (tutti gli utenti in
   Italia; tech-debt già dichiarato in `dates.ts`). `Settings.timezone` rimandato
   a v3.
2. **Frequenza** — *una sola email/giorno* a orario fisso (un solo cron daily,
   Hobby-free). Niente solleciti ripetuti in v1.
3. **Orario** — ✅ target **~21:30 Rome** (a metà finestra). Cron `30 19 * * *`
   UTC = **21:30 CEST** (estate, valore attuale) / **20:30 CET** (inverno):
   l'oscillazione DST di 1h resta dentro la finestra 20:00–23:00. *Limite noto:*
   gli utenti con `eveningWindowStart` più tardo dell'orario di invio non ricevono
   l'email quel giorno (il cron gira una volta sola) → `computeEveningReviewSignal`
   torna `shouldStart:false` perché fuori finestra. Accettabile per la beta.
4. **Opt-in** — ✅ gate su `Settings.notificationsEnabled` (default true → tutti i
   tester ricevono). Nessuna nuova UI in v1; un toggle nelle Settings può seguire.
5. **Dedup** — marcatore via `Notification` (zero migration), non un nuovo campo.
6. **Contenuto** — testo statico gentile, `subject:"Shadow — è ora della review
   serale"`, link alla root. Niente personalizzazione LLM (zero costo/latenza nel
   cron).

## Dipendenza bloccante (azione Antonio)

⚠️ **Resend richiede un dominio verificato per consegnare a indirizzi diversi dal
titolare dell'account** (sandbox: solo l'email dell'owner, solo da
`onboarding@resend.dev`). Finché il dominio non è verificato, il promemoria arriva
**solo ad Antonio**, non agli altri tester. Azione: verificare un dominio nel
dashboard Resend + impostare un `EVENING_EMAIL_FROM` (o riusare
`BETA_ALERT_EMAIL_FROM`) su quel dominio.

## Env nuove (sotto conferma, mai committate)

- `CRON_SECRET` — bearer del cron endpoint (dev `.env.local` + Vercel).
- `EVENING_EMAIL_FROM` (opzionale; fallback su `BETA_ALERT_EMAIL_FROM`).
- (riuso) `RESEND_API_KEY`, `NEXTAUTH_URL`.

## File toccati

| File | Tipo | Conferma |
|------|------|----------|
| `src/lib/evening-review/evening-email.ts` | nuovo | auto (src/lib) |
| `src/app/api/cron/evening-review/route.ts` | nuovo | normale |
| `src/lib/evening-review/dates.ts` | estrae `nowHHMMInRome` | auto (src/lib) |
| `vercel.json` | nuovo (cron) | **Antonio** |
| `.env*` / Vercel | `CRON_SECRET`, FROM | **Antonio** |
| Resend dashboard | dominio verificato | **Antonio** |

Nessuna migration. Nessuna nuova dipendenza. `prisma/schema.prisma` non toccato.

## Verifica

- `bunx tsc --noEmit` + `bun run test` + `bun run build` verdi.
- Test unit per la selezione candidati/dedup (mock `computeEveningReviewSignal`,
  `Notification` esistente → skip; fuori finestra → skip).
- Probe e2e: chiamare `/api/cron/evening-review` con il bearer e un utente in
  finestra senza review → 1 email (verso l'owner Resend in sandbox) + 1
  `Notification` marker; seconda chiamata stesso giorno → 0 invii (dedup).

## Rischi

- **Resend sandbox** (sopra): senza dominio, multi-tester non coperto.
- **DST**: cron UTC fisso; l'orario Rome oscilla di 1h tra CET/CEST — gestito
  scegliendo un UTC che cade dentro la finestra in entrambi i casi.
- **Coordinamento col banner client**: il dismiss del banner è solo client-side;
  un utente che ha già aperto e ignorato la card potrebbe ricevere comunque
  l'email (il server non conosce il dismiss). Accettabile in v1; persistere il
  dismiss è lavoro futuro.
- **Hobby cron = daily**: granularità fissa, non onora finestre personalizzate
  tardive (decisione #3).
