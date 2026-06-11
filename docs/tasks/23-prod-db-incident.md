# Task 23 — Incident report: DB di produzione mai inizializzato (500 su `/api/auth/register`)

> **Stato: CHIUSO** — fix applicato e verificato end-to-end il 2026-06-11.
> Questo documento è il verbale dell'incidente + raccomandazioni. Nessuna
> modifica a codice o pipeline è stata applicata da questo task (solo proposte,
> vedi §Raccomandazioni).

---

## Sintomo

`POST https://shadow-app2.vercel.app/api/auth/register` → **500**
(`{"error":"Errore durante la registrazione"}`). La registrazione di nuovi
utenti in produzione era impossibile. Stesso destino per qualunque route che
tocca Prisma: il DB puntato dalla produzione non aveva **nessuna tabella**.

## Cronologia

| Data | Evento |
|---|---|
| 2026-04-25 | La `DATABASE_URL` nelle env Vercel (Production) viene cambiata: da quel momento la produzione punta a un database Neon nuovo (`ep-purple-paper-anqdrn1n…`) **mai inizializzato** (zero tabelle, zero `_prisma_migrations`). |
| 2026-04-25 → 2026-06-10 | Registrazione (e ogni route Prisma) di produzione rotta. Non rilevato: il traffico reale era ~zero (fase pre-beta) e i test giravano su dev. |
| 2026-06-10 | Scoperta durante la preparazione beta. Diagnosi: `prisma migrate diff` contro il DB di produzione restituisce l'intero script create-everything; `migrate status` = 3 migration pending, nessuna applicata. |
| 2026-06-10 | Primo tentativo di fix: un `migrate deploy` riesce ma su **bersaglio sbagliato** — la connection string era stata presa dal widget "Connect" del dashboard Neon, che era posizionato su un altro progetto/database. Il DB di produzione resta vuoto. |
| 2026-06-11 | Fix definitivo: `migrate deploy` mirato sull'host di produzione verificato con gate read-only preliminari (vedi §Verifiche). Probe end-to-end di registrazione → **200**. Incidente chiuso. |

## Causa

1. **Causa diretta**: il database Neon agganciato alle env Vercel Production
   dal 25 aprile non ha mai ricevuto `prisma migrate deploy`. Ogni query
   (`db.user.findUnique` in testa) falliva con "table does not exist" → il
   catch-all della route restituiva 500.
2. **Causa di processo**: nessun passo della pipeline di deploy applica le
   migration; l'applicazione è manuale e legata a quale URL si ha sottomano.
   Con più progetti Neon/Vercel dai nomi quasi uguali, l'errore di bersaglio
   è questione di tempo (ed è puntualmente successo il 10 giugno).

## Fix applicato (2026-06-11)

Connection string di produzione fornita in un file temporaneo gitignored
(`.env.produrl.tmp`, mai aperto/loggato, consumato solo via `dotenv -e`),
URL diretta derivata rimuovendo `-pooler` dall'host. Pattern dei comandi:

```bash
bun x dotenv -e .env.produrl.tmp -- bash -c 'D="${DATABASE_URL/-pooler/}"; DATABASE_URL="$D" DIRECT_URL="$D" bun x prisma migrate deploy'
```

Host di produzione (verbale): `ep-purple-paper-anqdrn1n-pooler.c-6.us-east-1.aws.neon.tech`
(diretto: stesso host senza `-pooler`). Applicate in ordine:
`20260425185631_init`, `20260425190043_add_evening_review_fields`,
`20260609154100_add_consent_fields`.

## Verifiche (gate, tutte verdi)

| # | Gate | Esito |
|---|---|---|
| 1 | Host del file temporaneo ≠ dev (`billowing-bird`) | ✅ `ep-purple-paper-anqdrn1n…` |
| 2 | `migrate diff` pre-fix = create-everything puro | ✅ 24 `CREATE TABLE`, 16 index, 27 `ALTER` **tutti e soli** `ADD CONSTRAINT … FOREIGN KEY` (parte standard dello script di creazione), zero `DROP` |
| 3 | `migrate status` pre-fix | ✅ 3 pending, 0 applicate, `_prisma_migrations` assente |
| 4 | Test runtime `DIRECT_URL` (locale, env Vercel simulate) | ✅ il client **non** la richiede (vedi sotto) |
| 5 | `migrate status` post-fix | ✅ "Database schema is up to date!" |
| 6 | re-`diff` post-fix | ✅ `-- This is an empty migration.` |
| 7 | Probe E2E `POST /api/auth/register` | ✅ **HTTP 200**, utente creato con auto-login cookie |

