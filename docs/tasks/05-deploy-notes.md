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

## Decisioni tecniche emerse durante Slice 4

- **Bug `eveningReviewShouldStart` mai resettato (fixato in Slice 4).** Il flag rimaneva `true` dopo il click sul button "Inizia la review", la card non spariva, UX percepita "button morto". Falso positivo di debugging: ispezionare `btn.onclick` in DevTools mostra `noop$1` ma NON indica handler mancante — React usa event delegation sul root, quindi la proprieta' DOM `onclick` e' sempre noop indipendentemente dall'handler React. Fix applicato in `src/features/chat/ChatView.tsx:273-277`: aggiunta `setEveningReviewShouldStart(false)` come prima azione di `handleStartEveningReview`, prima di `setMode('evening_review')`.

- **Edge case `eveningReviewShouldStart` mount-only.** Il flag viene settato a `true` solo dal fetch `GET /api/chat/active-thread` dentro `useEffect([])` di `ChatView` (mount-only). Se l'utente e' fuori finestra serale al mount e poi entra in finestra senza fare refresh della pagina, il flag non si riarma e la card non compare. Non blocker V1 (tipico flusso real: utente apre l'app gia' dentro la finestra), edge case da tracciare per V1.1 (es. polling leggero o re-fetch quando il client cross-a la soglia HH:MM configurata).

- **Push automatico al wake-up serale: gap di scoping.** La spec di prodotto (`docs/tasks/05-review-serale-spec.md`, sezione "Entry point e wake-up") prevede che la review parta automaticamente quando si entra nella finestra serale, non solo via button. Il piano slicing (Slice 2/3/4) non assegna esplicitamente questa feature ad alcuna slice. Il flusso V1 attuale richiede click sul button **piu'** un primo `userMessage` da parte dell'utente per scatenare l'apertura del modello (Slice 4 non implementa kickoff turn senza userMessage). Affrontare in V1.1 o slice dedicata pre-beta.

- **Few-shot leakage in `CORE_IDENTITY` (mode `general`).** In `src/lib/chat/prompts.ts:178-191` `getModePrompt('general')` ritorna stringa vuota: il system prompt per mode `general` e' di fatto solo `CORE_IDENTITY`, che alle linee 45-47 contiene un esempio inline `Come va stamattina? [[QR: 1 - a terra | 2 - scarico | 3 - ok | 4 - bene | 5 - sul pezzo]]`. Il modello replica quel template come few-shot quando il `userMessage` e' povero (es. "pronto", "ciao"), producendo formula `morning_checkin` mentre l'utente si aspettava risposta neutra. Non tocca Slice 4 (`evening_review` ha `EVENING_REVIEW_PROMPT` dedicato che non leakage). Candidato per slice dedicata di prompt-hardening: rendere generici gli esempi in `CORE_IDENTITY` o aggiungere un prompt esplicito per `general` che vieta il pattern check-in.

- **Bug `postponedCount` vs `avoidanceCount`.** Lo schema reale e' `Task.avoidanceCount`, il piano Slice 4 e diverse bozze di codice usavano `postponedCount`. TypeScript NON cattura mismatch di campi Prisma in `findMany({ select: {...} })` perche' i tipi del Prisma client sono generati su tutti i campi dichiarati, non sui field name liberi. Mitigazione adottata: leggere `prisma/schema.prisma` prima di scrivere codice che referenzia campi del modello. Memory salvata in Claude Code (`feedback_read_schema_before_prisma_select`). Da considerare per slice future: lint custom o snapshot test sui select Prisma piu' usati.

