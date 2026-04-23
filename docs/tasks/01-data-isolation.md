# Task 1 — Data Isolation

> Primo task strutturale. **Blocca tutti gli altri finché non è chiuso e deployato.**

---

## Problema

Le API routes che gestiscono `Task`, `DailyPlan`, `Review`, `Notification`,
`Streak`, `Contact`, `Settings` e altre **non filtrano per `userId`**.
Qualunque utente autenticato può leggere e modificare i dati di altri utenti.

### Esempi nel codice attuale

```typescript
// src/app/api/tasks/route.ts — GET /api/tasks
const tasks = await db.task.findMany({
  where,  // where non contiene userId
  orderBy: { priorityScore: 'desc' },
});
```

```typescript
// src/app/api/tasks/route.ts — POST /api/tasks
const task = await db.task.create({
  data: {
    title: body.title,
    // userId: MANCANTE. Il task viene creato orfano.
  },
});
```

```typescript
// src/app/api/daily-plan/route.ts
const tasks = await db.task.findMany({
  where: { status: { notIn: ['completed', 'abandoned'] } },
  // nessun filtro userId
});
```

Paradossalmente **lo schema Prisma ha già `userId` nel model `Task`** —
è il layer API che non lo usa.

---

## Obiettivo

1. Ogni route autenticata estrae `userId` dalla session server-side
2. Ogni query filtra per `userId`
3. Ogni `create` imposta `userId`
4. Richieste non autenticate → 401
5. Tentativi cross-user → 404 (no info leak sulla presenza della risorsa)
6. `userId` diventa obbligatorio nello schema `Task` (attualmente potrebbe essere opzionale)
7. I task orfani esistenti vengono migrati a un utente placeholder

---

## Piano di esecuzione

### Step 1 — Helper `requireSession`

Creare `src/lib/auth-guard.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { NextResponse } from 'next/server';

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null as never,
    };
  }
  return { error: null, userId: session.user.id as string };
}
```

Verificare che `authOptions` esponga correttamente `session.user.id`. Se non
lo fa, estendere il callback `session` in `src/lib/auth.ts`:

```typescript
callbacks: {
  async session({ session, token }) {
    if (session.user && token.sub) {
      session.user.id = token.sub;
    }
    return session;
  },
  // ...
}
```

E aggiungere il tipo in `src/types/next-auth.d.ts` se non esiste già:

```typescript
import 'next-auth';
declare module 'next-auth' {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null; image?: string | null };
  }
}
```

### Step 2 — Applicare `requireSession` a TUTTE le route

Per ogni file elencato qui sotto:

1. Importare `requireSession`
2. All'inizio di ogni handler (`GET`, `POST`, `PATCH`, `DELETE`, ecc.):
   ```typescript
   const { error, userId } = await requireSession();
   if (error) return error;
   ```
3. Aggiungere `userId` a **ogni** `where` clause
4. Aggiungere `userId` a **ogni** `data` di `create`
5. Per route con `[id]` dinamico: verificare che la risorsa appartenga a
   `userId`, altrimenti 404

**Route da modificare:**

- `src/app/api/tasks/route.ts` (GET, POST)
- `src/app/api/tasks/[id]/route.ts` (GET, PATCH, DELETE — se esiste)
- `src/app/api/daily-plan/route.ts` (tutte)
- `src/app/api/decompose/route.ts` (tutte)
- `src/app/api/review/route.ts` (tutte)
- `src/app/api/notifications/route.ts` (tutte)
- `src/app/api/streaks/route.ts` (tutte)
- `src/app/api/contacts/route.ts` (tutte)
- `src/app/api/settings/route.ts` (tutte)
- `src/app/api/export/route.ts` (tutte)
- `src/app/api/calendar/route.ts` (tutte)
- `src/app/api/strict-mode/route.ts` (tutte)
- `src/app/api/patterns/route.ts` (tutte)
- `src/app/api/onboarding/route.ts` (tutte)
- `src/app/api/push-subscription/route.ts` (tutte)
- `src/app/api/memory/route.ts` (tutte)
- `src/app/api/learning-signal/route.ts` (tutte)
- `src/app/api/micro-feedback/route.ts` (tutte)
- `src/app/api/adaptive-profile/route.ts` (tutte)
- `src/app/api/profile/route.ts` (tutte)
- `src/app/api/ai-assistant/route.ts` — **attenzione**: attualmente prende
  `userId` dal body, sostituirlo con quello da session
- `src/app/api/ai-classify/route.ts` (tutte)

**Non toccare:**
- `src/app/api/auth/*` (gestito da NextAuth)
- Eventuali route pubbliche di health check

### Step 3 — Backfill dei task orfani + migration

**Prima** di rendere `userId` obbligatorio, migrare i dati esistenti.

