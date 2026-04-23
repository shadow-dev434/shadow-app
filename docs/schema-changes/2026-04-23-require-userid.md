# 2026-04-23 — Require userId on user-owned models

Tracciabilità dei cambi schema applicati al DB Postgres Neon nel Task 1
(Data Isolation). Il repo usa `prisma db push` senza `prisma migrate`, quindi
non c'è una migration versionata — questo file è il solo record testuale dei
cambi applicati.

## Contesto

Prima di questo task le API routes non filtravano per `userId`, e alcuni
model user-owned avevano `userId` opzionale (o assente). Per rendere sicuro
il filtro cross-user è stato reso `userId` obbligatorio su tutti i model
user-owned, con `onDelete: Cascade` (cancellare un utente cancella i suoi
dati — comportamento atteso in un'app mono-tenant per utente).

## Cambi applicati

### Model con `userId` già presente ma opzionale → ora obbligatorio

| Model         | userId prima      | userId dopo       | onDelete prima | onDelete dopo |
|---------------|-------------------|-------------------|----------------|---------------|
| `Task`        | `String?`         | `String`          | `SetNull`      | `Cascade`     |
| `UserPattern` | `String?`         | `String`          | `SetNull`      | `Cascade`     |
| `Settings`    | `String?`         | `String`          | `SetNull`      | `Cascade`     |

### Model senza `userId` → aggiunto obbligatorio

| Model       | userId prima | userId dopo | Unique constraint prima | Unique constraint dopo    |
|-------------|--------------|-------------|-------------------------|---------------------------|
| `DailyPlan` | _assente_    | `String`    | `@unique(date)`         | `@@unique([userId, date])` |
| `Review`    | _assente_    | `String`    | `@unique(date)`         | `@@unique([userId, date])` |

> Nota: `date @unique` era un bug latente. Impediva a due utenti diversi di
> avere un `DailyPlan` o `Review` per lo stesso giorno. Risolto insieme
> all'isolation.

### Relazione inversa su `User`

Aggiunte in `model User`:

```prisma
dailyPlans  DailyPlan[]
reviews     Review[]
```

## Sequenza di esecuzione sul DB

Eseguita manualmente da Antonio contro il DB di produzione (Neon, unico env):

1. `bunx tsx prisma/scripts/backfill-userid.ts`
   - Upsert utente placeholder `orphan-data@shadow.local`
   - `ALTER TABLE "DailyPlan" ADD COLUMN IF NOT EXISTS "userId" TEXT`
   - `ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "userId" TEXT`
   - `UPDATE "<table>" SET "userId" = <placeholder> WHERE "userId" IS NULL`
     per `Task`, `UserPattern`, `Settings`, `DailyPlan`, `Review`
2. `bunx prisma studio` — verifica manuale che nessun record abbia `userId`
   nullo in nessuna delle 5 tabelle
3. `bunx prisma db push` — Prisma applica:
   - `ALTER COLUMN "userId" SET NOT NULL` sulle 5 tabelle
   - Drop dell'indice `date @unique` su DailyPlan e Review, creazione di
     `@@unique([userId, date])`
   - Foreign key `onDelete CASCADE` su `Task`, `UserPattern`, `Settings`
     (aggiornamento rispetto al precedente `SET NULL`)
   - Foreign key `userId → User.id onDelete CASCADE` su `DailyPlan` e
     `Review` (nuova)

## Model non modificati

Questi model avevano già `userId String` obbligatorio con `onDelete: Cascade`
e non sono stati toccati:

`Contact`, `Notification`, `Streak`, `CalendarToken`, `PushSubscription`,
`UserProfile`, `StrictModeSession`, `AdaptiveProfile`, `LearningSignal`,
`MicroFeedback`, `UserMemory`, `ChatThread`.

## Rollback

Se il push schema fallisce o introduce regressioni, il rollback richiede:

1. Ripristinare lo schema precedente (git revert di questo commit su
   `prisma/schema.prisma`)
2. `bunx prisma db push --accept-data-loss` per riportare il DB allo stato
   precedente (torna a `userId?` nullable su Task/UserPattern/Settings e
   droppa la colonna `userId` su DailyPlan/Review — **attenzione: perde
   l'associazione** appena creata)
3. Eventuale cancellazione manuale dell'utente placeholder via Prisma Studio

Meglio preservare il placeholder anche dopo rollback: l'utente è innocuo e
serve come evidenza dei dati pre-isolation.
