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

## Decisioni tecniche emerse durante Slice 3

- **`normalize` e' l'unico meccanismo di resume `paused -> active`.** L'orchestrator (`src/lib/chat/orchestrator.ts:213-216`) aggiorna `lastTurnAt` sui thread esistenti ma NON tocca `state`: un thread `paused` che riceve un turn resta `paused` finche' la successiva `GET /api/chat/active-thread` chiama `normalizeThreadState`, che lo riattiva via il ramo `inside_window_active`. Coperto dall'unit test C11. Implicazione: future feature che leggono `evening_review` thread (Slice 6 piano del giorno dopo, Slice 7 chiusura atomica) DEVONO chiamare `normalize` prima di assumere lo state corrente, oppure delegare il riconoscimento "thread vivo" al passaggio per `active-thread`. Non aggiungere altri write su `state` senza coordinare con `normalize`.

- **UI `ChatView` mostrata con `userId` stale anche senza sessione NextAuth attiva.** Trovato durante test E2E Slice 3: utente con `next-auth.session-token` scaduto/assente continua a vedere `ChatView` (chat) invece di `TasksApp` (login screen) perche' `src/app/page.tsx:9` legge `userId` da Zustand store, non da NextAuth session. Le call API ricevono 401 ma la UI le ignora silenziosamente. Workaround dev: DevTools Clear site data + reload. Mini-task post-slice: aggiungere effect in `HomePage` che pulisce Zustand `userId` quando `useSession()` ritorna `unauthenticated`.

- **Flow di registrazione/login non offre recupero password ne' magic link.** L'utente che dimentica le credenziali del proprio account dev e' tagliato fuori. NextAuth config (`src/lib/auth.ts`) ha solo `CredentialsProvider`; nessun `EmailProvider` per magic link, nessuna route per "password reset". Da valutare se omissione di scope (UI di onboarding minimal v1) o bug. Decisione esplicita prima della beta.

- **`morning_checkin` orfano blocca anche la lazy archive `evening_review`.** Manifestazione concreta del bug "morning_checkin sticky" gia' flaggato in Slice 2: durante test E2E case 4 della lazy archive evening_review, il thread non veniva archiviato. Causa tecnica: la query allargata di `route.ts:162-172` (`OR: [{state:'active'}, {state:'paused', mode:'evening_review'}]`, `orderBy lastTurnAt desc`, `take:1`) pesca il thread non-evening piu' recente (morning_checkin orfano da signup, `lastTurnAt` minuti fa) invece dell'evening_review orfano (`lastTurnAt` 12h fa). Il guard `if (thread.mode === 'evening_review')` non scatta, `normalize` non viene chiamato, l'evening_review resta `paused`. Limite intrinseco dell'architettura "scope stretto su evening_review" decisa in pianificazione, non bug della logica di Slice 3. Workaround dev usato: archive manuale del morning_checkin via Studio prima di rilanciare il test. **Rinforza priorita' del mini-task "lazy archive generica"**: oggi non e' piu' solo "rumore di sviluppo" come pensavamo a fine Slice 2, e' un blocker funzionale dei test E2E della feature stessa.

- **Prisma Studio senza `dotenv` flag punta a branch Neon diverso (riconfermato).** Gia' documentato in Slice 2, riconfermato in modo esplicito durante recupero dello `User.id` per i test E2E: cuid recuperato da Studio "nudo" (`bunx prisma studio`) non esiste nel DB visto da `bun run` (= stesso DB dell'app a localhost:3000). Sintomo: "User not found" durante seed. Mini-task 30 secondi: aggiungere a `package.json` `"prisma:studio": "dotenv -e .env.local -- prisma studio"` per uniformare. Stesso pattern del `prisma:prod` gia' menzionato nelle note Slice 1.
