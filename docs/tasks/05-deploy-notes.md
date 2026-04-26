# Slice 1 — note per il deploy in produzione (branch Neon main)

Al primo deploy della beta serve eseguire questa sequenza una sola volta:

1. Aggiungere uno script `prisma:prod` in `package.json`: `"prisma:prod": "dotenv -e .env -- prisma"` (oppure usare le env Vercel direttamente in CI).
2. Eseguire `bun run prisma:prod migrate resolve --applied 0_init`.
   - Importante: la migration `0_init` deve corrispondere esattamente allo schema attuale di prod. Se prod ha avuto modifiche via `db push` non riflesse in `schema.prisma`, il resolve fallirà. Verificare con `prisma migrate diff` prima.
3. Eseguire `bun run prisma:prod migrate deploy` → applica solo le migration successive (es. `add_evening_review_fields`), lasciando intatto il resto.

NON usare `migrate dev` su prod: resetta il DB.

## Issues pre-esistenti emersi durante Slice 1 (da gestire fuori scope)

- TypeScript validation skipped da `next build`. Verificare se in `next.config` (o `tsconfig`, o build script) c'è `ignoreBuildErrors` o equivalente. Implicazione: errori TS possono raggiungere prod senza essere visti. Mini-task dedicato.
- `src/app/tasks/page.tsx:2355` errore TS2367 su comparison `"active_strict"` vs unione di stati che non lo include. Pre-esistente, va sistemato dentro Task 2 ROADMAP (split del file).
- `bun run build` fallisce su Windows allo step `cp -r`. Da indagare se è davvero `-r` vs `-R` o qualcos'altro (es. `.next/standalone` non esistente in dev). Mini-task dedicato.
- Inconsistenza tra output di `tsc` (1 errore stampato) e exit code (0). Probabilmente la pipe `| tail` maschera l'exit di `tsc`. Da verificare se vogliamo un comando di validazione tipi affidabile per il dev workflow.
- `next-env.d.ts` oscilla tra `import "./.next/dev/types/routes.d.ts"` (dopo `next dev`) e `"./.next/types/routes.d.ts"` (dopo `next build`), generando rumore in `git status`. Soluzione standard Next moderno: aggiungere `next-env.d.ts` a `.gitignore`. Mini-task dedicato.

## Decisioni tecniche emerse durante Slice 2

- **Timezone — opzione (i) `?clientTime=HH:MM` + `?clientDate=YYYY-MM-DD`.** Il server Vercel gira UTC, `new Date(nowMs).getHours()` interpreterebbe in UTC per utenti non-UTC. Adottata la via semantica: il client comunica i suoi valori temporali precostruiti, server failsafe se mancanti/malformati. `isInsideEveningWindow` riceve tre stringhe `HH:MM` simmetriche. Da rivedere in Slice 3 se la lazy archive richiedera' calcolo TZ server-side (probabile aggiunta `Settings.timezone`).

- **Onboarding gating: single source of truth via middleware.** `computeEveningReview` non controlla `UserProfile.onboardingComplete`. Si fida del middleware/layout. Se in futuro un entry point bypassa il middleware (webview, deep link), un utente con Settings popolato + onboarding incompleto vedrebbe la card. Scelta consapevole, ridiscutere se il caso emerge.

- **Setup test runner Vitest — issue.** `window.ts` e' la prima funzione pura del progetto (estremi finestra, wrap-around, malformati): meriterebbe unit test. Test runner non installato. Solo test manuali per ora. Da fix prima di Slice 5 (molta logica pura nuova in conversazione per-entry).

- **Thread `morning_checkin` resta `active` per ore — issue.** Trovato durante test Slice 2: thread checkin mattutino con `state='active'` dalla mattina blocca il guard di rehydration di Task 3. Aggirato manualmente con `scripts/archive-active-non-evening.ts`. Da fix in Slice 3 (lazy archive generica per thread non-evening) o task dedicato.

- **Prisma CLI vs Bun caricano env file diversi.** Prisma CLI (`studio`, `migrate`) carica solo `.env`, ignora `.env.local`. Bun carica entrambi (`.env.local` ha priorita'). Se `DATABASE_URL` punta a branch Neon diversi, sintomo: "column does not exist" in Studio mentre script funzionano. Workaround: `bunx dotenv -e .env.local -- prisma <comando>`. Pattern gia' usato in `prisma:prod`, da estendere a `prisma:studio` o documentare in README.
