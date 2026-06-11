# Task 25 — Entitlements: piani FREE / PRO / MAX

> Approvato il 2026-06-11 (ultraplan). Prerequisito di gating per Task 26 (Google → PRO+)
> e Task 27 (voce/body doubling → MAX). Billing (Stripe/Play) esplicitamente FUORI scope.

## Decisioni

- Campo `User.plan String @default("FREE")` — valori `'FREE' | 'PRO' | 'MAX'`.
- Il piano si legge **dal DB**, mai dal JWT (storia documentata di JWT stale con il
  service worker, vedi `src/middleware.ts:54-93`). Nessuna modifica a `src/lib/auth.ts`
  né a `src/types/next-auth.d.ts` in v1.
- Il client riceve il piano da `GET /api/google/status` (Task 26); finché non esiste,
  nessuna superficie client ne ha bisogno.
- In beta i piani li assegna Antonio a mano via script.

## Schema

Migration additiva `add_user_plan`:

```prisma
model User {
  // ...campi esistenti...
  plan String @default("FREE")
}
```

## File

- `src/lib/entitlements.ts`
  - `export type Plan = 'FREE' | 'PRO' | 'MAX'`
  - `const PLAN_ORDER: Record<Plan, number> = { FREE: 0, PRO: 1, MAX: 2 }`
  - `parsePlan(raw: string): Plan` — valori sconosciuti → `FREE` (fail-closed)
  - `hasPlan(plan: Plan, min: Plan): boolean` — pura
  - `getPlan(userId: string): Promise<Plan>` — `db.user.findUnique` → `parsePlan`
  - `requirePlan(userId: string, min: Plan): Promise<NextResponse | null>` —
    `null` se ok; altrimenti `403` JSON:
    `{ error: 'Questa funzione richiede il piano <min>.', code: 'plan_required', requiredPlan, currentPlan }`
    Uso nelle route: `const denied = await requirePlan(userId, 'PRO'); if (denied) return denied;`
  - `const FEATURE_MIN_PLAN = { google_calendar: 'PRO', gmail_ingest: 'PRO', voice_body_doubling: 'MAX' } as const`
- `src/lib/entitlements.test.ts` — unit su `hasPlan`/`parsePlan` (gerarchia, valori sporchi, fail-closed).
- `scripts/set-plan.ts` — `bun scripts/set-plan.ts --email <email> --plan <FREE|PRO|MAX>`;
  stampa piano prima/dopo; errore esplicito su email inesistente o piano invalido.

## Acceptance

- [ ] `bun run build` + `bun run test` verdi.
- [ ] Migration applicata; utenti esistenti hanno `plan='FREE'`.
- [ ] `bun scripts/set-plan.ts --email x --plan PRO` aggiorna il DB; con piano invalido esce con errore.
- [ ] Unit: utente FREE su feature PRO → 403 con shape `{code:'plan_required'}` e copy italiano.
