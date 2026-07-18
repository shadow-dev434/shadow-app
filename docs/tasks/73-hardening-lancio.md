# Task 73 — Hardening lancio (70-80 utenti)

> Brief: Antonio, 2026-07-18 — "settimana prossima lancerò l'app, il codice e tutta la
> struttura deve essere in grado di reggere 70-80 utenti in contemporanea".
> Deriva dall'audit pre-lancio 2026-07-18 (sessione Code): l'architettura regge il
> carico; i rischi reali sono l'abuso della register aperta, il cron serale al limite
> del timeout, la quota Resend, e due indici DB mancanti.
> Piano approvato da Antonio in chat ("fai le cose nell'ordine in cui le hai scritte")
> come punto 2 della sequenza: ① fix deploy prod → ② questo task → ③ Task 74
> (vista calendario) → ④ Task 75 (widget Android).

## Obiettivo

Chiudere i rischi operativi identificati dall'audit PRIMA del lancio pubblico,
senza toccare il comportamento del prodotto per gli utenti legittimi.

## Scope (5 interventi + 1 micro-fix)

### A. Invite code al signup — `SIGNUP_INVITE_CODE`

**Problema**: la register è completamente aperta (nessun CAPTCHA, nessuna verifica
email, nessun limite per IP). Ogni account può consumare fino a `CHAT_DAILY_CAP`
turni Sonnet/giorno → costo LLM abusabile da chiunque scripti il signup.

**Soluzione** (pattern gate-by-env, coerente con `BETA_TESTERS`/`CRON_SECRET`):
- Nuova env `SIGNUP_INVITE_CODE` (stringa). **Se assente/vuota → register aperta
  come oggi** (dev, preview e test non cambiano). Se presente → `POST
  /api/auth/register` richiede `inviteCode` nel body; confronto case-insensitive
  su trim; mismatch → 403 `{ error: 'Codice invito non valido' }`.
- UI (form Registrati in `tasks/page.tsx`): campo "Codice invito" sempre visibile
  con hint "Ti è stato dato al momento dell'invito"; se il server risponde 403
  l'errore compare nel box errori esistente. Il campo si manda sempre; è il server
  a decidere se richiederlo (il client non sa se l'env è settata).
- Decisione di prodotto ratificata col piano: **un solo codice condiviso** (lo
  distribuisce Antonio insieme al link), niente codici per-utente né tabella DB.
  Rotazione = cambio env su Vercel.

### B. Cron evening-review: `maxDuration` + invii concorrenti

**Problema**: loop sequenziale per-utente (query + email Resend con timeout 5s
ciascuna) senza `maxDuration` → col default del piano rischia il kill a metà giro
a 80 utenti; i saltati NON vengono ritentati fino al giorno dopo.

**Soluzione**:
- `export const maxDuration = 60` (tetto sicuro su qualunque piano Vercel).
- Lavorazione **a batch concorrenti di 8 utenti** (`Promise.allSettled` per batch,
  helper `runInBatches` in `src/lib/utils/batch.ts`): 80 utenti ≈ 10 batch ≈
  10-15s worst case, dentro i 60s con margine. La logica per-utente resta
  IDENTICA (finestra, focus-skip, idempotenza per giorno-Rome, marcatore solo su
  successo, traccia fallimento C1, alert "tutti falliti").
- I contatori (`sent/skipped/failed/...`) diventano riduzione dei risultati batch.

### C. Indici DB mancanti (⚠️ schema + migration → conferma esplicita Antonio)

- `Task`: `@@index([userId])` — oggi ogni lista task/triage/daily-plan scansiona
  senza indice per utente (solo l'unique di ricorrenza esiste).
- `Notification`: `@@index([userId, createdAt])` (GET take-50 ordinata) e
  `@@index([userId, type, createdAt])` (dedup del cron e del ponte email).
- Migration additiva via `bun run prisma:dev` (comando Windows, cfr. memoria).
  Nessun backfill, nessun impatto dati. A 80 utenti è debito più che blocker, ma
  costa 30 minuti ora e niente dopo.

### D. `CHAT_DAILY_CAP` default 200 → 80

Il default nel codice scende a 80 turni/utente/giorno (era 200). L'uso reale
osservato nei collaudi è 10-30 turni/giorno per utente attivo; 80 lascia ampio
margine e dimezza il danno massimo di un account abusivo. L'env resta
sovrascrivibile in ogni momento senza deploy.

### E. Igiene repo e deploy

- `.vercelignore`: esclude dal contesto di upload CLI i residui non di progetto
  (`reel*/`, `GuidaShadow/`, `cowork/`, `.next-stale-nul-panic/`, `mint-*.txt`,
  `docs/handoffs/`) — protegge un eventuale `vercel deploy` da CLI.
- `.gitignore`: aggiunte equivalenti per i residui di lavorazione locali.
- Cancellazione `mint-token.txt` e `mint-flags.txt` (token di sessione QA minted:
  non devono esistere in chiaro nella root) — con conferma via permission.

### F. Micro-fix: password minima 6 vs 8

Il form Registrati valida e promette "Almeno 6 caratteri" ma il server ne
richiede 8 → errore confuso al primo contatto col prodotto. Allineo client a 8
(validazione + placeholder).

## Non-scope

- CAPTCHA / verifica email (post-lancio se l'invite code non basta).
- Rate limit per-IP (serverless: farlo bene richiede store esterno; il cap
  per-account + invite code copre il rischio al lancio).
- Model router per tier (v3 W3), quota Resend/piano Vercel/tier Anthropic
  (azioni account di Antonio, fuori dal codice).

## Verifica

- Unit test: gate invite code (aperto/chiuso/mismatch/case), `runInBatches`
  (ordine, concorrenza, isolamento errori), contatori cron invariati.
- Probe e2e `scripts/e2e/`: register con e senza `SIGNUP_INVITE_CODE` (server
  temporaneo con env inline, pattern Task 66).
- `tsc --noEmit` + `bun run test` + `bun run build` verdi a ogni commit.

## File toccati

`src/app/api/auth/register/route.ts`, `src/app/tasks/page.tsx` (form auth),
`src/app/api/cron/evening-review/route.ts`, `src/lib/utils/batch.ts` (nuovo),
`src/app/api/chat/turn/route.ts` (riga cap), `prisma/schema.prisma` (+migration),
`.vercelignore` (nuovo), `.gitignore`, `scripts/e2e/probe-73-*.ts` (nuovo),
test unit nuovi. Nessun file core chat. Nessuna dipendenza nuova.
