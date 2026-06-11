# Task 28 — Password dimenticata self-service

> Spec scritta da Claude Code il 2026-06-11 (Workflow v2) su brief di Antonio.
> Sostituisce il flusso manuale `scripts/set-user-password.ts` (Task 23), che
> resta come fallback ops. Branch: `feature/23-beta-feedback-bugops`.

## Obiettivo

Durante la beta i reset password si fanno a mano con `set-user-password.ts`:
non scala oltre i 20-100 tester e non va bene per il lancio pubblico. Serve un
flusso self-service: richiesta dal login → email con link monouso → pagina che
imposta la nuova password.

## Flusso

1. **Login (`AuthGateView`, `src/app/tasks/page.tsx`)**: link "Password
   dimenticata?" sotto il campo password → form inline (stessa schermata,
   nessuna pagina nuova) con email precompilata → POST
   `/api/auth/forgot-password` → messaggio generico di conferma.
2. **`POST /api/auth/forgot-password`**: normalizza l'email (trim+lowercase,
   come register/login), se l'utente esiste genera un token monouso e invia
   l'email col link. **Risposta sempre identica** (200 + stesso body) sia che
   l'email esista sia che non esista: anti user-enumeration.
3. **Email (Resend, REST puro)**: link `{NEXTAUTH_URL}/reset-password?token=…`,
   valido 1 ora.
4. **Pagina `/reset-password`** (pubblica): nuova password + conferma → POST
   `/api/auth/reset-password` → successo → CTA "Vai al login" (`/?auth=login`).
5. **`POST /api/auth/reset-password`**: valida il token (esistenza + scadenza),
   hash bcrypt cost 12 (identico al register), update `User.password`,
   brucia tutti i token di reset dell'email in transazione.

## Decisioni di design

| Decisione | Scelta | Motivo |
|---|---|---|
| Storage token | Modello **`VerificationToken`** esistente (schema NextAuth) | Zero migration / zero edit a `schema.prisma`. La tabella non è usata da nessun flusso attivo (login = solo CredentialsProvider). |
| Isolamento flusso | `identifier = "password-reset:<email>"` | Se in futuro la tabella servisse ad altri flussi (magic link), i token non si mescolano. |
| Token | 32 byte random (`crypto.randomBytes`), base64url nell'URL; **in DB solo lo sha256 hex** | Un leak del DB non permette di costruire link validi. Lookup deterministico per hash. |
| Scadenza | 60 minuti | Brief (~1h). |
| Rate limit | Max **3 token non scaduti per email**; oltre, richiesta **silenziosamente ignorata** (risposta invariata) | Equivale a max 3 richieste/ora per email senza colonne nuove (la TTL fa da finestra). Un 429 esplicito rivelerebbe che l'email esiste (il contatore esiste solo per email registrate) → niente 429. |
| Anti-enumeration | Stesso body 200 per email esistente/inesistente; anche su errore interno la risposta resta generica | Brief. Residuo accettato per la beta: il timing della risposta (invio Resend in await) può differire leggermente. |
| Email send | Pattern `src/lib/beta/alert.ts`: Resend via REST `fetch`, timeout 5s, **mai throw** | Regola "REST via fetch, zero SDK vendor"; un fallimento di invio non deve cambiare la risposta. |
| From | `PASSWORD_RESET_EMAIL_FROM` → fallback `BETA_ALERT_EMAIL_FROM` → `Shadow <onboarding@resend.dev>` | Nessuna env nuova obbligatoria. |
| Password | Min 6 caratteri + bcrypt cost 12 | Identico a `register/route.ts` (stessi messaggi d'errore). |
| `emailVerified` | Settato al primo reset riuscito (se null) | Il reset prova il possesso dell'email: è una verifica a tutti gli effetti. |
| Middleware | `/reset-password` **fuori dal matcher** di `src/middleware.ts` | Stesso pattern di `/privacy` e `/terms`: pubblica by-omission. Gli endpoint stanno sotto `/api/auth/*`, già nella skip-list assoluta. Commento aggiunto nel matcher per documentare l'omissione intenzionale. |
| Deep-link login | `?auth=login` / `?auth=forgot` ora letti da `AuthGateView` | Il middleware e `authOptions.pages.signIn` rimandavano già a `/?auth=login` ma il parametro era ignorato: ora apre direttamente il form giusto. |
| i18n | Testi hardcoded in italiano | `tasks/page.tsx` è vista non estratta (regola CLAUDE.md §7); la pagina nuova migrerà a next-intl con v3 W4. |

## ⚠️ Resend: sandbox vs dominio verificato

Con l'account Resend in **sandbox** (stato attuale):
- le email partono **solo verso l'indirizzo del titolare dell'account** Resend
  (gli altri destinatari ricevono un 403 `validation_error`, che il backend
  ingoia per design: l'utente vede comunque il messaggio generico);
- il mittente può essere solo `onboarding@resend.dev`.

**Prima di aprire la beta ai tester va verificato un dominio su Resend**
(Dashboard → Domains → Add Domain, record DNS DKIM/SPF) e impostato
`PASSWORD_RESET_EMAIL_FROM` (es. `Shadow <noreply@dominio-verificato>`)
su Vercel. Fino ad allora il flusso self-service funziona end-to-end solo
per l'email del titolare; per i tester resta `set-user-password.ts`.

## Limiti accettati (beta)

- **Le sessioni JWT già emesse restano valide** dopo il reset (strategy `jwt`,
  30 giorni): nessuna revoca server-side senza un campo `passwordChangedAt`
  (eventuale follow-up post-beta).
- Rate limit solo per-email (niente per-IP): sufficiente per la scala beta.
- Timing della risposta non equalizzato (vedi sopra).

## File

| File | Cosa |
|---|---|
| `src/lib/password-reset.ts` | **Nuovo** — token (create/validate/burn), rate limit, invio email |
| `src/lib/password-reset.test.ts` | **Nuovo** — unit test helper puri |
| `src/app/api/auth/forgot-password/route.ts` | **Nuovo** — richiesta reset (pubblica via skip-list `/api/auth`) |
| `src/app/api/auth/reset-password/route.ts` | **Nuovo** — conferma reset |
| `src/app/reset-password/page.tsx` + `reset-password-form.tsx` | **Nuovo** — pagina pubblica |
| `src/app/tasks/page.tsx` | Edit `AuthGateView`: link, form inline, deep-link `?auth=` |
| `src/middleware.ts` | Solo commento (route pubblica by-omission) |
| `scripts/e2e/probe-password-reset.ts` | **Nuovo** — probe e2e |

## Test

- Unit: `bun run test` (helper puri: hash, URL building).
- E2E (dev server attivo su :3000):
  ```powershell
  bun run dotenv -e .env.local -- bun run scripts/e2e/probe-password-reset.ts
  ```
  Copre: anti-enumeration (body identici), creazione token (hash sha256 in DB,
  scadenza ~1h), rate limit silenzioso alla 4ª richiesta, reset felice (login
  con nuova password OK, vecchia rifiutata, token bruciati), token
  invalido/scaduto → 400, password debole → 400 senza consumare il token.
- Manuale: login → "Password dimenticata?" → inviare a un'email registrata
  (in sandbox: solo quella del titolare Resend) → aprire il link → impostare
  la nuova password → login.