**Nota di verbale**: la diagnosi del 10/06 riportava "22 tabelle"; il numero
esatto è **24** (la migration `init` crea 24 tabelle, lo schema ha 24 modelli,
il diff li elencava tutti e 24 — il conteggio combacia su tutte e tre le
fonti; il 22 era una svista del verbale, non un'anomalia del bersaglio).

## DIRECT_URL: runtime vs CLI

`prisma/schema.prisma` dichiara `directUrl = env("DIRECT_URL")`, ma su Vercel
`DIRECT_URL` non esiste. Test empirico (Prisma 6, `new PrismaClient()` come in
`src/lib/db.ts`, `DATABASE_URL` fittizia, `DIRECT_URL` assente):

- constructor **OK**, prima query fallisce **solo** per connessione all'host
  fittizio (P1001), nessun "Environment variable not found: DIRECT_URL".

Conclusione: **il runtime ignora `directUrl`** (è consumata solo dalla CLI:
`migrate`, `db pull`, ecc.). L'assenza di `DIRECT_URL` su Vercel **non** è
causa di errori a runtime e non richiede redeploy urgente. Diventa però un
prerequisito il giorno in cui `prisma migrate deploy` entra in pipeline
(raccomandazione 2). Nota a margine: `src/lib/db-edge.ts` usa l'adapter Neon
con `connectionString` esplicita, per cui `directUrl` è irrilevante anche lì.

## Raccomandazioni

1. **Aggiungere `DIRECT_URL` alle env Vercel (Production)** — valore: la
   connection string di produzione con host **diretto** (senza `-pooler`).
   Non urgente per il runtime (vedi sopra), ma prerequisito della
   raccomandazione 2 e rete di sicurezza per qualunque comando CLI Prisma
   eseguito contro la produzione.

2. **`prisma migrate deploy` nella pipeline di deploy** — PROPOSTA, **non
   applicata**. Diff su `package.json`:

   ```diff
   -    "build": "prisma generate && next build && cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/",
   +    "build": "prisma generate && prisma migrate deploy && next build && cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/",
   ```

   Caveat da decidere con Antonio prima di applicare:
   - richiede `DIRECT_URL` (e `DATABASE_URL`) nelle env Vercel del relativo
     ambiente — senza, il build fallisce;
   - su Vercel lo stesso script `build` gira anche per i **preview deploy**:
     così com'è applicherebbe le migration al DB puntato dalle env Preview.
     Alternativa più chirurgica: script wrapper che esegue `migrate deploy`
     solo se `VERCEL_ENV=production`.

3. **Consolidare i progetti Vercel/Neon.** I nomi attuali
   ("shadow-production" vs "shadow" / "shadow production") sono una trappola:
   è esattamente così che il deploy del 10/06 è finito sul bersaglio
   sbagliato (widget Connect posizionato sul progetto sbagliato). Un solo
   progetto Neon per la produzione, naming univoco, eliminare/archiviare i
   database orfani.

4. **Ruotare la password del DB Neon di produzione** ora che l'incidente è
   chiuso: la connection string è circolata (file temporanei, clipboard,
   chat di lavoro). Rotazione dal dashboard Neon → aggiornare **solo** le env
   Vercel (`DATABASE_URL` + `DIRECT_URL`). Nessun file locale da aggiornare,
   perché (punto 5)…

5. **Documentare la convenzione env**: `.env` / `.env.local` = **solo dev**
   (host `ep-billowing-bird…`). La produzione vive **solo** nelle env Vercel.
   Nessun file locale deve mai contenere la URL di produzione; per interventi
   straordinari usare un file temporaneo gitignored e distruggerlo a fine
   intervento (come fatto qui).

## Cleanup post-incidente

- [ ] **Eliminare l'utente probe** creato dal test E2E:
      `probe-prod@example.com` (id `cmq8nfct90000l404tmtwh1jl`), con i record
      collegati creati dalla route (`Settings`, `UserPattern`, `UserProfile`).
- [x] `.env.produrl.tmp` eliminato e riga rimossa da `.gitignore` (2026-06-11).
- [ ] Rotazione password Neon (raccomandazione 4) — in carico a Giulio.