1. Creare `prisma/scripts/backfill-task-userid.ts`:
   ```typescript
   import { PrismaClient } from '@prisma/client';
   const db = new PrismaClient();

   async function main() {
     // Trova o crea un utente placeholder per task orfani
     const orphan = await db.user.upsert({
       where: { email: 'orphan-data@shadow.local' },
       update: {},
       create: {
         email: 'orphan-data@shadow.local',
         name: 'Orphan data (pre-isolation)',
       },
     });

     // Conta i task senza userId
     const orphanTasks = await db.task.findMany({
       where: { userId: null },
       select: { id: true },
     });

     console.log(`Trovati ${orphanTasks.length} task orfani`);

     if (orphanTasks.length > 0) {
       await db.task.updateMany({
         where: { userId: null },
         data: { userId: orphan.id },
       });
       console.log(`Assegnati a utente placeholder ${orphan.id}`);
     }
   }

   main().finally(() => db.$disconnect());
   ```

2. Eseguire il backfill: `bunx tsx prisma/scripts/backfill-task-userid.ts`

3. **Verificare** che non ci siano più task orfani:
   ```bash
   bunx prisma studio
   # filtrare Task dove userId is null — deve essere 0
   ```

4. Modificare `prisma/schema.prisma`:
   ```prisma
   model Task {
     // ...
     userId String        // rimosso `?`
     user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
     // prima: onDelete: SetNull
   }
   ```

5. Generare migration: `bunx prisma migrate dev --name require_task_userid`

6. Ripetere per altri model che dovrebbero avere `userId` obbligatorio
   (DailyPlan, Review, Notification, Streak, Contact, Settings, UserMemory,
   AdaptiveProfile, StrictModeSession, LearningSignal, …) — solo **se il
   campo esiste già opzionale**; se non c'è proprio, aggiungerlo.

### Step 4 — Pulizia client-side

Cercare nel client ogni chiamata che passa `userId` nel body o nella query:

```bash
grep -rn "userId" src/app/page.tsx src/store/ src/features/ 2>/dev/null | grep -v "session" | grep -v "//"
```

Rimuovere: il server prende `userId` da session, il client non deve mandarlo.

Nello specifico controllare:
- `fetch('/api/ai-assistant', { body: JSON.stringify({ userId, ... }) })`
- chiamate con `?userId=...` in query string

### Step 5 — Build + commit

```bash
bun run lint
bun run build   # deve passare
git add -A
git commit -m "fix(security): enforce userId isolation on all authenticated routes"
```

**Fermarsi qui.** Il push lo faccio io.

---

## Acceptance test (MANUALI — li faccio io dopo il push)

### Test 1 — Isolation cross-user

1. Deploy su Vercel
2. Aprire finestra Incognito 1 → registrare utente A (`a@test.com`) → creare 3 task
3. Aprire finestra Incognito 2 → registrare utente B (`b@test.com`) → creare 2 task
4. Utente A: `GET /api/tasks` → deve vedere solo i suoi 3 task
5. Utente B: `GET /api/tasks` → deve vedere solo i suoi 2 task

**PASS**: ciascuno vede solo i propri.
**FAIL**: se A vede 5 task → isolation rotta.

### Test 2 — Tentativo cross-user diretto

1. Da utente A, annotare l'`id` di un suo task (es. via Network tab)
2. Da utente B (stessa finestra Incognito 2), fare:
   ```
   PATCH /api/tasks/{id-di-A}
   body: { "title": "HACKED" }
   ```
3. Risposta attesa: **404** (preferibile) o **403**
4. Da utente A, ricaricare: il titolo del task **non deve** essere "HACKED"

### Test 3 — Non autenticato

1. Logout
2. `GET /api/tasks` → **401 Unauthorized**
3. `POST /api/tasks` con body valido → **401 Unauthorized**

### Test 4 — Nessuna route dimenticata

```bash
grep -L "requireSession\|session.user.id" src/app/api/*/route.ts src/app/api/*/*/route.ts 2>/dev/null | grep -v "/auth/"
```

Output atteso: **vuoto**. Se c'è qualche file elencato, è una route non
protetta — aprirla e aggiungere `requireSession`.

### Test 5 — Build + migration pulite

```bash
bun run build                  # deve finire senza errori
bunx prisma migrate status     # deve dire "Database schema is up to date"
```

---

## Deliverable finale (richiesto a Claude Code)

Al termine del task, Claude Code deve restituire:

1. **Lista file modificati/creati/cancellati** (una riga per file + cosa è cambiato)
2. **Output di `bun run build`** (solo righe rilevanti se OK; intero se errori)
3. **Output di `bunx prisma migrate status`**
4. **Conteggio route protette vs totali** (es. "23/23 route applicano requireSession")
5. **Eventuali follow-up**: route ambigue, decisioni prese, `// TODO: decidere`