- **Pattern operativo "thread orfano blocca giornata".** Test E2E falliti durante Slice 4 hanno lasciato `ChatThread` con `state='active'` o `'paused'` che il guard di `GET /api/chat/active-thread` (`route.ts:164-174`) pesca come thread corrente, bloccando il triage di nuove review (la card non compare perche' `activeThread !== null` ramo). Mitigato durante Slice 4 con script ad-hoc `scripts/cleanup-blocker-thread.ts` (non committato, in `.gitignore`). Considerare uno script `reset-e2e-state` standardizzato e committato per slice future, idealmente parametrizzato per userId.

- **Quick replies generati dal modello nonostante divieto nel prompt `evening_review`.** Il `EVENING_REVIEW_PROMPT` (`src/lib/chat/prompts.ts:124-160`) non contiene una istruzione esplicita "niente QR" ma neanche esempi positivi di apertura senza QR; tuttavia, anche con divieto esplicito, il modello tende a produrre `[[QR: ...]]` al primo turn per inerzia da `CORE_IDENTITY`. Pattern noto LLM: divieti negativi meno efficaci di esempi positivi. Da rinforzare in V1.1 con esempi few-shot di apertura senza QR nel `EVENING_REVIEW_PROMPT`, o con post-processing server-side che strippa `[[QR:...]]` in mode `evening_review` prima del salvataggio del messaggio.

- **`wasStrict` in `src/app/tasks/page.tsx` degrada a `=== 'active_soft'`.** Errore TS2367 preesistente (gia' flaggato nelle note Slice 1 a `page.tsx:2355`), arricchito da Slice 4 ma non causato. Da risolvere nel split del file (Task 2 ROADMAP).

- **`bun run build` fallisce su Windows con EPERM su `query_engine-windows.dll.node`.** File locking di Prisma engine quando `bun run dev` o `bunx prisma studio` sono attivi in un altro terminale. Workaround: spegnere dev server e Studio prima di `build`. Issue Windows-specific, non blocker per Vercel (Linux). Mini-task: documentare in README sezione "troubleshooting Windows".

- **`vite-tsconfig-paths` potenzialmente ridondante.** Vite 6+ supporta `resolve.tsconfigPaths: true` nativamente. La dipendenza esterna potrebbe essere rimossa se Vitest config viene aggiornata. Mini-task pulizia futura, non blocker.

- **Bug "asimmetria di formato modeContext task originali vs added" (fixato in Slice 4).** La funzione `buildEveningReviewModeContext` (`src/lib/chat/orchestrator.ts:401-449`) produceva due formati diversi nelle righe candidate del prompt: task originali in pattern strutturato `reason=<deadline|carryover|new>, deadline=<...>, avoidance=<...>`, task added in prosa libera `aggiunto su tua richiesta, deadline=<...>, avoidance=<...>`. Pattern LLM noto: discontinuita' di formato implica discontinuita' semantica. Sintomo osservato in V5 E2E: dopo re-add posizionale di D in `candidateTaskIds` (via rimozione da `excludedTaskIds`) + aggiunta di E in `addedTaskIds` al turno V4, il modello a V5 citava verbalmente solo 3 task su 4 (omettendo E) pur avendo nel system prompt tutte e 4 le righe. Il `contextJson` era gia' coerente (`computeEffectiveList` corretto, lista effettiva `[A, B, D, E]`); il bug era nella proiezione testuale del prompt, non nello stato. Fix: uniformato il formato per task added a `reason=added` simmetrico ai task originali (`orchestrator.ts:421-423`). Mitigazione strutturale, non garantisce comportamento del modello al 100% — resta non-determinismo LLM da affrontare in V1.1 con prompt-hardening basato su esempi few-shot positivi piuttosto che regole dichiarative.

## Decisioni tecniche emerse durante Slice 5 commit 2

- **Refactor pre-commit-2 emerso durante l'apertura.** L'introduzione dell'outcome `'cancelled'` di `mark_entry_discussed` (che setta `Task.status='archived'`) ha rivelato il filtro `Task.status notIn ['completed', 'abandoned']` duplicato in 7 punti su 6 file (`orchestrator.ts:349`, `tools.ts:220`, `daily-plan/route.ts:63`, `ai-assistant/route.ts:164/242/417`, `calendar/route.ts:18`). Estendere solo `loadAllNonTerminalTasks` avrebbe creato inconsistenza: il task cancellato in review sparirebbe dal triage serale ma riapparirebbe nel daily plan, nei suggerimenti AI, nel calendario. Refactor anticipato in commit dedicato `d49c33d`: centralizzazione via `terminalTaskStatuses()` factory in `src/lib/types/shadow.ts`, esteso `TaskStatus` con `'archived'` (additivo, zero switch esaustivi nei consumer, verificato via grep). Il refactor e' no-op comportamentale a oggi (nessuno scriveva `archived` prima); diventa funzionale con commit 2. Lezione operativa: quando un cambio di scope rivela duplicazione cross-domain, il refactor di centralizzazione va prima del feature, non in coda — altrimenti la feature porta con se' un debito che si paga in regression test.

- **Factory function vs costante: variance error Prisma.** La centralizzazione e' stata proposta come `const TERMINAL_TASK_STATUSES = [...] as const`, poi come `readonly TerminalTaskStatus[]`. Entrambi rifiutati da Prisma `notIn` con TS2322: `Type 'readonly [...]' is not assignable to type 'string[] | FieldRef | undefined'`. Il filtro Prisma esige `string[]` mutable. Tre opzioni: (i) costante mutable globale → rischio mutazione condivisa cross-test; (ii) spread `[...X]` ai 7 consumer → diluisce la centralizzazione; (iii) factory function `terminalTaskStatuses(): TaskStatus[]` → ogni call site riceve copia fresh, source of truth singola in un solo file, costo runtime trascurabile. Scelta (iii). Memoria salvata in Claude Code (`feedback_prisma_readonly_arrays`). Documentato il fail-path nel JSDoc della factory per evitare che chi legge il codice tenti di "ottimizzare" tornando a una costante senza riconsiderare il problema di variance.

- **Hook post-edit `typecheck-on-ts-edit.js` segnala count residuo, non delta.** Durante l'estensione di `TaskStatus` con `'archived'`, l'hook ha riportato "2 errori TS dopo edit". Verifica via `bunx tsc --noEmit` post-edit + stash check su tree pulito: i 2 errori sono `scripts/debug-rollback-v10.ts:153:7` e `src/app/tasks/page.tsx:2355:23`, identici byte-per-byte sia prima che dopo l'edit. Il count totale post-edit (=2) coincide con il count baseline (=2) — l'hook ha segnalato un falso allarme perche' non distingue "delta nuovi errori" da "count residui pre-esistenti tracciati". Mini-task: rendere l'hook delta-aware (cache del baseline `tsc --noEmit` per file modificati e diff post-edit). Senza questa modifica, in un repo con N errori pre-esistenti tracciati, ogni edit produrra' lo stesso falso allarme; a forza di leggerlo si smette di leggerlo, e quando l'hook segnalera' un vero `N+1` errore introdotto sara' indistinguibile dal rumore. Memoria salvata: `feedback_stash_check_before_claiming_preexisting`.

- **Pattern DB mocking in `tools.test.ts`: primo precedente del progetto.** Slice 1-4 testavano solo pure functions (triage, dates, window). Slice 5 commit 2 introduce per la prima volta executor che chiamano Prisma direttamente (`set_current_entry` per ownership check, `mark_entry_discussed` per i side effects DB), quindi i test richiedono mocking. Pattern adottato: `vi.mock('@/lib/db', () => ({ db: { task: { findFirst: vi.fn(), update: vi.fn() }, learningSignal: { create: vi.fn() } } }))` locale dentro `tools.test.ts` (no helper condiviso, regola "due non uno"); `vi.clearAllMocks()` in `beforeEach` per resettare sia call history sia return values; `mockResolvedValue(null)` esplicito sui test ownership-failure (no affidamento sul default `undefined` di `vi.fn()`); helper locale `mockTaskOwned(id, title)` per ridurre boilerplate sui success path. Quando un secondo file di test richiedera' lo stesso mock di `@/lib/db`, valutare astrazione in helper condiviso — non prima.

- **TODO prompt-side per commit 3-4.** Tre punti predisposti a livello tipi/dati in commit 2 ma che richiedono prompt esplicito per essere consumati dal modello, scope dei commit successivi: (i) `data.action='cursor_already_set'` su `set_current_entry` idempotente — il prompt dovra' istruire il modello che vedendo questa action l'entry e' gia' attiva e deve procedere con la conversazione, non rifare il set (commit 3-4); (ii) `LearningSignal.metadata: '{}'` su outcome `'emotional_skip'` — predisposizione di schema, in commit 4 il friction detector popolera' `metadata: {matched: '<pattern|signal>'}` quando la mossa 3.3 (entry emotivamente carica) viene scatenata; finche' commit 4 non arriva, ogni emotional_skip in history avra' metadata vuoto, comportamento atteso non bug; (iii) `CURRENT_ENTRY_DETAIL.source` esposto nel modeContext ma non ancora consumato dal prompt — commit 3 introdurra' la sezione "Varianti di apertura per source x preferredPromptStyle" della spec Area 3.1 che leggera' questo campo per scegliere la mossa di apertura corretta sulla entry corrente.

## Decisioni tecniche emerse durante Slice 5 commit 3a

- **Spezzamento 3a/3b emerso all'apertura.** Il piano slicing originale (`docs/tasks/05-slices.md:80-94`) era monolitico per Slice 5 main: 4 bullet di scope (varianti apertura, decomposizione, friction emotiva, "si ferma prima del piano") senza breakdown commit-level. Spezzamento in 3a (tool implementation + dati esposti, deterministic gates) e 3b (prompt engineering, qualitative gates) deciso in conversazione di apertura. Razionale: diversa cadenza di iterazione (3a edit→tsc→suite cycle minuti, 3b edit prompt→E2E modello→tweak cycle ore), diversa granularita' di bisect (commit prompt-only vs commit con codice), diverso criterio di chiusura ("suite verde basta" vale solo per 3a — un commit prompt-only non puo' produrre suite verde diversa dal baseline). Mescolare deterministic e qualitative gates nello stesso commit avrebbe rotto la regola "suite verde = pronto a merge".

- **`MIN/MAX_MICRO_STEPS` gia' esistenti in `config.ts:98-99`, niente rename.** Le costanti erano state aggiunte in commit 1 (`38a73c1`); la conversazione di apertura 3a le chiamava `MIN/MAX_DECOMPOSITION_STEPS`. Decisione: riusare i nomi esistenti. Coerenza schema-side (`Task.microSteps` come nome del campo persistito) prevale su coerenza concept-side (decomposition come azione). Rename avrebbe toccato 1 file per cosmetica, niente da guadagnare.

- **`MicroStep` type duplicato pre-esistente.** Definizione byte-per-byte identica in `src/lib/types/shadow.ts:95-100` e `src/store/shadow-store.ts:50-55`. Pre-esistente Slice 5. In commit 3a importato da `shadow.ts` (location primaria, gia' importata da `decomposition-engine.ts`). Duplicato in `shadow-store.ts` lasciato invariato — toccarlo qui sarebbe scope drift. Annotato per dedup futuro in commit dedicato: scegliere una source of truth e re-import nei consumer (`shadow-store.ts`, eventualmente Zustand-side).

- **`crypto.randomUUID()` nativo preferito a `uuid` library.** `uuid` v11 e' nel `package.json` ma `grep "from 'uuid'" src/` restituisce zero risultati. Decisione: import esplicito `import { randomUUID } from 'node:crypto'` invece di adottare un dep mai usato in `src/`. Tre ragioni: (i) zero dipendenze runtime nuove; (ii) native sia in Node che in Bun; (iii) `uuid` potrebbe essere rimosso da `package.json` in futuro (gia' un orphan candidate) e non vogliamo essere primi consumer. Annotato per evitare che chi legge tra mesi tenti di "ottimizzare" reintroducendo la libreria.

- **Validazioni difensive aggiunte oltre il piano.** `executeApproveDecomposition` ha 2 path failure aggiuntivi non nel piano originale: "microSteps item is not an object" e "microSteps item has empty text" (`tools.ts`, executor body). Emersi durante l'edit: `rawSteps.length` gia' validato ma il contenuto degli item (`text` non vuoto, item e' oggetto) e' un'altra dimensione di validazione. Coverage indiretto via `parseMicroSteps` test "filters out non-object/null/primitive entries" — la stessa logica di guard. Decisione di non duplicare coverage tra unit test su helper e unit test su executor: pattern "test al livello giusto, non a tutti i livelli". Se in futuro emergono casi reali in cui la validazione executor diverge da quella helper, aggiungere test unit dedicati.

- **`POSTPONE_PATTERN_THRESHOLD` verificato pre-import.** Costante usata in `buildEveningReviewModeContext` per derivare `recentlyPostponed`. Era gia' presente in `config.ts:25` da Slice 1 (valore 3, coerente con spec Area 2.2 "rimandata 3+ volte"), ma verifica esplicita via grep prima dell'edit di import. Disciplina di non assumere mai presenza di simboli importati senza grep — emergente da pattern del progetto: TS non cattura tutti i mismatch di simboli mancanti se usati come export-name only, e nei refactor di config la lista delle costanti si sposta.

- **Cohabitation 3a→3b senza feature flag.** Tra commit 3a e commit 3b il modello vede `hasExistingMicroSteps` e `recentlyPostponed` nel modeContext senza istruzioni prompt-side che spiegano come usarli. Comportamento atteso: il modello tipicamente li ignora (best case) o fa assumption strane (worst case, raro). Decisione: niente feature flag introdotto. Tre condizioni per questa scelta: (i) sessione di sviluppo locale, niente deploy a tester previsto tra 3a e 3b; (ii) merge sequenziale ravvicinato; (iii) pattern del progetto consolidato ("commit dedicato di refactor PRIMA di commit feature" e' precedente di disciplina coerente). Se mai dovesse esserci un deploy a tester tra 3a e 3b, aggiungere `expose_decomposition_data: false` in `config.ts` come default in 3a, flippare a `true` in 3b. Costo: ~5 righe di config + un `if` nel builder modeContext che salta i due flag se config off. Simmetrico al pattern di feature flag per rollout graduale.

## Decisioni tecniche emerse durante Slice 5 commit 3b

- **Q1/Q2/Q3 pre-decisioni annotate prima del briefing operativo.** Tre domande di prodotto sono state risolte PRIMA di entrare nel piano operativo di 3b: (Q1) struttura della matrice 18 stringhe = 3 source × 3 style × 2 livelli avoidance, fattore 2 = `avoidanceCount >= 3` vs normale; (Q2) trigger linguistico di decomposizione triggera solo conversazione, niente nuovo `LearningSignal.signalType` — i signal di calibration learning sono scope Slice 9; (Q3) criterio chiusura E2E = 4/5 mosse coerenti con style intended, fallimento eventuale documentato esplicitamente nel commit message. Pattern operativo da estendere: annotare pre-decisioni di prodotto prima del briefing operativo previene drift di scope durante l'edit (ognuna delle 3 domande, se non chiusa prima, avrebbe richiesto pause durante l'edit per chiedere conferma). Replicabile per Slice 8 (edge case ADHD, decisioni etiche su override registro) e prompt-hardening V1.1 (decisioni su trigger di re-iteration, criteri di accettazione qualitativa).

- **High-avoidance disambiguato: solo `avoidanceCount >= 3` come trigger, non OR con `recentlyAvoided`.** Bozza iniziale del prompt usava il predicato composto `recentlyAvoided=true OR avoidanceCount>=3`. Verifica del body di `isRecentlyAvoided` in `triage.ts:439-448` ha mostrato che la funzione gia' combina `avoidanceCount>=3 AND lastAvoidedAt entro 24h`: `recentlyAvoided=true` implica per definizione `avoidanceCount>=3`. L'OR era logicamente ridondante ma semanticamente confuso per il modello, che vede 2 campi nel `CURRENT_ENTRY_DETAIL` e potrebbe interpretare l'OR come "due segnali separati" (es. caso `recentlyAvoided=false` + `avoidanceCount=4` per task con `lastAvoidedAt > 24h`). Decisione: trigger nel prompt = SOLO `avoidanceCount >= 3`, predicato singolo. Nota meta-esplicita aggiunta al prompt: "NON usare recentlyAvoided come trigger di scelta variante: usa solo avoidanceCount". Lezione: prompt engineering richiede disambiguazione esplicita di campi che il modello vede; ridondanza logica diventa confusione semantica.

- **CARRYOVER/normale addolciti per evitare replicazione letterale.** Bozza iniziale conteneva 3 esempi `direct/gentle/challenge` con frasi specifiche ("avevamo detto che la rimandavi per capire i dettagli", "era da chiarire", "l'avevamo lasciata in sospeso"). Le prime due sono problematiche: il modello potrebbe replicare letteralmente "per capire i dettagli" o "da chiarire" per task carryover che non hanno avuto quella conversazione specifica, generando frasi false. Esattamente il pattern del bug Slice 4 documentato sopra ("modello replica template come few-shot quando userMessage e' povero"). Riformulati in "avevamo lasciato in sospeso" / "era in sospeso" generici, con meta-istruzione "se ricordi dalla conversazione il motivo specifico riprendilo brevemente, altrimenti formula generica, non inventare motivi non ascoltati". Lezione strutturale: gli esempi few-shot devono essere **strutturalmente** corretti, non **specificamente** corretti — il modello replica struttura E contenuto. Pattern da tenere a mente per qualunque sezione futura del prompt che usa esempi inline.

- **Criterio chiusura tecnico vs funzionale, dichiarato esplicitamente nel commit message.** Commit `122dd44` chiude su criterio tecnico (`bunx tsc --noEmit` delta zero, `bun run test` 122/122 invariata, stash check pulito) MA dichiara nello header "STATUS DI CHIUSURA" che il criterio FUNZIONALE (4/5 scenari E2E coerenti) NON e' stato applicato. Stato di 3b: "pronto per E2E", NON "completato". Razionale: lanciare gli E2E richiede setup live (dev server, GLM API attiva, dati seed in DB Neon) che e' interattivo e fuori dal flow di edit + commit. Costruire un test runner E2E con mock LLM sarebbe scope drift (slice dedicata "E2E framework" non pianificata). Decisione di onesta': committare il prompt subito ma con linguaggio che non maschera il gap. Pattern di onesta' di scope da estendere a future slice prompt-only (es. Slice 8 edge case ADHD avra' tipologie di lavoro simili: codice ammette test deterministici, prompt richiede E2E qualitativi). Prerequisito esplicito: gli E2E di 3b vanno lanciati PRIMA di partire con commit 4 — stratificare commit 4 sopra un 3b non verificato moltiplica il debug se gli E2E falliscono in modo strutturale.

## Issue emersi durante E2E Fase 1 - blocker fixato fuori scope

### fix-bootstrap-evening-window-guard (commit `88e2341`, chore precedente `b3724db`)

- **Sintomo.** Alle 21:57 Rome del 28 aprile 2026, durante setup di Scenario 1 di Fase 1 E2E (Slice 5 commit 3b), apertura app `localhost:3000` triggerava `morning_checkin` invece di renderizzare `EveningReviewCard`. Modello rispondeva "Buongiorno! Come va stamattina?" dentro la finestra serale (20:00-23:00).

- **Diagnosi.** Lookup ChatThread + Settings (script `scripts/lookup-bootstrap-state.ts`) ha confermato scenario (b) puro: niente thread orfano da archiviare in modo strutturale, bug del solo `bootstrap/route.ts`. Il guard "evening_review priority" di Slice 2 esisteva solo in `active-thread/route.ts:computeEveningReview`. Bootstrap aveva due guard (Guard C2 active thread + `shouldTriggerMorningCheckin`) entrambi indifferenti alla finestra serale. Il flag `eveningReviewShouldStart=true` arrivava al client da `active-thread`, ma il fallback bootstrap che il client chiama secondo al mount riempiva `messages=[greetingMsg]`, sopprimendo il render della card.

- **Decisione di scope del fix.** Estrazione di `eveningReviewHasPriority` come funzione pura in `src/lib/evening-review/priority.ts` con dependency injection (settings, reviewExists, eveningThreadExists). Caller bootstrap e active-thread usano lo stesso helper. Pattern fast-path symmetric (`isInsideEveningWindow` nel caller + safety net nel helper) per evitare query DB review/eveningThread fuori finestra. Rename interno `clientDate -> validatedClientDate` per simmetria con `validatedNowHHMM`. Sequenziale invariato (no Promise.all, scope creep scartato esplicitamente). `formatTodayInRome` duplicato 3 righe locale a bootstrap invece di estratto in `dates.ts` per non toccare `orchestrator.ts` (file caldo di Slice 5, rollback semplice). Niente modifica al client (`ChatView.tsx` invariato).

- **Bonifica thread orfano puntuale.** Thread morning_checkin del 28/04 (`cmoj1ru7a0001ib50pbmiiwml`, startedAt 21:57 Rome) archiviato puntualmente via `scripts/archive-thread-by-id.ts` (chore `b3724db`). Niente bonifica strutturale di morning_checkin orfani richiesta dal lookup (resta tech debt di Slice 2/4 "morning_checkin sticky" gia' tracciato sopra).

- **Tech debt residuo: `now.getHours()` server-side.** `shouldTriggerMorningCheckin` usa `now.getHours()` (locale del server). In production Vercel il server gira in UTC, quindi il valore restituito sballa rispetto al timezone utente. Il fix corrente NON risolve e NON peggiora questo bug:
  - Dentro finestra serale, il nuovo guard di priorita' scavalca prima di arrivare a `shouldTriggerMorningCheckin`: il bug `getHours()` e' irrilevante in questa traiettoria.
  - Fuori finestra, il flusso bootstrap originale e' invariato e il bug continua a esistere come prima del fix.

  Coesistenza temporanea acceptable nello stesso file: il nuovo guard usa `nowHHMMInRome()` (Intl.DateTimeFormat con `timeZone: 'Europe/Rome'` esplicito), robusto in production; `shouldTriggerMorningCheckin` resta su `getHours()` (server-locale), fragile. Da unificare in mini-task futuro `fix(bootstrap): unify-tz`. Chi lo fixera' deve convertire `shouldTriggerMorningCheckin` a `nowHHMMInRome()` o equivalente.

- **Tech debt latente: `formatTodayInRome` CLDR default.** `formatTodayInRome` in entrambi i siti (`orchestrator.ts:514` e duplicato locale in `bootstrap/route.ts`) si affida al default `Intl.DateTimeFormat('en-CA').format(...)` per produrre `YYYY-MM-DD`. Pattern stabile su CLDR/Bun, non osservato fragile in produzione. In caso di runtime divergente futuro produrrebbe false positive silenzioso su evening_priority (helper non valida format del clientDate self-prodotto). Hardening futuro: rifattorizzare in entrambi i siti via `formatToParts`, coordinato come mini-task `chore: harden formatTodayInRome` separato. NON applicato qui per coerenza con il piano e con il codice deployato.

- **Manipolazione consapevole Settings durante test post-fix.** I test (a) e (a-bis) sono stati eseguiti il 29 aprile 2026 alle 09:35-10:00 Rome con manipolazione temporanea di `Settings.eveningWindowStart='08:00'` (finestra di test 08:00-23:00) per evitare di perdere una giornata di lavoro aspettando le 20:00 stasera. Manipolazione idempotente via `scripts/temp-shift-evening-window.ts` (chore `b3724db`), con log `[WARN]` REMEMBER TO RESTORE in output. Settings ripristinato post-test a default schema 20:00/23:00 via stesso script (output `[ok] window restored to schema defaults`). Deviazione consapevole dal piano (test originariamente scriptati "dentro finestra naturale"), accettato il rischio operativo della manipolazione DB. Test (a) PASS (EveningReviewCard renderizzata dentro finestra). Test (a-bis) PASS (con Review finta in DB, card NON renderizzata; greeting morning_checkin atteso e legittimo come fall-through del fix).

- **Pattern di scoperta del bug — nota meta-operativa.** Il bug strutturale di Slice 2 e' emerso solo durante E2E Fase 1 di Slice 5 commit 3b perche' era il primo accesso del giorno direttamente dentro la finestra serale su un account "vergine della giornata" (nessun thread `active` precedente, nessun morning di oggi). Pattern non testato in sviluppo Slice 2-4: le sessioni avevano sempre un thread esistente che attivava Guard C2 (skip bootstrap) o erano fuori finestra (no priority). La traiettoria `account vergine + dentro finestra` non era stata percorsa. **Lezione operativa per future slice E2E**: i futuri E2E vanno fatti su user account in stato fresco (no thread `active`, no review odierna, no morning di oggi), non su account gia' esercitati nella sessione di sviluppo corrente.

## Decisioni tecniche emerse durante Slice 5 E2E commit 3b (sessione 2026-04-29)

I 5 scenari E2E del commit body `122dd44` eseguiti il 29 aprile 2026 con setup operativo standardizzato: `scripts/seed-e2e-s1.ts` per i 4 task (titoli divergenti dagli esempi prompt, vedi sotto), `scripts/temp-shift-profile-style.ts` per cambio profilo coerente tra scenari, `scripts/temp-shift-evening-window.ts` per finestra serale shiftata 08:00-23:00 (test diurni), `scripts/lookup-thread-state.ts` per cross-check stato post-turno. 8 thread evening_review/morning_checkin sticky archived puntualmente via `scripts/archive-thread-by-id.ts` durante la sessione.

### Verdetto formale: PROMOZIONE 3b NON RAGGIUNTA

| Asse | S1 | S2 | S3 | S4 | S5 | Cumulativo | Vincolo |
|---|---|---|---|---|---|---|---|
| Testuale | PASS | FAIL | PASS marg | PASS | FAIL | 3/5 (2 fail) | 4/5 max 1 fail → **ROTTO** |
| Comportamentale | PASS | PASS | PASS | FAIL | PASS | 4/5 | strict 5/5 → **ROTTO** |
| Strutturale ordering | PASS | PASS | PASS | PASS | PASS | 5/5 | OK |

Doppio vincolo rotto. Asse strutturale ordering robusto in tutti 5/5 (single source of truth `triage.currentEntryId` cross-checkato via lookup script post-turno-2).

### Mappa scenari → asse → fail/pass dettagliato

- **S1 GMAIL × direct × normale** (TaskA "Bolletta gas"): testuale PASS rubric direct (M1∧M2∧M3), comportamentale PASS, strutturale PASS.
- **S2 MANUAL × gentle × normale** (TaskB "Aggiornare CV"): testuale **FAIL** rubric gentle (G1∧G3 = no marker positivo gentle), modello produce formula direct `"Aggiornare CV, scadenza il primo maggio — domani lo chiudi?"` identica strutturalmente a S1. Comportamentale PASS, strutturale PASS.
- **S3 CARRYOVER × challenge × high-avoidance** (TaskE "Spostare il dentista"): testuale PASS rubric challenge high-avoidance (C1∧C2∧C3, marker `che facciamo?` + `varie sere` qualitativo), MA **PASS marginale** per replica strutturale dell'esempio direct prompt `"Doc presentazione, è qui da varie sere. Stasera che facciamo?"`. Comportamentale PASS, strutturale PASS.
- **S4 trigger linguistico decomposizione** (TaskC "Email risposta cliente Rossi"): testuale rubric D2∧D3∧**D4**. Modello al turno 3 (post `"non so da dove iniziare"`) ha chiamato `approve_decomposition` prematuramente invece di proporre in prosa + chiedere conferma + tool al turno 4. Fail D4 = **fail comportamentale**. Strutturale PASS.
- **S5 trigger numerico decomposizione** (TaskC riusato, postponedCount=3, gentle): Opzione C eseguita, turni 1-2, salta turno 3 (D4 ridondante con S4). Testuale turno 2 **FAIL** rubric gentle (formula direct prodotta `"Email risposta cliente Rossi - dimmi."` identica a S4 turno 2 e all'esempio prompt MANUAL/direct). Comportamentale PASS, strutturale PASS.

### Fix path V1.1 raccomandato

Mini-task `fix(evening-review): harden prompt + guard for V1.1`. Tre strade:

- **Strada 1 (prompt hardening, low cost)**: rinforzare `EVENING_REVIEW_PROMPT` con esempi few-shot multi-style multi-turno per casi pressure. Per asse 3.1: variazioni esplicite gentle/challenge in `(source × deadline-presence × avoidance-level)`. Per asse 3.2: sequenza multi-turno completa (proposta turno N → conferma utente turno N+1 → tool call turno N+2) + esempio negativo `"NON FARE: tool call inline al turno N"`.
- **Strada 2 (server-side guard, medium cost)**: pre-check in `orchestrator.ts:executeTool` per `approve_decomposition`: leggere ultimo userMessage del thread, se non matcha lista marker conferma esplicita (`sì`, `si`, `ok`, `vai`, `perfetto`, `yes`, `confermo`), rifiutare tool call con errore conversazionale che il modello vede via `tool_result` e rigenera. Defense-in-depth, contratto enforced anche se prompt fallisce.
- **Strada 3 (extend buildUserContext, valutativo)**: solo se Strada 1 non risolve completamente. Vedi tech debt #15 sotto.

Retest mirato post-fix: S2/S5 turno 2 (variazione style in pressure), S4 turni 1-4 completo (D4 trigger linguistico), S5 turni 1-3 completo (D4 trigger numerico, completare anche turno 3 saltato in commit 3b sessione 2026-04-29).

> **Update post-retest 2026-04-29 sera.** Strada 1 (prompt hardening) applicata via commit `0582e1c` (fix #14: nuovo tool `propose_decomposition` + guard server-side + esempi multi-turno nel prompt) e `89eb0bc` (fix #11: 12 esempi few-shot mirati a `EVENING_REVIEW_PROMPT`). Esito retest mirato (sez. "Retest V1.1 — verdetti 2026-04-29 sera" sotto): fix #14 chiuso 2/2, fix #11 parziale 2/4 (caso B della pre-reg sez. 7). **Strada 2 (#15) promossa a candidato attivo V1.1**, sessione di pianificazione dedicata pre-beta. Strada 1 da sola insufficiente per chiudere il pattern di style mismatch in apertura.

### Tech debt cumulativi (16 item) emersi durante la sessione

#### Blocker promozione 3b (root cause diagnosticate)

- **#11 — Variazione style nel prompt evening_review non si manifesta in casi pressure.** S2 (manual + deadline + gentle) e S5 (manual + postponedCount=3 + gentle) entrambi producono formula direct `<Titolo>, <pressure-descriptor> — <verbo imperativo>?`. Pattern sistemico: il modello converge sulla formula direct quando il context ha "pressure" (deadline reale, postponed numerico, avoidance numerico), indipendentemente dallo style configurato. Causa probabilistica: il prompt ha esempi positivi sufficienti per `(source × style × livello-avoidance)`, ma quando il modeContext espone **simultaneamente** (a) `style=gentle/challenge` e (b) un campo "pressure" non-zero (deadline reale o `postponedCount≥3` o `avoidanceCount≥3`), il modello converge sull'esempio direct più letterale per il source, ignorando lo style. Pattern coerente con "modello a peso massimo sui campi numerici quando i campi categorici sono in conflitto". Implicazione per V1.1: Strada 1 deve avere esempi specifici per `style × pressure-concomitante` (es. `MANUAL+gentle+deadline-reale`, `MANUAL+gentle+postponed≥3`, `CARRYOVER+challenge+high-avoidance` con titolo divergente da esempio canonico), non solo `style` in casi senza pressure. Verifica architettura: `buildUserContext` (orchestrator.ts:336) espone correttamente `preferredPromptStyle` al modello, sovrascrittura via `temp-shift-profile-style.ts` semanticamente completa. Setup E2E OK. Bug del prompt. Fix: Strada 1.
- **#14 — Bug D4 Scenario 4: `approve_decomposition` chiamato prematuramente al turno 3.** Modello al turno 3 (post trigger linguistico `"non so da dove iniziare"`) collassa la mossa-tipo (4 sub-step in prosa: proposta → conferma → tool call) in un singolo turn con tool call inline. **Diagnosi root cause**: combinazione (c) prompt + orchestrator. Prompt-side: divieto presente esplicito in 3+ punti (mossa-tipo step 3, vincolo riga 242, cross-reference riga 253) e nella descrizione tool (tools.ts:153), MA nessun esempio few-shot multi-turno della sequenza completa, niente esempio negativo. Pattern noto LLM "divieti negativi meno efficaci di esempi positivi" (già documentato Slice 4 per QR leakage). Server-side: nessun tool evening_review (set_current_entry, mark_entry_discussed, add/remove_candidate, approve_decomposition) ha guard conversazionale; tutti eseguono se args validi e ownership OK. Prompt è unica linea di difesa, fragile. **Fix Strada 1 specifica per #14**: aggiungere alla sezione DECOMPOSIZIONE OPPORTUNISTICA del prompt blocco `ESEMPIO DI SEQUENZA CORRETTA` con 3 turni distinti (turno N: proposta in prosa + domanda conferma; turno N+1: utente "sì"; turno N+2: tool call) + blocco `ESEMPIO DI SEQUENZA SBAGLIATA (NON FARE)` con tool call inline al turno N senza attesa risposta utente. Pattern "show don't tell" multi-turno è il punto del fix, l'esempio negativo è rinforzo. ~15 righe nel prompt. **Fix combinato Strada 1 + Strada 2**: prompt copre il caso "modello legge l'esempio multi-turno", server-side guard copre il caso "modello falla nonostante esempio".

#### Setup E2E (fixati durante la sessione + residui)

- **#2 — `seed-e2e-s1.ts` sotto-verifica DB-side senza filtro status (FIXATO oggi).** La query `findMany` filtrava per `userId + title contains '[E2E-S1'` ma non per `status` non-terminale, contando archived + nuovi insieme dopo cleanup step. Risultato: count=8 invece di 4 al re-seed → FATAL spurious. Fix applicato: aggiunto `status: { notIn: terminalTaskStatuses() }`. Re-seed pulito post-fix.
- **#3 — `seed-e2e-s1.ts` non riutilizzabile tra giorni (deadline offset da `Date.now()` al seed-time).** Se lo stesso seed viene letto un giorno dopo, le deadline restano valide rispetto al cutoff calendario, ma la semantica "TaskC reason='new'" decade (createdAt diventa non-today). Da formalizzare: deadline assolute oppure ricomputo deterministico al re-lancio. Pianificazione futura.
- **#4 — Spec `≤48h` sliding vs implementazione "calendar days end-of-day Rome"**. Spec 2.1 (`docs/tasks/05-review-serale-spec.md`) propone "scadenza vicina ≤48h proposto, calibrabile". Implementazione (`config.ts:23` `DEADLINE_PROXIMITY_DAYS=2` + `triage.ts:68` `endOfDayInZone`) interpreta come "fine giornata di clientDate+2 in Europe/Rome". Divergenza documentata in `config.ts:22`. Promuovere a decisione esplicita.
- **#5 — `seed-e2e-s1.ts` accoppiato a implementazione filtro deadline.** Lo scenario 1 dipende dal cutoff "calendar days EOD Rome" per includere TaskB. Se in futuro spec switcha a sliding 48h strict, scenario 1 va riallineato. Aggiungere commento nel seed.
- **#7 — Few-shot leakage titoli seed (FIXATO oggi).** Titoli iniziali del seed (`Bolletta luce`, `Fattura idraulico`, `Doc presentazione`) collidono 3-su-3 con esempi `EVENING_REVIEW_PROMPT` (prompts.ts:181-208), triggerano replica letterale dal modello. S1 turno 2 prodotto `"Bolletta luce, scadenza il 30 - domani la chiudi?"` byte-per-byte identico all'esempio prompt. Fix: titoli sostituiti con `Bolletta gas`, `Aggiornare CV`, `Email risposta cliente Rossi`. Annotato in JSDoc del seed con riferimento a questo tech debt.
- **#15 — Mismatch dimensioni dichiarate da spec V1 vs dimensioni effettivamente esposte in `buildUserContext`.** `buildUserContext` (orchestrator.ts:336) espone solo 4 campi di AdaptiveProfile: `averageCompletionRate`, `averageAvoidanceRate`, `activationDifficulty`, `preferredPromptStyle`. Tutto il resto (motivationProfile, taskPreferenceMap, sensibilità shame/friction/reward, nudgeTypeEffectiveness) è ignorato. Lo style "gentle" arriva al modello come etichetta cosmetica, senza contesto rinforzante. Verificare in V1.1 se esporre più dimensioni con valori coerenti rinforza la variazione style. Test discriminante: estendere `buildUserContext` per includere `shameFrustrationSensitivity` + popolarlo coerentemente, retestare S2/S5 turno 2 post-fix Strada 1.

#### Cosmetici / UX

- **#6 — Quick-start placeholder UI condivisa per tutti i mode.** ChatView renderizza i 4 quick-start `"Pianifichiamo oggi / Ho un task nuovo / Cosa ho in lista? / Sono bloccato"` quando `messages.length===0` indipendentemente dal mode. Anche in mode `evening_review` post-click `"Inizia la review"` l'utente vede prompt fuori contesto per i pochi secondi prima della prima risposta del modello. Fix: condizionare placeholder a `mode === 'general'` o introdurre quick-start mode-specific. Confermato ricorrente in S1, S2, S3.
- **#8 — Fallback `"ok <toolname>"` di `ToolExecutionCard` espone nome tecnico interno all'utente.** `ChatView.tsx:518` ha render generico per tool senza UI dedicata: produce `"ok set_current_entry"` per i 5 tool evening_review. Pre-esistente Slice 4. Pattern intenzionale ma UX subottimale (snake_case interno visibile). Fix consigliato: `return null` come default V1, render custom per-tool come slice dedicata pre-beta.
- **#9 — Conflict tra CORE_IDENTITY "1 domanda per volta" e EVENING_REVIEW_PROMPT esempio MANUAL/gentle "2 domande".** L'esempio prompt `"Fattura idraulico - ne parliamo? Veloce o c'è qualcosa sotto?"` contiene 2 `?`, in conflitto col vincolo CORE_IDENTITY. Il modello replicava il pattern 2-domande quando trigger gentle scattava. Annotato come ambiguità del prompt 3b da risolvere in V1.1, non blocker E2E.
- **#13 — Formula apertura review serale produce concordanza grammaticale errata per N=1.** Modello produce `"Stasera ho 1 candidate"` invariato (forma plurale lessicale) invece di `"1 candidata"` singolare in italiano. Confermato 2/2 occasioni testate (S4 turno 1, S5 turno 1). Inconsistenza interna: il modello adatta correttamente `"le altre M restano"` → `"l'altra resta"` per M=1 (S1, S2, S3 turno 1). Hardening V1.1 cosmetico: aggiungere variante few-shot N=1 nel prompt.

#### Operativi ricorrenti

- **#1 — Lazy archive thread non-evening (8 episodi giornalieri).** Pattern già flaggato Slice 2 ("morning_checkin sticky"), rinforzato in Slice 3 ("orfano blocca anche lazy archive evening_review"), riemerso 8 volte in giornata 2026-04-29: (1) thread morning_checkin orfano del bootstrap 28 sera (archiviato a 09:42 Rome a inizio sessione), (2) thread morning_checkin spurio post-test (a-bis) di mattina (archiviato a 09:54 prima riapertura E2E), (3) thread evening_review S1 (archiviato pre-S2 setup), (4) thread evening_review S2 (archiviato pre-S3), (5) thread evening_review S3 (archiviato pre-S4), (6) thread evening_review S4 (archiviato pre-S5), (7) thread evening_review S5 (archiviato in chiusura sessione), (8) cleanup intermedi tra step inline. Ogni scenario ha richiesto archive puntuale via `scripts/archive-thread-by-id.ts`. **Promosso da rumore di sviluppo a blocker operativo ricorrente del workflow E2E.** Fix V1.1 priorità alta: `lazy archive generica thread non-evening` analogo a Slice 3 evening_review.
- **#10 — Latenza variabile turni evening_review (annotata, non azione richiesta).** Outlier S2 turno 1 (8156 ms) vs baseline S1/S3/S5 turni 1 (~2500 ms). Variabilità Anthropic / cold start, non pattern strutturale. Derubricato dopo ulteriori turni in linea.

#### Investigativi (lettura codice fatta, fix futuro)

- **#12 — Verifica guard server-side orchestrator per `approve_decomposition` senza pre-check (LETTURA FATTA durante diagnosi #14).** Confermato: nessun tool evening_review ha guard conversazionale. Pattern di guard è "args + ownership + state-check di triage". Niente check "ultimo userMessage matcha conferma" o "decomposition workspace pre-popolato". Manifestazione bug modello (tool emesso senza pre-condizioni soddisfatte) sarebbe NON mascherata in `payloadJson.toolsExecuted` perché executor non blocca. End-to-end osservabile, rubric D4 valida. Fix V1.1: Strada 2 (server-side guard light).
- **#16 — `approve_decomposition` non muta `Task.status` per design V1 (osservato post-retest 2026-04-29 sera).** Task con decomposizione approvata resta `status='inbox'`, ripescato come candidato delle review serali successive. Manifestazione concreta durante setup S2 tentativo 1 del retest V1.1 (vedi sez. "Retest V1.1 — verdetti 2026-04-29 sera" sotto): atteso 1 candidate, osservato 2 con S4 (decomposizione approvata in S4 chiuso poco prima) ripescato. Setup compromesso, evento 2 della pre-reg sez. 5 (artefatto setup) triggerato, fix manuale via archive S4 + thread. La spec V1 (`docs/tasks/05-review-serale-spec.md`) non specifica che `approve_decomposition` debba cambiare `Task.status`. Implicazione: ogni task con decomposizione approvata resta candidato delle review successive finché non viene chiuso esplicitamente con `mark_entry_discussed`. Pattern correlato a #1 (entrambi sono "stati che dovrebbero essere terminali per il workflow corrente ma non lo sono per design V1"). Fix V1.1 da valutare in pianificazione dedicata: `approve_decomposition` promuove implicitamente `status='inbox' → 'pending'` (o equivalente), oppure UI espone shortcut "task con micro-step approvati" per evitare ricomparsa nel triage successivo.

- **#17 — Orchestrator twin-shot ignora `secondResponse.toolCalls` (CHIUSO 2026-04-30 sera).** Manifestazione: durante retest fix #15, turno utente "boh" su S2 (entry MANUAL, postponedCount=0, gentle, mode=evening_review) ha mostrato `(nessuna risposta)` placeholder client. Diagnosi via `scripts/diag-tech-debt-17.ts`: ChatMessage `cmolsrj4m000tib80y17fvogm` aveva `content` vuoto + `payloadJson.toolsExecuted=[set_current_entry → cursor_set]` + `tokensOut=232` (output non perso, non salvato). Lookup `src/lib/chat/orchestrator.ts:160-253`: pattern strutturale twin-shot `if (firstResponse.toolCalls.length > 0) { ... secondResponse = await callLLM(); finalAssistantMessage = secondResponse.text; }`, niente check `stop_reason`, niente loop. Se `secondResponse` emette tool_use, viene scartato silenziosamente: tool non eseguito, prosa eventuale ignorata. Fix: refactor multi-iteration loop su `currentResponse.stopReason === 'tool_use' && toolCalls.length > 0 && iteration < MAX_TOOL_ITERATIONS=5`. Cap fallback: `console.error` strutturato + prosa user-facing `'Mi sono inceppato un attimo, riprova'` se cap hit con tool_use ancora pendente. Logica sequential (evening_review) vs parallel (altri mode) preservata verbatim dentro il loop. Validato tsc (0 nuovi errori), vitest 138/138, bunx next build (compile + 38 pages), retest E2E PASS netto su tutti i tool path (set_current_entry, propose_decomposition, approve_decomposition, mark_entry_discussed). Status: CHIUSO.

- **#18 — Zero unit test orchestrator (APERTO, V1.1 post-beta).** Manifestazione: grep `orchestrator|prompts` su `**/*.test.ts` → zero match. `src/lib/chat/orchestrator.ts` non ha coverage unitaria. Fix #17 (refactor strutturale del flow tool calls) validato solo via E2E manuale, niente regression test che blocchi rotture future. Rischio: Slice 6 (piano del giorno) introdurrà flow multi-tool consecutivi (es. `set_current_entry + propose_decomposition + add_to_plan + mark_entry_discussed`) che esercitano il loop multi-iteration in modo più stressante. Senza unit test, regressioni potrebbero affiorare solo durante E2E manuali. Coverage minima target: (a) zero tool calls path, (b) single-iteration tool call, (c) multi-iteration tool call (3-4 iter), (d) cap-hit fallback, (e) sequential vs parallel branch, (f) `pendingTriageState` mutator chain. Priorità: V1.1 post-beta. Lavoro stimato: 1-2 sessioni di setup vitest mock (Prisma + LLM client + executeTool) + suite di test.

### Manipolazioni DB durante la sessione (annotabili)

- `Settings.eveningWindowStart` shiftato a `08:00` per test diurni, ripristinato a `20:00` (default schema) a fine sessione via `temp-shift-evening-window.ts`.
- `AdaptiveProfile.preferredPromptStyle` shiftato 3 volte (`direct → gentle` per S2, `gentle → challenge` per S3, `challenge → direct → gentle` per S4 e S5), ripristinato a `direct` (default schema) a fine sessione via `temp-shift-profile-style.ts`.
- Task seed `[E2E-S1]` ricreati 2 volte (sessione precedente + re-seed post-titoli aggiornati).
- TaskE `[E2E-S3-carryover]` creato inline + archiviato post-S3 + S4.
- Review finta sessione precedente creata/cancellata via `temp-fake-review.ts` (script ad-hoc gitignored, pattern progetto consolidato per cleanup one-shot).
- 8 thread evening_review/morning_checkin archiviati puntualmente durante la sessione.

### Pattern operativo della sessione (annotabile per future E2E)

- Setup pre-turni standardizzato: profile shift + task setup + thread archive. Sequenza 4-5 step per scenario, replicabile.
- Cross-check post-turno via `scripts/lookup-thread-state.ts` con `TARGET_FIRST_ENTRY_ID` env var. Output verbatim incollabile in chat, no Studio screenshot.
- Disciplina rubric meccanica: liste chiuse di marker pre-registrate, applicazione binaria. Riformulazione rubric on-the-fly vietata. Quando ipotesi alternative (es. ipotesi sovrascrittura parziale AdaptiveProfile) sono emerse, investigazione live separata da applicazione rubric.
- Pattern operativo replicabile per E2E commit 4 (asse 3.3 frizione emotiva, scope futuro): stesso seed structure, stesso flow lookup, rubric F1∧F2∧F3 da pre-registrare con liste chiuse simmetriche a G/C.

## Retest V1.1 — verdetti 2026-04-29 sera

Retest mirato dei due commit V1.1 fix (`0582e1c` per #14, `89eb0bc` per #11) su tre scenari ridotti rispetto agli E2E originali. Pre-registrazione formale in `docs/tasks/05-retest-v1-1-preregistration.md`. Setup operativo annotato sotto retroattivamente (decisioni operative non in pre-reg, da L4 retro-mortem).

### Verdetto formale: caso B (parziale, #15 promosso a candidato attivo V1.1)

| Fix | Punti totali | PASS | Soglia pre-reg | Esito |
|---|---|---|---|---|
| #14 sequenza propose/confirm/approve | 2 sequenze (S4 + S5) | 2/2 | 2/2 → CHIUSO | **CHIUSO** |
| #11 style × pressure | 4 punti effettivi (vedi nota meta sotto) | 2/4 | ≥4/5 → CHIUSO; 2-3/5 → PARZIALE | **PARZIALE → caso B** |

Decisione di scaling: caso B della pre-registrazione sez. 7 → **Strada 2 (#15) promossa a candidato attivo V1.1**, sessione di pianificazione dedicata pre-beta. Estensione di `buildUserContext` per esporre più dimensioni di `AdaptiveProfile` (in particolare `shameFrustrationSensitivity` e altri segnali di tono oggi non visibili al modello). Per la corrispondenza con la numerazione tripartita (precedente al consolidamento) della sezione "Fix path V1.1 raccomandato" sopra, vedi update inline lì.

### Tabella verdetti rubric meccanica

#### Fix #14 — asserzioni A1/A2/A3 per sequenza

| Scenario | Trigger | A1 (propose al turno N) | A2 (no approve al turno N) | A3 (approve al turno N+2) |
|---|---|---|---|---|
| S4 turni 1-4 | linguistico ("non so da dove iniziare") | PASS | PASS | PASS |
| S5 turni 1-3 | numerico (`postponedCount=3`) | PASS | PASS | PASS |

#### Fix #11 — punti G1-G5

| Punto | Posizione semantica | Asserzioni | Esito |
|---|---|---|---|
| 1 | S2 turno 2 (follow-up post-"boh", gentle) | G1 + G2 | **FAIL** (G1 FAIL, G2 FAIL — output `"Cosa ti blocca? Tempo, info, voglia?"` = 6 parole, copia letterale esempio direct di `FOLLOW-UP DOPO APERTURA` in `prompts.ts:221`) |
| 2 | S5 turno 2 (apertura entry post-"vai", gentle) | G1 + G2 | **FAIL** (G1 FAIL, G2 FAIL — output `"Telefonare al commercialista per F24 - dimmi."` = 6 parole, formula direct asciutta) |
| 3 | S5 turno N (proposta decomposizione, gentle) | G3 + G4 | PASS (marker `"ho pensato a"`, `"passi piccoli"`, `"praticabile"`, lunghezza ≥25 parole) |
| 4 | S5 turno N+2 (post-conferma utente, gentle) | G5 | PASS (marker scelta aperta `"adesso o domani"`) |

### Annotazioni meta

- **Discrepanza pre-reg sez. 3 (5 punti dichiarati, 4 effettivi).** La pre-registrazione dichiarava "Totale asserzioni gentle: G1+G2 (×2 scenari) + G3+G4 + G5 = **5 punti**". La somma esplicita è 4 (2 + 1 + 1). Errore aritmetico in fase di drafting della pre-reg. Conteggi del retest applicati su 4 punti effettivi. Soglia originale ≥4/5 riproporzionata su 4 punti = ≥3.2 → di fatto 4/4, irraggiungibile dato S5 turno 2 FAIL osservato in S5. Esito determinato verso caso B indipendentemente da S2 confermato. La pre-reg resta immutabile post-retest per disciplina L4, errore annotato qui solo come avviso al lettore.

- **Pattern emergente: apertura direct su profilo gentle, sistemico.** Osservato in entrambi gli scenari gentle (S2 e S5), in posizioni diverse del flow per-entry: apertura entry (S5 turno 2) e follow-up post-utente vago (S2 turno 6 = "turno 2 per-entry"). Il modello replica gli esempi few-shot del prompt verbatim (formula direct copiata letterale in S2), ma la **scelta dello style** sembra guidata da inerzia del default `direct` di `CORE_IDENTITY` più che dal `preferredPromptStyle="gentle"` esposto in `buildUserContext`. Il fix #11 ha aggiunto esempi gentle ma non ha cambiato il meccanismo di scelta dello style. Coerente con tech debt #11 originale ("modello converge su direct quando context ha pressure"), ma il retest mostra che il pattern si manifesta anche **senza pressure** (S2 ha `postponedCount=0`, `avoidanceCount=0`, deadline `null`). Quindi la diagnosi deve essere allargata: non è solo "pressure contamina apertura", è "default direct contamina apertura quando profile gentle non è abbastanza salient nel context". Implicazione operativa per Strada 2 (#15): rinforzare la salience di `preferredPromptStyle` nel `buildUserContext` (oggi è una stringa cosmetica accanto ad altri 3 campi) potrebbe non bastare; serve probabilmente una sezione dedicata "VOICE PROFILE" del system prompt che apra il profilo come blocco salient e rinforzi il binding stile↔comportamento.

- **`approve_decomposition` non muta `Task.status` per design V1.** Annotato come tech debt #16 sopra (sez. "Investigativi"). Osservato durante setup S2 tentativo 1 (atteso 1 candidate, osservato 2 con S4 ripescato). Pattern correlato a tech debt #1 (entrambi sono "stati che dovrebbero essere terminali per il workflow corrente ma non lo sono per design V1"). Fix V1.1 da valutare in pianificazione dedicata.

- **Trigger numerico `postponedCount≥3` salta il follow-up gentle.** Osservato in S5: il modello dopo apertura entry asciutta + risposta vaga utente non ha prodotto un follow-up gentle, è andato direttamente a `propose_decomposition`. Pattern coerente con SEQUENZA OBBLIGATORIA della spec (trigger numerico anticipa la decomposizione senza aspettare blocco esplicito), ma collateralmente sottrae al test G1+G2 il "turno 2 gentle" atteso. Effetto positivo per A1 fix #14 (`propose_decomposition` chiamato correttamente), effetto secondario sul conteggio fix #11 (un punto valutativo perso). Da considerare per future rubric: in scenari con trigger numerico, il punto G1+G2 va valutato sull'apertura (turno 1 per-entry) invece che sul follow-up — la pre-reg sez. 3 lo presupponeva implicitamente ma non lo dichiarava esplicitamente.

- **Tech debt #1 (lazy archive thread non-evening) non manifestato in questo retest.** Setup pulito iniziale (`ChatThread state in (active, paused) = []`) confermato via lookup. Pattern correlato osservato però: il "task con decomposizione approvata resta candidato della review successiva" (#16) è una manifestazione analoga del problema più generale "stati che dovrebbero essere terminali per il workflow corrente ma non lo sono per design V1". Tech debt #1 e #16 sono cugini operativi, da considerare insieme nel pianificare V1.1.

### Setup operativo del 2026-04-29 sera (annotazione retroattiva)

Decisioni operative del setup, non in pre-reg, fissate retroattivamente per audit futuro (lezione L4: pre-registrazione include rubric + scope + criteri sospensione, le decisioni operative possono essere annotate post-hoc).

- **Test user.** `cmoh92ksv0006ibkseihlh38g` (`egiulio.psi@gmail.com`).
- **Task seedati.**
  - S4: `"Preparare presentazione cliente Q3"`, source=manual, deadline=`2026-05-01T12:00:00Z` (dopodomani Europe/Rome a noon UTC), `postponedCount=0`, `avoidanceCount=0`, urgency=4, importance=4, category="work".
  - S2: `"Aggiornare CV con ultimi due progetti"`, source=manual, deadline=null, `postponedCount=0`, `avoidanceCount=0`, urgency=3, importance=3, category="personal".
  - S5: `"Telefonare al commercialista per F24"`, source=manual, deadline=null, `postponedCount=3` (trigger numerico), `avoidanceCount=0`, urgency=3, importance=4, category="admin".
- **Profilo test user.** `preferredPromptStyle="direct"` per S4 (default schema, nessuno shift). Shift `direct → gentle` post-S4, prima di S2 e S5. Altri campi (`shameFrustrationSensitivity=3`, `motivationProfile` 6 dimensioni a 0.5, `nudgeTypeEffectiveness="{}"`, `totalSignals=0`, `confidenceLevel=0.3`) non toccati.
- **Ordine retest effettivo.** S4 (PASS clean) → shift profilo → S2 (tentativo 1, **fallito setup**: S4 ripescato come candidate, modello ha aperto S4 invece di S2) → archive S4 + thread fallito → S5 (PASS clean su A1+A2+A3 + G3+G4 + G5) → archive S5 + thread → S2 (tentativo 2, ultimo).
- **Archive operations.** 2 task residui sessione precedente (`[E2E-S1-filler]`, `[E2E-S1-decoy]`) all'inizio + thread evening_review S4 + task S4 + thread S2-fallito + task S5 + thread S5. Tutti via update Prisma diretto in `bun -e` (no script committato), `status='archived'` per task, `state='archived' + endedAt=now()` per thread.

### Pattern operativo replicabile

- **Pre-registrazione formale prima del retest.** Documento separato (`05-retest-v1-1-preregistration.md`) salvato e committato prima dell'esecuzione, congelato durante il retest. Disciplina L4 retro-mortem applicata: rubric meccanica + scope + criteri sospensione fissati a priori, applicazione binaria post-turno. Errore aritmetico nella pre-reg (5 vs 4 punti) annotato post-hoc senza patch alla pre-reg, per fedeltà alla disciplina di immutabilità.
- **Eventi sospensione effettivamente innescati.** Evento 2 (artefatto setup) → S2 tentativo 1 fallito, ipotesi "S4 in candidate" verificata in <5 min via lookup, fix manuale, riesecuzione pulita. Pattern: investigare ipotesi setup-related quando il modello apre un'entry inattesa, non assumere drift comportamentale finché lookup non conferma.
- **Strategia "fix non in-flight" rispettata.** Niente patch al prompt o al codice durante il retest, fail emersi annotati e proseguito (L1). Decisioni di prodotto (caso B, #15 promosso) deliberate post-retest, non during.

## Retest V1.1 #15 — verdetti 2026-04-30 sera

Sessione di chiusura V1.1 con tre obiettivi: (a) implementare fix #15 e validarlo via E2E sui 2 punti FAIL del retest 2026-04-29 (S2 turno 2 + S5 turno 2, rubric gentle G1+G2); (b) chiudere o accettare residui di fix #11; (c) diagnosticare e fissare eventuali nuovi tech debt emersi.

Esito: fix #15 commit `687c04a`, fix #17 commit nuovo (orchestrator multi-iteration loop), fix #11 chiuso per beta con riserva (soglia 20 parole calibrabile post-beta).

### Verdetto formale

| Fix / Tech debt | Status | Note |
|---|---|---|
| #15 — `buildContextAndVoice` + VOICE PROFILE prompt block | **CHIUSO** | Commit `687c04a`. 2 file: `prompts.ts` (+42), `orchestrator.ts` (+29). Niente schema change. |
| #11 — style × pressure (retest punti 1-2 post fix #15) | **CHIUSO per beta con riserva** | S2 turno 2 PARZIALE PASS (3/4 marker pieni, lunghezza 18 parole vs soglia 20 marginale). S5 turno 2 PARZIALE PASS (Layer 2 high-avoidance attivo, tono descrittivo coerente). Nessun caso direct-letterale come nel retest precedente. Soglia 20 parole calibrabile post-beta se serve. |
| #17 — orchestrator twin-shot ignora `secondResponse.toolCalls` | **CHIUSO** | Diagnosi via `scripts/diag-tech-debt-17.ts`. Fix: multi-iteration loop con cap=5 + fallback prosa. Vedi sez. "Investigativi" sopra. |
| #18 — zero unit test orchestrator | **APERTO** (V1.1 post-beta) | Vedi sez. "Investigativi" sopra. |

### Tabella verdetti retest fix #11 punti 1-2 post fix #15

| Punto | Posizione semantica | Esito retest 2026-04-29 | Esito retest 2026-04-30 |
|---|---|---|---|
| 1 | S2 turno 2 (follow-up post-"boh", gentle) | FAIL (G1+G2 6 parole copia direct) | **PARZIALE PASS** (3/4 marker pieni, 18 parole vs 20 marginale) |
| 2 | S5 turno 2 (apertura entry post-"vai", gentle) | FAIL (G1+G2 6 parole formula direct asciutta) | **PARZIALE PASS** (Layer 2 high-avoidance attivo, tono descrittivo coerente) |

### Setup operativo del 2026-04-30 sera

- **Test user.** `cmoh92ksv0006ibkseihlh38g` (`egiulio.psi@gmail.com`), invariato.
- **Task seedati.** S2 + S5 identici al setup 2026-04-29 (vedi sez. "Setup operativo del 2026-04-29 sera" sopra). Niente S4 (out of scope). Re-seed multiplo nella sessione: setup iniziale → cleanup deviazioni → re-seed pre-fix-17 retest. Id finali: S2 `cmolu7sba0001ib0g81x5x2am`, S5 `cmolu7si50003ib0ggld3s924`.
- **Profilo test user.** `preferredPromptStyle="gentle"` carryover dal setup 2026-04-29, niente shift in questa sessione. `shameFrustrationSensitivity=3`, `motivationProfile` 6 dimensioni a 0.5, `optimalSessionLength=45`. AdaptiveProfile invariato.
- **Settings.eveningWindowStart shiftato `20:00 → 19:00`** via `scripts/setup-retest-v1-1.ts`. Motivo: dev server lanciato alle 19:25 Europe/Rome, fuori finestra default. Da ripristinare a `20:00` post-sessione (annotazione manuale, non in commit).

### Deviazioni rilevate durante setup (3)

- **Vecchio S2 residuo del 2026-04-29** (`cmokez8lo0003ibfgwuflhhah`, postponedCount=0, status=inbox). Atteso archiviato post-retest precedente, trovato vivo. Hard delete via `scripts/cleanup-deviazioni.ts`. LearningSignal con quel taskId restano orfani come da pattern (taskId nullable, niente FK cascade). Cause probabile: archive operation di fine sessione 2026-04-29 incompleto su S2.
- **ChatThread orfano del 2026-04-29** (`cmokgg4jy001fib8ooehl8t5e`, mode=evening_review, state=active). `state='archived'` (no delete, ChatMessage history preservata per debug). Cause: cleanup di fine sessione 2026-04-29 mancante per il thread.
- **ChatThread paused post-401 del 2026-04-30** (`cmolrupz60001ib0oe9ba7syf`, mode=evening_review, state=paused, lifetime ~14 min 19:42→19:56 Europe/Rome). Generato dal primo tentativo di retest fallito su 401 da Anthropic API (vedi pattern operativo sotto). Thread creato lato server PRIMA della chiamata API, post-fail finito in `paused`. Cleanup via `scripts/cleanup-active-threads.ts` (`updateMany state='archived'` su tutti i thread `state IN (active, paused)` del test user).

### Manipolazioni DB durante la sessione

- 4 hard delete Task (vecchio S2 + S2 stamattina + S5 stamattina). Pattern: matching su titolo esatto in `RESIDUI_TITLES = ['Aggiornare CV...', 'Telefonare al commercialista...']` per evitare false positive.
- 2 update ChatThread `state → 'archived'` (orfano 2026-04-29 + paused post-401 2026-04-30). 1 ulteriore via `cleanup-active-threads.ts` post-retest fix-17 (thread `cmolsjab60005ib80hnf58rc0` del retest pre-fix-17 con bug `(nessuna risposta)`).
- 1 update Settings `eveningWindowStart 20:00 → 19:00` (da ripristinare manualmente post-sessione).
- 4 task seedati (2 setup iniziale + 2 re-seed pre-fix-17 retest), 2 vivi a fine sessione (S2 nuovo + S5 nuovo).

### Pattern operativo: fragilità env shell Windows User-level

- **Manifestazione.** Variabile env `LA_TUA_API_KEY` permanente settata a livello User di Windows da progetto esterno ha inquinato il dev server Shadow al primo refresh del retest, causando 401 sulla prima chiamata Anthropic API. Il dev server Next.js eredita le env User-level del processo padre (PowerShell), e Anthropic SDK ha priorità a `process.env.ANTHROPIC_API_KEY` sopra `.env.local` se entrambe presenti.
- **Diagnosi.** Lookup via PowerShell: `[Environment]::GetEnvironmentVariable('VAR_NAME', 'User')`. Se non null per pattern `*API_KEY*` esterni al progetto, env permanente inquinante.
- **Pulizia.** `[Environment]::SetEnvironmentVariable('VAR_NAME', $null, 'User')` rimuove la variabile a livello User. Restart shell per propagazione del nuovo environment.
- **Implicazione setup E2E future.** Lookup env `*API_KEY*` (qualunque pattern) prima di lanciare dev server da PowerShell. Se trovata env permanente esterna al progetto, rimuoverla o sovrascriverla con override targato User-level (priorità più alta di System).

## Decisioni tecniche emerse durante mini-task pulizia tech debt 2026-04-30

Sessione di chiusura tech debt pre-Slice 6/7. Cinque mini-task pianificati, cinque chiusi. Un'operazione DB side. Pattern operativi consolidati e nuovi pattern scoperti.

- **`next-env.d.ts` ora gitignored.** Pattern Next.js moderno standard. File autogenerato a ogni `next dev`/`next build`, oscillava tra `./.next/dev/types/routes.d.ts` e `./.next/types/routes.d.ts` generando rumore in `git status`. Rimosso dall'index via `git rm --cached`, aggiunto a `.gitignore`. Closes mini-task #1 from `05-slices.md` issues pre-esistenti.

- **Comando canonico TS validation: `bun run typecheck`.** Aggiunto script `"typecheck": "tsc --noEmit"` in `package.json`. Nota empirica: `bun run typecheck` normalizza l'exit code (0 vs >0), mentre `bunx tsc --noEmit` propaga l'exit di `tsc` originale (1, 2, 4 a seconda della granularità errori). Per dev workflow e CI è sufficiente la distinzione binaria di `bun run`; se serve granularità (raro) usare `bunx tsc` direttamente. Pattern da evitare: `bunx tsc --noEmit | tail -N` — la pipe maschera l'exit code (lo stesso pattern che era stato annotato in deploy-notes Slice 1 come ipotesi è stato confermato sperimentalmente, ma il problema esisteva solo nelle invocazioni manuali, non in script committati).

- **`ignoreBuildErrors: true` rimosso da `next.config.ts`.** `next build` ora valida i tipi effettivamente. Sono stati gestiti due errori TS preesistenti che erano nascosti dal flag:
  - `scripts/debug-rollback-v10.ts` — cancellato come artefatto di test V10 chiuso (file untracked, gitignored sotto `scripts/debug-*.ts`, mai committato; storia git non aveva nulla da preservare). Lezione: gli script `debug-*.ts` sono effimeri per design, hardcoded di task/thread ID di un test specifico, non template riusabili. Per template di rollback usare `scripts/temp-shift-evening-window.ts` (parametrizzato, idempotente, validato).
  - `src/app/tasks/page.tsx:2355` (TS2367 `wasStrict`) — coperto con `@ts-expect-error` esplicito + commento che documenta lo scope Task 9 (split file). Il commento contiene `'active_strict' missing from strictModeState type union, scoped to Task 9` per facilitare il fix futuro nello split. Il `@ts-expect-error` è intrinsecamente self-cleaning: se in futuro il TS2367 sparisce (es. fix non intenzionale), TypeScript segnala `Unused @ts-expect-error directive` e forza la rimozione del workaround.

- **`bun run build` passa end-to-end su Windows.** Diagnosi: il problema non era `cp -r` non disponibile (come ipotizzato in deploy-notes Slice 1), ma `cp` di Bun shell builtin essere POSIX strict e rifiutare `-r` (alias GNU coreutils) accettando solo `-R` (POSIX standard). Fix: due caratteri `r → R` nelle due `cp` del build script. Cross-platform: Linux GNU e macOS BSD trattano `-r` e `-R` come alias, Bun shell solo `-R`. Pipeline build ora pulita: `prisma generate && next build && cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/`, ~15s. La validazione TS di `next build` (post-rimozione `ignoreBuildErrors`) richiede ~7s e conferma che il `@ts-expect-error` di sopra è riconosciuto anche in fase Next.

- **`vite-tsconfig-paths` rimosso, sostituito da `resolve.tsconfigPaths: true` nativo Vite 8.** Vitest emetteva un warning verbatim "The plugin vite-tsconfig-paths is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option". Verifica empirica post-edit: warning ASSENTE, 138/138 test passati, niente `Cannot find module` su `@/lib/db` o `@/lib/evening-review/triage` (tools.test.ts continua a risolvere). Bonus: vitest run più veloce di ~50ms (overhead plugin sparito). Una dependency npm in meno.

### Pattern operativi consolidati o scoperti

- **Sub-process zombie su Windows post-typecheck.** L'hook `.claude/hooks/typecheck-on-ts-edit.js` lascia talvolta un sub-process `node` orfano dopo l'esecuzione. Sintomo: `Get-Process node` mostra un PID con StartTime recente non riconducibile a dev server. Auto-cleanup entro 30-60s. Non è blocker per build (`prisma generate` non da EPERM), ma se accumulati potrebbero interferire con build futuri. Da indagare se l'accumulo diventa visibile.

- **PowerShell `CategoryInfo: NotSpecified ... NativeCommandError`.** PowerShell tratta certo stderr verbose di Bun come "errore" anche quando è puramente informativo. Se `EXIT: $LASTEXITCODE` è 0, l'output `NativeCommandError` è rumore PowerShell, non un fail reale.

- **Pipe `| tail` mangia exit code in shell PowerShell e bash.** Pattern da evitare quando si vuole il vero exit di un comando precedente. Se serve troncare output e propagare exit, usare in PowerShell `; echo "EXIT: $LASTEXITCODE"` separatamente, oppure in bash `set -o pipefail`. Questo problema era stato annotato come ipotesi in Slice 1, è stato confermato in questa sessione che si presentava solo nelle invocazioni manuali ad-hoc, non in script committati.

- **Autolink markdown indesiderato in commit message.** Il pattern `vite.dev` (URL-like) è stato auto-trasformato in `[vite.dev](http://vite.dev)` da un layer di rendering nella catena di tooling. Catturato pre-commit via `Get-Content` + revisione visuale. Pattern preventivo per future sessioni: nei commit message, evitare URL-like bare dove possibile, preferire formulazioni descrittive.

- **Pattern `git rm --cached` vs `rm` su file gitignored.** Se un file è già gitignored ma non tracked, `git rm --cached` fallisce con "did not match any files". In quel caso usare `rm` semplice. Tipico per file inseriti nel `.gitignore` dopo essere stati creati (mai committati). Differente da `git rm --cached` di un file tracked che si vuole untrackare mantenendo il file fisico (caso del `next-env.d.ts` di questa sessione).

### Issues residui non chiusi (out of scope, tracking)

- **Sub-process zombie post-typecheck-hook** — annotazione mentale, non investigato. Se diventa visibile in futuro, indagare l'hook `.claude/hooks/typecheck-on-ts-edit.js`.
- **Errore TS2367 `tasks/page.tsx:2355`** — coperto con `@ts-expect-error`, fix vero in scope Task 9 (split file).
- **`bun run build` rotto da Prisma EPERM su Windows** — situazionale (solo se `bun run dev` o `bunx prisma studio` attivi in altri terminali). Workaround: spegnere i processi Prisma prima del build. Documentare in README sezione "troubleshooting Windows" come mini-task futuro.

## Decisioni tecniche emerse durante Slice 6a

- **Bug `Settings.userId` non `@unique` → uso di `findFirst` (fixato in 3e).** Lo schema Prisma ha `Settings.userId` come campo non univoco (potenzialmente per supportare in futuro multipli profili settings per utente?). Tentativo iniziale di usare `db.settings.findUnique({ where: { userId } })` durante il wiring del blocco 3.5 di `orchestrator.ts` ha fallito con errore TypeScript. Fix: passaggio a `findFirst({ where: { userId } })`, coerente con 4 callers preesistenti che già adottavano questo pattern. Pattern operativo da ricordare: prima di chiamare `findUnique` su un nuovo modello Prisma, verificare nel `schema.prisma` che il campo del filtro abbia il vincolo `@unique`. Lezione salvata in Claude Code memory (`feedback_prisma_unique_constraint_before_findunique`).

- **Modello segue letteralmente i pattern few-shot del prompt FASE PIANO_PREVIEW.** Verificato empiricamente nello smoke test E2E (turno 6): modello ha riprodotto quasi alla lettera due frasi degli esempi gentle del prompt — "è il tuo momento più carico" (riga 363 di `prompts.ts`, esempio `energy=peak, style gentle`) e "Domani è leggera, te la prendi con calma" (riga 371, esempio `state=low, style gentle`). Conferma empirica della lezione già osservata in Slice 5 V1.1 retest: i pattern positivi nel prompt funzionano molto meglio dei divieti negativi ("non fare X" è meno efficace di "fai Y"). Implicazione per Slice 6b/6c: continuare con il pattern few-shot per le nuove regole (override durate, taglio, conferma chiusura), non spostarsi su prompt più dichiarativi.

- **Path test E2E richiede ≥6 turni per arrivare alla fase preview di 6a, anche con 1 sola candidate.** Sequenza minima osservata nello smoke test: (1) apertura triage, (2) conferma perimetro + `set_current_entry`, (3) apertura per-entry, (4) decomposizione opportunistica, (5) approvazione decomposizione, (6) chiusura entry + `mark_entry_discussed` → fase preview finalmente attivata al turno 6. Nessun shortcut possibile in V1: il modello segue il flow conversazionale di Slice 4-5 prima di passare alla presentazione del piano. Implicazione per smoke test 6b/6c: pianificare almeno 5-6 turni di setup conversazionale prima del punto di test effettivo (override durate per 6b, taglio per 6c).

- **Tool `set_current_entry` consuma turno senza testo (pattern tool-only).** Osservato turno 2 dello smoke test: modello ha chiamato `set_current_entry` con entryId corretto, ma `assistantMessage` ritornato è stringa vuota (`""`). UI client mostra "(nessuna risposta)" come fallback per testo vuoto, comportamento atteso del client per tool calls senza follow-up testuale del modello. Non è bug del prompt o dell'orchestrator. Pattern noto da slice precedenti (già osservato in Slice 4-5), ma utile ri-documentare qui per smoke test futuri: dopo un turno tool-only, il client/utente deve mandare un nuovo userMessage (es. "ok", "prosegui") per scatenare il prossimo turno con testo. Implicazione: contare i turni tool-only quando si pianifica la lunghezza dello smoke test E2E.

- **Neon free tier auto-suspend dopo 5 minuti di inattività → cold start.** Osservato stamattina riprendendo la sessione (12+ ore di branch dormiente). Prima call Prisma fallisce con `Can't reach database server at ep-royal-feather-an64zx4z-pooler...`. Workaround: riprovare la stessa call, la seconda chiamata sveglia il branch (cold start ~2-5 secondi) e procede. Pattern noto del Neon free tier. Implicazione per beta: un utente che apre Shadow al mattino dopo branch dormiente da ore vedrebbe errore "qualcosa è andato storto" sul primo turno della giornata, con retry necessario. Action item pre-beta: valutare upgrade a Neon Pro (no auto-suspend) almeno per il branch di produzione, o implementare retry automatico lato server con backoff per le prime call dopo periodi di inattività.

- **Costo smoke test Slice 6a = $0.43 per 8 turni, ~$0.054/turno medio (Sonnet 4.5).** Baseline empirica documentata. Tokens-in medi ~17k per turno, picchi a 23k post-cronologia ricca (turno 4-6). Proiezione conservativa per beta: una review reale di 20 turni costa ~$1, per 100 utenti × 30 sere/mese = ~$3000/mese di sole review serali. Action item pre-beta documentato in roadmap: implementare prompt caching Anthropic API (sconto -50% sui token cached, 4-6h di lavoro su orchestrator). Senza caching, il modello economico Shadow non è sostenibile a prezzi consumer (~€18-30/mese tipo Claude Pro / ChatGPT Plus); con caching, prezzi €25-40/mese diventano realistici. Vedi conversazione strategica del 2 maggio mattina con Claude per analisi pricing dettagliata.

## Decisioni tecniche emerse durante Slice 6b

- **21 test rossi su `tools.test.ts` per `vi.mocked is not a function` — preesistenti rispetto a Slice 6b, da indagare quando possibile.** Emersi alla prima esecuzione `bun test` post-3a; verificati preesistenti via `git stash` su tree pulito (stesso 21 fail / 145 pass del baseline pre-slice). Sospetto problema di setup runner o mismatch versione vitest, non incompatibilità Bun (`vi.mocked` è API standard Vitest >= 0.30). Nessun altro test file mostra il sintomo, solo `src/lib/chat/tools.test.ts`. Mini-task dedicato post-Slice 6b: 5 minuti di indagine su versione `vitest` in `package.json` + `import` in `tools.test.ts`, fix probabile è una riga (cambio import o aggiunta `vi` alla destructuring). Non bloccante per 6b — il delta della slice si misura sulle suite di `evening-review/*` che girano verdi — ma è debito vero, non "fail noti" da accettare.

- **`adds` con task non-`inbox` viene filtrato a monte silenziosamente (3g.1).** L'orchestrator costruisce `allUserTasks: allTasks.filter(t => t.status === 'inbox')` prima di passare ad `applyPreviewOverrides`. Se l'utente in V1 chiede l'aggiunta al piano del giorno dopo di un task con status `planned` / `active` / `in_progress` (task gia' pianificato altrove), il task non viene trovato nel pool: `applyPreviewOverrides` (in `apply-overrides.ts`) emette `console.warn` server-side e ritorna un preview invariato. Il modello vedra' preview senza il task aggiunto e dovrebbe inferire fallimento dalla discrepanza fra intenzione utente ed esito visibile. Comportamento accettabile per V1 (caso raro: utente che pinge un task gia' allocato altrove). Silent filter intenzionale, non per dimenticanza. Per V1.1 considerare signal esplicito al modello del fallimento. Due opzioni: (a) togliere filtro a monte, error nel `tool_result` handler — semplice ma cambia architettura V1; (b) aggiungere campo `ignoredAddIds[]` al return di `applyPreviewOverrides` propagato via mode-context — additivo, V1 architecture preserved. Decisione di prodotto quando emergera' la necessita' (es. tester segnala confusione sul comportamento silent).

- **If-chain su `result.kind` in orchestrator non garantisce exhaustiveness (3g.7).** Il pattern attuale per dispatchare il `kind` di `ToolExecutionResult` nell'orchestrator e' `if (result.kind === 'X' || ...) { ... }` con multiple `if` indipendenti. Se in slice future aggiungiamo un nuovo `kind` (es. `'externalSideEffect'`, `'streamingMutator'`), TypeScript NON segnala che l'orchestrator deve gestirlo: il nuovo kind passa silenziosamente senza side-effect su `pendingTriageState` / `pendingPreviewState`. Refactor candidato per slice 7+ quando aggiungeremo altri tool fuori dal pattern triage/preview-mutator: switch + `_exhaustive: never` default branch che forza TS error se un kind non e' coperto. Costo refactor: ~30 min, low risk (cambio solo orchestrator if-chain in switch). Beneficio: future-proof contro silent regression. Annotato come tech debt perche' aggiungere `'previewMutator'` in 3g.7 ha richiesto memoria umana di "non scordarsi di toccare l'orchestrator" — esattamente il tipo di error la cui prevenzione e' il job del compilatore.

## Decisioni tecniche emerse durante Slice 6b — smoke E2E

- **Bug ingest task via chat: date hallucinated in modalità general (out-of-scope 6b, priorità ALTA pre-beta).** Il flow "creazione task via chat" produce date relative-time interpretate male. Esempi osservati: "fattura entro dopodomani mattina" → salvata con deadline 2025-01-10; "presentazione cliente" senza spec temporale → 2025-01-16. Il modello non sta calcolando relative-time da clientDate corrente (2026-05-05). Pattern consistente, riproducibile. Action item: pre-beta, prima dell'apertura. Fix probabile: passare clientDate al prompt di create_task con istruzione esplicita "interpreta date relative rispetto a clientDate".

- **Bug rendering UI tool name leak in chat (priorità ALTA pre-beta, issue 6a esteso a 6b).** I tool name compaiono come testo plain nella chat client ("ok update_plan_preview", "ok set_current_entry", "ok mark_entry_discussed"). Issue pre-esistente di Slice 6a (cancello rendering tool calls), ora confermato cross-slice anche per 6b con `update_plan_preview`. Causa probabile: il client renderer non filtra blocks `tool_use` dal payload assistente. Fix prioritario per UX pre-beta. Out-of-scope 6b implementation, in-scope pre-beta polish.

- **Phase guard 6b validation in smoke E2E: comportamento emergent desiderabile.** Smoke E2E ha confermato 4 invariant architetturali: (a) handler 3f respinge `update_plan_preview` in fase TRIAGE con `success: false` + error "fase non consente questa operazione"; (b) post Step 2a (sezione TOOL FAILURE HANDLING in prompts.ts) il modello LEGGE il tool_result di failure invece di hallucinare success; (c) il modello NON dichiara success quando vede `success: false`; (d) intent prematuri (es. pin/forcedSlot dichiarati dall'utente in fase triage) vengono memorizzati implicit dal context conversazionale del modello e applicati al primo legittimo `update_plan_preview` quando si entra in fase preview. Comportamento (d) emergent, da preservare in slice future.

- **Step 2a (TOOL FAILURE HANDLING in prompts.ts) sufficiente; Step 2b (orchestrator `is_error: true`) non necessario in V1.** Bug osservato in smoke E2E: modello hallucinava "Mail/Presentazione pinnata" su `update_plan_preview` failure, ignorando il `success: false` del tool_result. Diagnosi via log `[DEBUG-3i]`: il modello vedeva il failure ma il prompt non istruiva su come gestirlo. Fix Step 2a: sezione "TOOL FAILURE HANDLING" al blocco OVERRIDE CONVERSAZIONALI con 1 few-shot di failure path + tabella di traduzione error→messaggio utente + REGOLA "leggi tool_result PRIMA di dichiarare l'esito". Post-fix verificato: modello legge il failure e produce ack coerente. Format `JSON.stringify(result)` sufficiente — marker SDK strutturato `is_error: true` non necessario in V1.

- **Test override esplicitamente verificati in smoke E2E 6b.** 5 override path verdi: (1) `removes` singolo task, (2) `blockSlot` single fascia, (3) `durationOverride` con label `long`, (4) `moves` con overwrite forcedSlot e preserve durationLabel pre-esistente, (5) failure handling pre-fase (chiamata tool durante TRIAGE → ack onesto). Persistenza compositiva confermata: tutti gli override coesistono in `previewState` senza interferenze. Merge per-task overrides funzionante: setting `forcedSlot` non azzera `durationLabel` esistente, e viceversa (vedi `applyToolCallToState` D.1 in plan 6b). Tabella di smoke verde è baseline empirica per regression testing slice future.

- **Conflitto pin-vs-blockedSlot rilevato emergentemente dal modello (6b smoke turno 9).** Setup: `blockSlot: 'morning'` + presentazione/mail entrambe pinnate con `forcedSlot: 'morning'`. Stato semanticamente conflittuale: l'algoritmo `allocateTasks` applica fallback (`WARN_FORCED_SLOT_BLOCKED` + redistribuzione via residual logic) ma il piano risultante è degradato. Il modello ha sollevato il conflitto in chat con clarifying question all'utente ("ho la mattina bloccata ma X e Y sono pinnate lì, vuoi che le sposti o togliamo il blocco?"), invece di affidarsi al silent fallback server-side. Comportamento corretto, da preservare in prompt future. Tech debt eventuale per 6c o V1.1: rebuild logic con resolve automatico del conflitto (es. blockedSlots ha priorità su forcedSlot pinnato → degrade a slot residuo) + signal esplicito al modello dei conflitti rilevati.

## Decisioni tecniche emerse durante Slice 6c

- **Bug noto: drift comportamentale post-closing.** In fase phase=closing, se l'utente scrive un input neutro (es. "grazie", "ciao", saluti puri) NON match dei pattern espliciti B.5.4 ("ok va bene", "ok ciao", "blocca", ecc.), il modello replica l'ultimo update_plan_preview di successo come tool call (parametri identici), genera risposta "Prego. Il piano aggiornato arriva..." e re-attiva la conversazione come se fosse plan_preview. PHASE_MARKER: closing è correttamente applicato al modeContext server-side (verificato via log temporaneo durante smoke E2E Round 1, turno 12), ma il modello lo ignora per inerzia da history (history-based replay dell'ultimo tool call success).

- **Workaround utente in V1:** scrivere "ok ciao" / "va bene così" / equivalenti che matchano B.5.4 invece di saluti puri. Trigger ambiguo "ok"+saluto interpretato come confirm idempotente, no-op safe.

- **Fix architetturale rinviato a Slice 7.** La transizione phase=closing → state=completed + endedAt=now() chiuderà il thread atomicamente nella transazione di chiusura review serale. Nuova request del client non troverà thread aperti, attivare chat normale. Bug post-closing evapora per costruzione: niente più re-engagement, niente history per replay.

- **Smoke E2E Round 1 PASS (con riserva post-closing).** Flow critico verde: triage → preview → override (update_plan_preview) → confirm (confirm_plan_preview) → frase chiusura unica nello stesso turno (no acknowledge separato). PHASE_MARKER: closing scritto in DB e applicato a modeContext per turni successivi. Drift post-closing accettato come known issue V1.

- **Intent ambiguo "ok"+saluto.** B.5.4 lista pattern positivi include "ok per me", "ok va bene così", ecc. Il modello matcha "ok ciao" come confirm e chiama confirm_plan_preview idempotente (no-op se phase=closing già). Risposta è "Piano bloccato. A domani." (corretta B.5.6). Comportamento accettabile in V1: confirm idempotente è safe, frase finale corretta. Da rivedere post-beta se i tester segnalano che "ok ciao" senza intent confirm produce closing inatteso.

### Round 2 Smoke E2E — Verdict PASS-CON-RISERVA

Eseguito il 2026-05-05 alle 21:00 ora locale. Setup tipo 1 distorto (giornata 16h, 
OSL atteso=200, sensitivity=4 → fillRatio=0.5, ceiling=816 min, effective=480 min). 
Dataset 8 task con 3 deadline-immuni + 5 non-immuni. priorityScore fixate manualmente 
in Studio post-creazione (priority-engine non chiamato sui task creati via chat di 
Shadow). 15 turni totali, costo ~$0.65 Sonnet 4.5.

**Pattern testati con successo:**
- B.5.1 low_priority cut presentation (turno 10, snaturato 5/5 cut, frase corretta)
- B.5.2 inversione di agency ceiling (turno 13, frase verbatim few-shot riga 403, 
  ma solo dopo probing esplicito)
- B.5.4 trigger duale "togli" → update_plan_preview (turno 14, pulito)
- B.5.4 trigger duale "blocca" → confirm_plan_preview (turno 15, pulito)
- B.5.6 frase chiusura unica stile direct (turno 15: "Piano bloccato. A domani.")
- Persistenza pinnedTaskIds turn-on-turn (verifiche multiple su contextJson)
- applyToolCallToState removes filtra pinnedTaskIds correttamente (turno 14)
- Phase machine plan_preview → closing atomica (turno 15)

### Bug 1 (CRITICO) — applyTrimming Step 1 non rispetta pinnedTaskIds

Quando `previewState.pinnedTaskIds` ha task la cui somma durata supera 
`ceilingCapacityMinutes`, il sistema dovrebbe (piano 6c riga 124-133):
- return early con cut[]=[] e warnings=['pinned_exceeds_ceiling']
- lasciare la scelta del taglio all'utente

**Sintomo osservato:** con 5 pin attivi (presentazione+studio+riunione+mail+follow-up), 
il sistema ha applicato low_priority cut normale come se i pin non esistessero. Il 
modello al turno 13 cita verbatim: "il piano totale sforava la capacità giornaliera 
(20 ore contro 8 disponibili), quindi ho tagliato automaticamente i 5 task con priorità 
più bassa".

**Ipotesi root cause da investigare:**
- (a) Step 1 di applyTrimming non implementato in `src/lib/evening-review/trimming.ts`
- (b) Step 1 implementato ma `sumPinnedMinutes` calcolato male (es. usa durate dal 
      task catalog invece che dalle durate post-applyOverrides)
- (c) Step 1 implementato ma `warnings.push('pinned_exceeds_ceiling')` non viene 
      aggiunto al ritorno

**Test E.2 #14** (piano 6c riga 616) copre questo case con valori sintetici 
(4 task pinnati 9h totali, capacity raw=10h ceiling 8.5h). Verde negli unit test 
significa che Step 1 ESISTE. Sospetto è (b) o (c) — bug di integrazione fra unit 
test (sintetico) e flow E2E reale.

### Bug 2 (medio) — Drift LLM su previewState.pinnedTaskIds nel mode-context

Il `previewState.pinnedTaskIds` arriva correttamente al modello in mode-context 
(verificato indirettamente: dopo probing esplicito al turno 13, il modello cita 
correttamente "Hai pinnato cinque task: presentazione, studio, riunione, mail e 
follow-up"). Tuttavia in condizioni normali (turno 13 prima del probing), il 
modello asserisce "Non hai pinnato nessun task".

Diagnosi: drift LLM da inerzia. Ai turni 11-12 il modello tratta i pin come 
acknowledge transient ("Pinnato.") e nel turno 13 quando l'utente chiede sintesi, 
il modello ricostruisce la rappresentazione pre-pin invece di leggere il previewState 
corrente.

**Pattern simile al known issue Round 1 post-closing** (drift inerziale da history).

**Mitigazione V1.1:** rinforzare prompt B.5.X con few-shot positivi che dimostrano 
"sempre leggere previewState.pinnedTaskIds dal mode-context, non ricostruire da history".

### Bug 3 (medio) — Formula size→minutes diversa da specifica 4.1.1

Modello cita "20 ore contro 8 disponibili" → 1200 min su 8 task size=3 = 
**150 min/task**. Atteso con `AdaptiveProfile.optimalSessionLength=200` (verificato 
in Studio) e formula piano 6c §4.1.1 (`size 3 → 1.0 × OSL`) è **200 min/task**.

**Differenza:** server usa coefficiente diverso da 1.0 per size 3, oppure formula 
non-lineare, oppure legge OSL da fonte diversa.

**Ipotesi forte:** server legge `UserProfile.preferredSessionLength` (default=25 da 
schema) invece di `AdaptiveProfile.optimalSessionLength`. Se preferredSessionLength=25 
con qualche moltiplicatore non-banale, può dare 150. Da verificare in 
`src/lib/evening-review/duration-estimation.ts`.

### Issue minori osservate (non bug, da annotare per V1.1)

- **Issue A:** modello chiama `update_plan_preview` due volte separate per pin multipli 
  ("presentazione e studio" turno 11) invece di una chiamata combinata 
  `{pin: {taskIds: [A,B]}}`. Costo extra ~50% latenza. Funzionalmente equivalente 
  (union semantics piano 6b G.3). Da few-shot V1.1.

- **Issue B:** modello sotto-rappresenta il preview in prosa dopo i pin (turno 12). 
  Recita frase del turno 10 a memoria invece di leggere preview ricalcolato. 
  Compounding del bug 2.

- **Issue C:** modello rifiuta pin per ambiguità fittizia (turno 12-bis: "la riunione 
  è già nel piano" — falso, era in cut). Pattern di clarification eccessiva. Da 
  prompt-hardening V1.1.

- **Issue D:** triage del perimetro frozen al `triage.computedAt` (turno 1 della 
  review). Task creati DOPO l'apertura della review ma PRIMA del primo turno 
  effettivo non vengono mai inclusi in quella review. Slice 4 issue, riconfermato. 
  Mitigazione V1.1: refresh triage al primo turno effettivo.

- **Issue E:** classifier AI in mode general non chiama `add_task` tool su frasi 
  tipo "leggere articolo settoriale" (urgenza bassa). Risponde "Aggiunto" senza 
  effettiva tool call. Riprodotto 2/2 in setup Round 2. Pattern hallucinated tool 
  call. Workaround: insistere o creare via Studio. Da indagare con log delle 
  chiamate tool, fuori scope 6c.

### Tech debt: setup Sezione H non realistico con setup default

Il dataset 8 task del piano canonico Sezione H non produce simultaneamente 
`cut[]` visibile + ceiling sforabile con `optimalSessionLength=25` (default) e 
`sensitivity=4` (fillRatio=0.5). Round 2 ha richiesto setup distorto (OSL=200, 
manuale fix priorityScore in Studio) per esercitare i pattern target. Da 
ricalibrare la Sezione H se i tester della beta producono dataset reali con 
dinamiche diverse, o aggiungere alla spec una nota esplicita sul setup di test 
distorto richiesto.

Bug strutturale "modello replica tool calls in per_entry su history lunga" — blocca Round 2 Slice 6c.
Durante Round 2 di Slice 6c, dopo 9 turni per_entry corretti (8 task marcati kept, currentEntryId avanzato al 9° task), il modello ha smesso di calcolare nuovi tool call sul nuovo userMessage e ha iniziato a replicare meccanicamente l'ultima coppia mark_entry_discussed + set_current_entry del turno precedente. Sintomi runtime: outcomes invariato a 8, currentEntryId bloccato sul 9° task, modello in chat ripete "X — dimmi" sullo stesso task indipendentemente dal nuovo input ("la faccio domani"). Diagnosi via ChatMessage.payloadJson degli ultimi 4 messaggi assistant: il modello chiama mark_entry_discussed con entryId di un task già kept in outcomes, e set_current_entry punta sempre allo stesso cuid; handler ritorna cursor_already_set come segnale ignorato dal modello.
Famiglia "replica struttura ultima osservata", già osservata altrove durante Slice 6c testing:

"Task ricreato in eco al turno successivo" (creazione task multi-turno in morning_checkin/general).
"Le altre N candidate messe da parte" (apertura evening_review con excludedTaskIds=[] — modello inventa esclusi inesistenti per inerzia da few-shot prompt).

Test V1.1 #15 di Slice 5 non aveva esercitato per_entry su perimetri ≥9 task; il bug è latente fino a quando la history del thread non supera una soglia di lunghezza che attiva replica per inerzia. Implicazione operativa: per_entry non è affidabile su perimetri ampi in V1.1, riserva su Slice 5 chiusura più seria del previsto.
Mini-task dedicato pre-Slice 7: "Slice 5 V1.2 — replica tool calls in per_entry su history lunga". Prerequisito di Round 2 di Slice 6c. Approccio probabile: indagare prompts.ts sezione per_entry per istruzioni esplicite "se result è cursor_already_set, ricalcola entryId da outcomes e candidateTaskIds correnti", più eventuali few-shot negativi. Tech debt #18 (zero unit test orchestrator) rinforza priorità: senza test su loop multi-iteration con history lunga, regressione futura non rilevabile.
Stato Slice 6c post-Round 2 abortito: Round 1 PASS-CON-RISERVA confermato come stato finale provvisorio. Round 2 e Round 3 rinviati a post-fix Slice 5 V1.2. Slice 6c non committata, codice WIP locale.

## Slice 5 V1.x — replica pattern hardening (consolidato V1.2 → V1.3.2)

### Diagnosi unificata: history dominance

Il bug emerso in Round 2 Slice 6c (2026-05-06) e progressivamente chiarito dai retest 2026-05-07 → 2026-05-09 e' una sola classe architetturale: **history dominance**. In long history evening_review per_entry, il modello replica la struttura dell'ultimo turno valido invece di calcolare lo stato corrente da modeContext. Si manifesta in due forme:

- **(a) Tool-call replica**: il modello chiama tool sbagliati (mark/set su entry gia' processata). Detectabile handler-side via guard.
- **(b) Tool-call avoidance**: il modello smette di chiamare tool entirely e produce text response. NON detectabile handler-side (nessun guard fired): serve detection orchestrator-side post-turno.

V1.x consolida 6 iterazioni di fix che attaccano entrambe le forme a strati:

- **V1.2** (8 edit, handler-side mark guard): `executeMarkEntryDiscussed` rifiuta entry gia' in `outcomes` (non-parked) con `alreadyClosed=true`. Riformulazione SELF-CORRECTION HANDLING in prompts.ts. RULES OF STATE RECALCULATION + 5 negativi mirati ai sintomi famiglia.
- **V1.2.1** (3 edit, server-suggested next): `data.suggestedNextEntryId` calcolato two-pass (unprocessed first, parked fallback). Riduce carico cognitivo modello da "compute next" a "use this".
- **V1.2.2** (5 edit, alreadyOpen guard + escape hatch): `executeSetCurrentEntry` rifiuta `entryId === currentEntryId AND outcomes[entryId]===undefined` con `alreadyOpen=true`. Escape hatch `firstTurnAfterResume` settato da `active-thread/route.ts` su `paused -> active`. Field aggiunto a TriageState con JSDoc catastrofico.
- **V1.3** (7 edit, forced tool_choice): bug residuo "tool-call avoidance" emerso retest 2026-05-07. Orchestrator passa `tool_choice: { type: 'any' }` al first callLLM in turni a rischio. Field `selfCorrectedInPreviousTurn` aggiunto.
- **V1.3.1** (6 edit, refactor lifecycle): bug architetturale del clear handler-side scoperto retest 2026-05-09 (clear intra-turn sabotava force al turno N+1). CLEAR spostato da handler a orchestrator pre-callLLM.
- **V1.3.2** (4 edit, terzo trigger lastTurnWasTextOnly): bug residuo "modello smette di chiamare tool" (history dominance pura, NESSUN guard fired) emerso retest 2026-05-09 V1.3.1-F. Detection text-only post-turno + force al turno successivo. Field `lastTurnWasTextOnly` aggiunto.

### Pre-fix evidence (cronologia retest)

**Retest 2026-05-07 (post-V1.2.2)**: turni 12-17 producevano replica testuale `"Scrivere capitolo tesi - dimmi"` con `payloadJson === null` mentre `currentEntryId === t11`. V1.2.2 inerte perche' handler-side: funziona solo se modello chiama tool. Diagnosi: V1.2.x risolve "modello chiama tool sbagliato", NON "modello evita tool entirely". Triggera V1.3.

**Retest 2026-05-09 (post-V1.3)**: stderr telemetry mostra V1.2 + V1.2.2 + V1.3 detection firing al turno 12, ma turni 13-15 ancora replica testuale `payloadJson === null`. Diagnosi via lifecycle audit: clear handler-side `selfCorrectedInPreviousTurn` rimuoveva il flag NELLO STESSO turno del SET (multi-iteration loop intra-turn), non al turno N+1. Quando turno N+1 partiva, flag gia' false, isAtRiskTurn falso, force non applicato. Triggera V1.3.1.

**Retest 2026-05-09 (post-V1.3.1)**: lifecycle clear-pre-callLLM funziona ma turni 13-18 ancora `payloadJson === null` consecutivi. Diagnosi: V1.3 + V1.3.1 detectano solo "modello chiama tool sbagliato" via guard handler-side. Bug residuo: il modello smette di chiamare tool entirely (history dominance pura, NESSUN guard fired). Self-correction V1.3 inerte perche' richiede guard fire per settare flag. Triggera V1.3.2.

### Post-fix evidence V1.3.2 (retest 2026-05-09 sera) — PASS-con-riserva

Setup: 11 task seed via `scripts/seed-v1.3-replica-bug.ts`, per_entry sequenziale 15 turni utente.

Stderr telemetria osservata (4 prefissi distinti):
- `[V1.2 replica detection]` (1 fire al turno 15, mark su Scrivere capitolo tesi gia' kept).
- `[V1.3 forced tool_choice]` (3 fire come `at-risk turn detected: lastTurnWasTextOnly=true` + 1 fire come `set selfCorrectedInPreviousTurn=true trigger:alreadyClosed`).
- `[V1.3.2 set]` (3 fire su turni text-only).
- `[V1.3.2 clear]` (3 fire al turno N+1, lifecycle pulito SET → use → CLEAR).

Correlazione stderr × payloadJson:
- 3 turni text-only osservati (turn 1 apertura, turn 11, turn 14). Per ognuno: `[V1.3.2 set]` fired + flag persistito a contextJson.
- 2 turni recovery (turn 12 post-11, turn 15 post-14): `[V1.3 forced tool_choice] at-risk turn detected lastTurnWasTextOnly=true` + `[V1.3.2 clear]` + modello chiama tool. Lag 1 turno (atteso da design).
- Review chiusa correttamente: `outcomes={11 kept}`, transizione `phase=plan_preview` al turn 15 con piano in prosa.

Pre-fix vs post-fix delta:
- Pre-V1.3.2: turni 13-18 `payloadJson === null` consecutivi (loop 6 turni).
- Post-V1.3.2: max 1 turno text-only consecutivo, recovery via force al turno N+1. 2 episodi anomali isolati su 15 turni totali (~13% in fase per_entry).

### Known issue 1 — Hallucinated content turn

Il modello a volte produce text-only turn `[task title] — dimmi` per task NON `currentEntryId` mentre lo stato server-side e' corretto. Esempio retest 2026-05-09: turni 11 e 14 dicono "Preparare presentazione meeting — dimmi" mentre `currentEntryId` punta ad altra entry (Scrivere capitolo tesi al turno 11, Studiare per esame al turno 14). 

V1.3.2 forza tool call al turno successivo per recuperare. Effetto utente: 1-2 turni di confusione testuale per ogni episodio. Utente deve mandare un altro input ("si", "ok") per scatenare recovery turn.

Frequenza retest 2026-05-09: ~13% turni della fase per_entry. Mitigation V1.3.2 attiva.

Future fix candidato: V1.4 compaction history (attacca root cause history dominance, scope alto). Out-of-scope V1.x.

### Known issue 2 — V1.3.2 SET su turno 1 opening

Rilevato durante audit retest 2026-05-09: il turno 1 della review (formula apertura "Stasera ho N candidate...") e' text-only by design (nessun tool da chiamare al primo turno). Il predicate V1.3.2 `mode='evening_review' && phase='per_entry' && toolsExecuted.length===0` matcha questo caso e fa SET `lastTurnWasTextOnly=true` non desiderato.

Effetto: turno 2 viene forced con `tool_choice='any'`. Innocuo perche' al turno 2 il modello chiamerebbe `set_current_entry` comunque (apertura prima entry); il force ne accelera l'emissione senza side effect funzionale.

Frequenza: 1/15 turni della retest 2026-05-09 (turn 1 sempre, una volta per review). Low impact.

Future fix candidato: aggiungere predicate `&& isFirstTurn === false` o equivalent. Edit ristretto se diventa rilevante. Annotato per V1.4 o slice dedicata.

### Edit numbering V1.x cumulato (40 edit logici totali)

- **V1.2** (8 edit): handler mark guard, prompt CORE_IDENTITY refactor, riga 158 reformulation, RULES OF STATE RECALCULATION sezione, 5 negativi, SELF-CORRECTION HANDLING, puntatore tabella.
- **V1.2.1** (3 edit): handler two-pass suggestedNextEntryId, 4 nuovi test, prompt update.
- **V1.2.2** (5 edit): triage.ts campo firstTurnAfterResume, tools.ts handler V1.2.2 alreadyOpen + clear, tools.test.ts 8 nuovi test, active-thread/route.ts paused→active detection, prompts.ts 4 cambiamenti.
- **V1.3** (7 edit): client.ts ToolChoiceParam, tools.ts log suffix V1.3 + clear handler-side (poi rimosso V1.3.1), tools.test.ts 5 test V1.3, triage.ts campo selfCorrectedInPreviousTurn, orchestrator.ts Blocco A/B/C, scripts/seed-v1.3-replica-bug.ts, deploy-notes update.
- **V1.3.1** (6 edit): tools.ts clear handler-side rimosso, tools.test.ts 2 test V1.3 aggiornati a "preserves" + 1 regression test, orchestrator.ts clear pre-callLLM (V1.3.1-C), triage.ts JSDoc lifecycle, orchestrator.ts telemetria [V1.3.1 clear] (V1.3.1-F).
- **V1.3.2** (4 edit): triage.ts campo lastTurnWasTextOnly, orchestrator.ts B1 predicate + B2 telemetria + B3 clear, orchestrator.ts SET post for-loop pre-commit (V1.3.2-C). D skip per assenza suite orchestrator test.

Il seed script V1.3 setta `createdAt = NOW - 1h` sui task creati per evitare che `selectCandidates` filtri task troppo recenti. 1h di age e' sufficiente per evitare il filtro ma marca i task come "in inbox da poco". Pattern utilizzabile per future seed E2E che richiedono task "in inbox da almeno qualche tempo".

### Tech debt #18 — zero unit test orchestrator (inalterato)

V1.3 + V1.3.1 + V1.3.2 SET/CLEAR/predicate orchestrator-side NON coperti da unit test. Verificati solo via:
- Retest E2E manuale (2026-05-07, 2026-05-09 ×3).
- Integration tests handler-side (260 verdi continuano a passare = no regression handler-side).

Refactor candidato future slice: estrarre helper `shouldForceToolChoice(triageState, mode)` + `shouldSetTextOnlyFlag(toolsExecuted, effectivePhase)` + `shouldClearAtRiskFlags(triageState)` come pure functions in nuovo `src/lib/chat/at-risk-detection.ts`, testabili isolate, lasciando orchestrator thin wiring layer. Stima: ~30min refactor + 10-15 test.

### Tech debt #19 — Helper esportato `reconstructEveningReviewPreview`

Single source of truth tra orchestrator e tooling esterno (script di debug, future test E2E, route di diagnostica). Estrarre `orchestrator.ts:153-228` (loadAllNonTerminalTasks fetch + previewProfile/previewSettings construction + candidateTasks via computeEffectiveList + localBaseInput build + applyPreviewOverrides + buildDailyPlanPreview) in modulo dedicato `src/lib/evening-review/preview-reconstruction.ts`.

Scope: non urgente, valutare pre-Slice 8 quando emergerà pressione concreta (es. debug route per ispezione preview live, regression test orchestrator). Decisione presa durante audit retest 6c (Antonio + Claude.ai chat strategico) per non introdurre scope creep nel retest 6c stesso.

### Tech debt — date convention split (Rome triage vs UTC DailyPlan/Review)

Discrepancy emerso durante implementazione del seed script V1.3 Edit 6/9:

- **Triage evening_review**: `formatTodayInRome()` in `orchestrator.ts` usa `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })`.
- **DailyPlan.date** (`daily-plan/route.ts:89`): `new Date().toISOString().split('T')[0]` — UTC YYYY-MM-DD.
- **Review.date** (`review/route.ts:14`): stesso pattern UTC.

Edge case (00:00-02:00 Rome, CEST=UTC+2): utente apre Shadow alle 00:30 Rome (UTC 22:30 di ieri), il piano "per domani" finisce con `date='ieri'` nel DB (UTC del giorno precedente).

Status: out-of-scope V1.x. Non triggera bug funzionale nella fascia 20:00-23:00 Rome (le due timezone collassano). Candidato per slice dedicata pre-beta:
- (a) unificare a UTC tutto.
- (b) unificare a Europe/Rome tutto (richiede `Settings.timezone`, Slice 9 candidata).
- (c) documentare convention split + fix solo edge case 00:00-02:00.

### Sessione 2 — Retest regressione 6a/6b (13 maggio 2026)

Sessione 2 retest manuale 13 maggio 2026, ~20:00-20:45 ora Roma.
Validation retrospettiva che commit aad2bfd (Slice 6c) non rompa
funzionalita Slice 6a/6b esistenti.

Setup:
- Account Alberto `cmp1flw1g005oibvckzsenuqm`, VIRGIN OK 12/12.
- 8 task overflow-controllato (riusato setup Sessione 1, NON 6 task
  come da piano 6b Sezione G originale).
- Settings: wakeTime=07:00, sleepTime=23:00, finestra serale standard.
- AdaptiveProfile: sensitivity=4, optimalSessionLength=25.
- Thread `cmp4dla8v0001ibu4g1vuh8lt`, scenario "Override classici" 12 turni.

Risultati verifica prompt 6b (target 6/6):
- Punto 1 (chiama `update_plan_preview` su override esplicito): PASS netto
  su 3 turni (turno 9 combinato, 10 blockSlot, 11 pin).
- Punto 2 (combina parametri in chiamata unica): PASS netto, turno 9
  input verbatim `{"removes":[...], "moves":[...]}` singola chiamata.
- Punto 3 (blockSlot da paraphrase): PASS NETTO + robustezza
  paraphrase. Frase test adattata da "sto male" a "non avro tempo"
  per realismo utente ADHD. Modello generalizza correttamente lo slot
  block oltre il pattern letterale del prompt few-shot.
- Punto 4 (preview ricalcolato in prosa coerente): PASS-CON-RISERVA.
  Risposte sintetiche ("Mattina libera.", "Bozza presentazione pinnata.",
  "Piano bloccato. A domani."). NON ripresentano il preview esteso in
  prosa. Pattern noto, tech debt #20 confermato (vedi sotto).
- Punto 5 (NO tool su conferma generica): OBSOLETO post-6c. La voce
  era basata su mondo pre-`confirm_plan_preview`. Comportamento osservato
  ("ok per me" -> `confirm_plan_preview`) e la transizione phase a
  `closing` corretta in mondo post-6c. NOT a fail.
- Punto 6 (chiede chiarimento su ambiguita "piu corta"): NON TESTATO
  in questa sessione. Scenario letterale 6b Sezione G non lo richiedeva.
  Deferred a retest unificato post-prompt-hardening future.

Risultato Slice 6a regressione: PASS IMPLICITO. Scenario 6b ha
attraversato turni 1-8 (presentazione preview senza override) senza
errori. Preview generato correttamente, fasce qualitative coerenti
("Domani mattina X, pomeriggio Y, sera Z"). Cut[] popolato come atteso
("Sono troppe per domani. Tengo queste sei, le altre due dopodomani").
Determinismo server-side confermato: preview Sessione 2 quasi-identico
a Sessione 1 stesso setup, differenze minime ("la bolletta" vs
"bolletta", "preparazione" vs "preparare").

Anomalie ambientali Sessione 2 (NON imputabili a commit 6c):
- Errore TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE` alla prima chiamata
  `callLLM`. Curl conferma persistenza (SCHANNEL `CRYPT_E_NO_REVOCATION_CHECK`).
  Workaround dev-only applicato: `NODE_TLS_REJECT_UNAUTHORIZED=0` in
  shell environment scope (NON in `.env.local`). Causa non diagnosticata:
  probabile AV/firewall TLS scanning attivato durante giornata, oppure
  rotazione cert Anthropic. Tech debt: indagine TLS reale (opzioni A/B/D
  dalla diagnostica originale) prima di sessioni di coding pesanti future.

Adattamenti R3 durante retest (annotati per audit future):
- Setup 8 task invece di 6 (riuso configurazione Sessione 1 invece di
  re-seed con setup specifico 6b). Nessun impatto sui risultati: i
  meccanismi testati (override classici, blockSlot, pin) sono
  ortogonali al numero totale di task.
- Task scelti per moves+removes turno 9: T3 Preparare riunione +
  T7 Telefonata commercialista (entrambi non-immune, no deadline).
  La frase originale "togli la mail e sposta lo studio" non si
  mappava al setup 8-task (T5 Studio e T1 Mail erano in cut[],
  fuori dal piano).

Decisione strategica:
- Commit aad2bfd validato due volte: scenario H 6c (ieri) +
  regressione 6b/6a (oggi). Production-ready dal punto di vista
  funzionale.
- Push su `origin/main` deferred a sessione futura: indagine TLS
  ambientale prerequisita per evitare rischio fallimento push.
- Niente fix prompt 6b necessario. Tech debt #20 (risposta sintetica
  modello) registrato per slice future di prompt-hardening, NON
  blocker per beta.

### Tech debt #20 — Risposta sintetica modello su update_plan_preview

Pattern osservato durante retest Slice 6c Sessione 1 (12 maggio) e
riconfermato in Sessione 2 (13 maggio). Quando il modello chiama
update_plan_preview con override semplici, risponde con frasi
stringate ("Studio libro pinnato.", "Mattina libera.", "Bozza
presentazione pinnata.", "Riunione via, commercialista di sera.")
invece di ripresentare il preview aggiornato in prosa estesa con
fasce/durate/cut. Funzionalmente OK (tool eseguito + state aggiornato
in DB), ma UX subottimale per utente reale che non vede subito
l'effetto dell'override sul piano completo.

Possibile fix in slice future di prompt-hardening: rinforzo few-shot
in EVENING_REVIEW_PROMPT sezione plan_preview con esempi positivi di
ripresentazione preview post-override. Non blocker per beta. Valutare
costo (tokens aggiunti al prompt) vs benefit (chiarezza UX) prima di
fix.

### Tech debt #21 — Tool update_plan_preview manca parametro unpin esplicito

Pattern osservato durante retest Slice 6c Sessione 1. Il tool
update_plan_preview ha 6 parametri: moves, removes, adds, blockSlot,
durationOverride, pin. Manca un parametro unpin per togliere
esplicitamente un task dal pinnedTaskIds senza rimuoverlo dal piano.

Comportamento attuale: utente dice "togli X dai pinnati", modello
chiama update_plan_preview({removes: [{taskId: X}]}). Server-side,
applyPreviewOverrides cleanup automatico rimuove X anche da
pinnedTaskIds come side effect (semantica "remove from plan" piu
forte di "unpin").

Funzionalmente l'utente ottiene un comportamento ragionevole, ma
semanticamente ambiguo. Slice future potrebbero voler distinguere
"sposta dal piano" da "togli pin ma resta nel piano". Non blocker
per beta.

## Decisioni tecniche emerse durante Slice 7

- **Convenzione validation: NO Zod, validator manuale stile clampInt.**
  Decisione cardinale Antonio ratificata in STEP 2. Codebase non aveva
  import Zod precedenti; pattern allineato a executeAddCandidateToReview /
  executeCreateTask: cast + type check + range check, ritorno
  {ok:false, error} su input invalido. NON coercive per record_mood_intake
  e mark_what_blocked_asked (value invalido -> errore visibile al modello
  via tool_result, non clamp silenzioso). clampInt coercive resta per
  set_user_energy (pre-esistente, contesto morning_checkin meno critico).
  Persistito come feedback Claude Code per slice future
  (feedback_no_zod_use_manual_validator).

- **Back-track WhatBlocked detection: tool dedicato vs pattern matching.**
  Decisione iniziale STEP 3.2 D-D ("NIENTE tool dedicato + cattura
  server-side via anchor") rivista in STEP 3.3 esplorazione. Motivazione:
  le 3 anchor phrase nel prompt EVENING_REVIEW WHAT BLOCKED DETECTION
  sono soft (variazione per preferredPromptStyle, modello produce
  parafrasi naturali in produzione). Pattern matching substring
  case-insensitive su anchor letterali avrebbe avuto false-negative
  alto (50%+ entry recentlyPostponed perse). Adottato pattern speculare
  a DECOMPOSITION_PROPOSED: nuovo tool zero-side-effect
  mark_what_blocked_asked(taskId) setta flag pendingWhatBlockedForTaskId
  in triageState, orchestrator capta next user message come reason e
  appende a whatBlocked in formato D2 con clear automatico. Costo:
  +1 tool nel catalog (~50 token context). Beneficio: determinismo +
  coerenza pattern con resto codebase + idempotenza esposta via flag
  WHAT_BLOCKED_ASKED_FOR nel modeContext.

- **Skip STEP 4 metadata.reviewClosed nel payload assistant.**
  OPZIONE Y ratificata via esplorazione empirica route.ts (72 righe,
  pass-through verbatim di OrchestratorOutput, nessun campo metadata
  schema-flessibile) e ChatView.tsx (518 righe, message-appender
  generico, zero logica condizionale su review state). YAGNI
  applicato: aggiungere reviewClosed a OrchestratorOutput sarebbe
  3 righe per zero consumer attivi. Optionality preservata: se
  UX futura (banner "Review chiusa" o disable input post-close)
  emerge in slice futura, estensione triviale, nessun debito
  architetturale accumulato. Backend gestisce gracefully turni
  post-close via prompt FASE CLOSING ("rispondi minimale e neutro").

- **WhatBlocked capture refactor: helper esportato per testabilita'.**
  Inline block EDIT 3 in orchestrator.ts (33 righe) estratto in
  src/lib/evening-review/what-blocked-capture.ts come funzione pura
  captureWhatBlocked(triageState, allTasks, userMessage) -> TriageState.
  Motivazione: STEP 5 B/C copertura scenario 4 brief (whatBlocked
  multipli) richiedeva test isolato. Helper accetta tipo strutturale
  minimale Array<{id, title}> invece di TaskProjection completo per
  test puri senza dipendenze dal dominio orchestrator.

- **Flush parziale su closeReview kind nel single-writer pattern.**
  EDIT 6 orchestrator.ts ha esteso il blocco $transaction finale con
  3 branch (reviewClosed === null / alreadyClosed=true / alreadyClosed=false).
  Branch alreadyClosed skippa thread.update completamente (double-click
  idempotente, niente da aggiornare su thread terminato). Branch
  !alreadyClosed esegue update parziale con SOLO lastTurnAt (no
  contextJson sovrascritto su thread chiuso). Opzione B ratificata
  per riuso threadUpdateData.lastTurnAt invece di nuovo new Date():
  un solo timestamp per turno indipendentemente dalla branch,
  coerenza temporale + testing futuro piu' predicibile.

- **TriageState retro-compatibilita' preservata.** 3 nuovi campi
  opzionali (moodIntake, whatBlocked, pendingWhatBlockedForTaskId)
  aggiunti senza mutare/rimuovere campi V1.x. Thread Slice 6c
  pre-deploy continuano a funzionare via ?? undefined defaults.
  Zero migration richiesta.

- **Scenario 6 E2E (paused/resumed/closed) rimandato a test manuale.**
  docs/tasks/05-slice-7-manual-test-plan.md scrive il plan
  pre-beta. Full E2E orchestrate() con LLM mock richiederebbe
  infrastruttura nuova (~700 righe setup) non presente nel codebase
  (zero precedenti E2E orchestrate). Hardening V1.2.2 in Slice 5 +
  test puri firstTurnAfterResume lifecycle in triage.test.ts
  coprono l'80% del rischio. Automation possibile in Slice 9 o
  post-beta quando E2E infra arriva (stima ~150 righe per scenario).

## Decisioni tecniche emerse durante retest Slice 7 V1.1 (14 maggio 2026)

Retest E2E manuale su virgin account, 5 scenari ridotti dai 9 originali per
coprire i flow critici post-Slice 7 senza re-eseguire smoke gia' verde in
Slice 5/6.

- **Esito retest E2E (5 scenari).** Scenario 1 PASS netto (BUG #A phase-gated
  tools, #B DailyPlanTask populate, #C auto-new-thread tutti validati). Scenario
  2 PASS netto (idempotenza closeReview, 11/11 indicatori, validato via
  `scripts/replay-close-review.ts` non committato in .gitignore). Scenario 3
  PASS sostanziale (bug #1 mood default derubricato a cosmetico, bug #8
  confermato in flight). Scenario 4 coperto naturalmente dentro Scenario 2
  (path whatBlocked validato quando postponedCount=4 + deadline <=48h
  coincidono). Scenario 6 PASS sostanziale (resume paused->active funziona UX
  ma bug #12 normalize isolato).

- **Suite Vitest stabile.** 364/364 verdi su 19 file, inalterata dall'inizio
  retest. Nessuna regressione introdotta dai 4 commit di fix (BUG #A/B/C +
  E2E orchestrator regression test STEP 4).

- **Pattern replay E2E manuale via script.** Per validare idempotenza
  closeReview senza E2E infra (rimandata, vedi sezione Slice 7), introdotto
  pattern `scripts/replay-<scenario>.ts` con seed DB + invocazione diretta
  closeReview() + verifica indicatori post-condition. Pattern non committato
  (gitignore `scripts/replay-*.ts`) per evitare scripts ad-hoc inquinanti nel
  repo. Riusabile per debug bug futuri toccando closeReview o triage.

- **Inventario bug noti V1.x aggiornato post-retest.** Numerazione: #10 non
  assegnato (saltato durante retest, non riassegnare per traccia storica).
  Stati validati o aperti, prioritizzati per fix imminente.

  - **#1 -- Mood intake default 3 al primo turno.** DERUBRICATO a cosmetico
    in Scenario 3: overwrite via contextJson funziona, valore finale corretto.
    Priorita' bassa, fix opzionale pre-beta.
  - **#2 -- UI leakage tool name sotto bubble assistant.** Confermato in tutti
    gli scenari. "ok <tool_name>" reso sotto ogni bubble post-tool-call.
    Cosmetico ma visibile, priorita' bassa.
  - **#3 -- "domani" incoerente con scadenza odierna.** Non riscontrato in
    retest. Priorita' bassa, candidato a chiusura se non ricompare in Slice 8.
  - **#4 -- Race W1 morning planner vs W2 closeReview su DailyPlan.** Non
    testato in retest (richiede setup multi-window). Aperto, priorita' media,
    da affrontare con scenario dedicato.
  - **#5 -- `loadPreviewStateFromContext` no shape validation.** Non testato.
    Aperto, priorita' media, hardening di robustezza non blocker.
  - **#6 -- Wake-up "Inizia review" richiede userMessage per partire.**
    Confermato. Gap di scoping noto da Slice 4 (vedi sezione Slice 4),
    priorita' media, target V1.2.
  - **#7 -- `update_plan_preview` non chiamato dal modello (prosa libera).**
    Confermato in 3/3 scenari E2E. Gap di Slice 6 incompleto, priorita' media,
    da affrontare in slice dedicata di prompt-hardening (forced tool_choice
    o esempi few-shot positivi), non tattico.
  - **#8 -- `record_mood_intake {value}` singolo replicato su mood+energyEnd.**
    Confermato Scenario 3 via contextJson `{mood:5, energyEnd:5}`. Design
    issue dello schema tool (mood != energia ma stesso input). Priorita' media,
    cardinale aperta: split in due tool separati `record_mood` + `record_energy`
    vs single tool con `{mood, energy}` esplicito.
  - **#9 NEW -- `DailyPlan.top3Ids` non riflette `DailyPlanTask` quando piano
    >3 task.** Emerso Scenario 2. Possibile semantica legacy del campo
    `top3Ids` (esistente da prima di Slice 5-7) come "top 3 prioritari" e non
    "tutti i task del piano". Priorita' media, indagine richiesta in
    `src/lib/evening-review/close-review.ts` prima di decidere se bug o
    invariante voluto.
  - **#11 NEW -- `mark_what_blocked_asked` non-deterministico per
    `postponedCount>=3`.** Scattato in Scenario 2, NON scattato in Scenario 3
    e 6 per task con stato DB equivalente. Priorita' media, indagine richiesta
    in `EVENING_REVIEW_PROMPT` (rinforzo trigger) o tool description.
  - **#12 NEW (CRITICO) [CHIUSO 14 maggio 2026 — vedi bullet di
    chiusura sotto] -- `normalizeThreadState paused->active` non scatta
    mai durante flow.** Emerso Scenario 6: thread paused riceve turn via
    `POST /api/chat/turn`, lastTurnAt e contextJson aggiornati, ma `state`
    resta `paused`. `GET /api/chat/active-thread` non chiama `normalize` come
    previsto dal briefing Slice 3 (ramo `inside_window_active`). closeReview
    funziona comunque perche' $transaction scrive state=`completed` diretto
    indipendentemente da paused/active. Priorita' media-alta, prossimo fix.

- **Diagnosi pre-fatte per fix imminenti (da validare).**

  - **#12.** File da indagare: route handler `GET /api/chat/active-thread`
    (path completo da verificare via grep), modulo `normalizeThreadState` se
    esiste separato. Ipotesi: la call al normalize e' stata rimossa o non
    montata sul ramo `inside_window_active`. Conferma sperimentale gia'
    raccolta in retest: thread paused con `lastTurnAt` recente persiste come
    inconsistenza semantica osservabile in DB.

  - **#9.** File da indagare: `src/lib/evening-review/close-review.ts` per
    popolamento `top3Ids`. Ipotesi: hardcoded slice(0, 3) su lista pinned
    ordinata, semantica "top 3 prioritari" non "tutti". Da confermare leggendo
    il codice prima di proporre fix.

  - **#2.** File da indagare: `src/features/chat/ChatView.tsx` per render
    `payloadJson.toolName`, oppure `EVENING_REVIEW_PROMPT` se "ok <toolname>"
    e' richiesto esplicitamente al modello come ack post-tool. Ipotesi:
    leakage UI side, non prompt side (i prompt non hanno reference noti a
    "ok <tool>").

  - **#11.** File da indagare: `src/lib/chat/prompts.ts` `EVENING_REVIEW_PROMPT`
    sezione DECOMPOSITION_PROPOSED + WHAT_BLOCKED_ASKED_FOR per coerenza
    trigger, e tool description di `mark_what_blocked_asked` per chiarezza
    condizioni. Ipotesi: trigger semantico soft, non-determinismo LLM su
    contesto equivalente. Mitigazione strutturale possibile (esempi few-shot
    positivi) ma non garantita.

  - **#8.** File da indagare: `src/lib/chat/tools.ts` per schema
    `record_mood_intake` + dispatcher in orchestrator. Ipotesi: schema
    `{value: number}` ambiguo, dispatcher applica value a entrambi i campi
    `moodIntake.mood` e `moodIntake.energyEnd` per semplicita'. Fix strutturale
    cardinale aperta (vedi #8 sopra).

- **Cleanup artefatti retest deferito.** Test user `cmp1flw1g005oibvckzsenuqm`
  conserva ChatThread/Review/DailyPlan dell'ultimo Scenario 6
  (`cmp5uw7tu003libbodpo0t0qj`, `cmp5v3t9z004libbolp96zkxm`,
  `cmp5v3tma004nibboxzbc8pdd`). Non bloccante per fix futuri, cleanup in fase
  test successiva. Settings ripristinate a default Slice 1
  (`eveningWindowStart='20:00'`, `eveningWindowEnd='23:00'`).

- **Bug #12 chiuso come non-bug (14 maggio 2026).** Diagnostica statica su
  `src/app/api/chat/active-thread/route.ts` ha confermato che la call a
  `normalizeThreadState` e' correttamente montata al ramo `evening_review`
  (riga 208-214) e il write su `state` e' correttamente gated su
  `shouldPersist` (riga 248-257). L'osservazione di Scenario 6 (thread
  `paused` riceve turn, `lastTurnAt` aggiornato, `state` resta `paused`)
  descrive l'invariante Slice 3 in azione, non una sua violazione:
  l'orchestrator non tocca `state` per design, e `ChatView` chiama
  `GET /api/chat/active-thread` solo al mount (riga 86), quindi tra un
  turn e l'altro durante una review live `normalize` non gira. La
  transizione `paused -> active` avviene al successivo passaggio per
  `active-thread` (mount/refetch), coerentemente con l'invariante
  Slice 3 documentata in deploy-notes:34 (`normalizeThreadState` unico
  meccanismo di resume `paused -> active`). Lacuna scoperta in parallelo:
  il test C11 citato come copertura ufficiale dell'invariante non
  esisteva nel repo (i commenti C8/C10/C11 in `normalize.ts` puntano a
  `scripts/test-normalize.ts`, file non presente -- possibile script di
  sviluppo non committato in passato). Aggiunto unit test puro
  `src/lib/evening-review/normalize.test.ts` per il ramo
  `inside_window_active` (paused + elapsed < `inactivityPauseMinutes`
  -> active, `shouldPersist=true`) a blindare il modulo in vista di
  Slice 8.

