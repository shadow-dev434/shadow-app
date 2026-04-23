# Task 2 — Fix flow onboarding iniziale

> Primo task della Fase 1 post-Task 1. Sblocca Task 3 (chat fixes) e Task 5
> (review serale) che dipendono dal profilo adattivo popolato correttamente.

---

## Problema

L'onboarding conversazionale di Shadow **esiste già** (implementato nel
componente `OnboardingView` in `src/app/page.tsx` e supportato dalla route
`src/app/api/onboarding/route.ts`). È progettato per raccogliere ~40 dimensioni
comportamentali via `generateOnboardingQuestion` che popolano `UserProfile` e
`AdaptiveProfile`.

**Ma**:

1. **Non parte automaticamente dopo registrazione.** Un utente appena registrato
   viene mandato direttamente alla chat o alla lista task, saltando l'onboarding.
2. **Un pezzo di onboarding parte quando si apre `/tasks`** — probabilmente un
   residuo di un flow precedente. Va rimosso da lì.
3. **La chat e la review serale leggono dal profilo adattivo vuoto** — quindi
   non hanno dati per personalizzare il comportamento.

### Domanda da verificare all'inizio del task

Prima di iniziare il fix, Claude Code deve **mappare il flow attuale** leggendo:
- `src/middleware.ts` — che logica di redirect post-login c'è?
- `src/app/page.tsx` — come viene deciso se mostrare `OnboardingView` vs altre view?
- `src/app/tasks/page.tsx` — che tipo di onboarding-like compare qui?
- `prisma/schema.prisma` — dove vive il flag "onboarding completato"?
  (Probabilmente `UserProfile.onboardingCompleted` o simile — verificare)

Dal report di audit originale sappiamo che `OnboardingView` è alla riga ~1323
del file `page.tsx` e occupa ~640 righe. Esiste anche `generateOnboardingQuestion`
come funzione AI-guided.

---

## Obiettivo

1. **Nuovo utente registrato** → vede onboarding completo come prima schermata,
   prima di chat o task list
2. **Onboarding completato** → popola correttamente `AdaptiveProfile` e
   `UserProfile` con tutte le dimensioni previste
3. **Utente con onboarding già completato** → non rivede mai l'onboarding, accede
   direttamente alla chat
4. **`/tasks`** → non lancia più alcun prompt/modale onboarding-like. Se ospitava
   logica onboarding residua, rimuoverla (o spostarla nell'onboarding principale
   se raccoglieva dati utili non presenti altrove)

---

## Piano di esecuzione

### Step 1 — Mappatura flow attuale

**Non scrivere codice in questo step.** Produci un report testuale di:

1. Dove viene deciso il primo redirect post-login/signup (middleware? page.tsx?)
2. Come viene determinato se un utente ha completato l'onboarding (quale campo DB?)
3. Quali campi del `AdaptiveProfile` / `UserProfile` sono popolati
   dall'onboarding principale (`OnboardingView`)
4. Quali campi vengono invece popolati dal pezzo onboarding-like in `/tasks`
5. Overlap: se `/tasks` raccoglie dati che l'onboarding principale non copre,
   quali sono?

Output: `docs/tasks/02-onboarding-flow-map.md` con questo report. Ferma qui e
aspetta review di Antonio prima di Step 2.

### Step 2 — Decisioni di design

Basandosi sul report dello Step 1, Antonio decide (insieme a Claude Code):

- Il pezzo onboarding-like in `/tasks` va **rimosso** (se duplicato) o
  **integrato** (se raccoglie dati unici) nell'onboarding principale?
- Il trigger onboarding va in middleware (redirect server-side) o in page.tsx
  (condizionale client-side)?
- Se l'utente interrompe l'onboarding a metà e chiude la app, cosa succede al
  prossimo accesso? Riprende da dove aveva lasciato o ricomincia?

### Step 3 — Implementazione

In base alle decisioni dello Step 2:

1. **Flag completamento**: assicurarsi che esista un campo chiaro tipo
   `UserProfile.onboardingCompleted: boolean` (default `false`). Se manca,
   aggiungere via schema change + `prisma db push`.
2. **Trigger onboarding**: redirect l'utente verso la view `OnboardingView`
   finché `onboardingCompleted === false`. Modificare `src/middleware.ts` o
   la logica di routing in `src/app/page.tsx` a seconda di Step 2.
3. **Completion**: quando l'utente finisce tutte le domande dell'onboarding,
   settare il flag a `true` via `PATCH /api/onboarding` (o endpoint esistente).
4. **Pulizia `/tasks`**: rimuovere il codice onboarding-like da
   `src/app/tasks/page.tsx`. Se raccoglieva dati unici, integrarli
   nell'onboarding principale (nuove domande in `generateOnboardingQuestion`
   o componente dedicato).
5. **Resume capability** (se decisa in Step 2): tracciare l'ultima domanda
   risposta in DB, alla riapertura della app riprendere da lì.

### Step 4 — Verifica

```bash
bun run lint
bun run build
```

Poi verifiche manuali (Acceptance test sotto).

### Step 5 — Commit

Commit atomico:
```
fix(onboarding): ensure onboarding runs before first app access

- Reroute new users to OnboardingView until onboardingCompleted = true
- Remove onboarding-like prompt from /tasks (duplicated/misplaced)
- [se applicabile] Integrate data previously collected in /tasks into
  main onboarding flow
- [se applicabile] Add onboarding resume capability for incomplete sessions
```

No push — Antonio fa review prima.

---

## Acceptance test (manuali)

### Test 1 — Nuovo utente vede onboarding

1. Registrare un nuovo utente
2. Subito dopo registrazione, utente deve vedere **prima schermata
   dell'onboarding**, non chat o lista task
3. Completare tutte le domande
4. Alla fine, utente viene mandato alla chat (o dashboard)
5. Ricaricare la pagina → utente è nella chat, non rivede onboarding

### Test 2 — Utente esistente non rivede onboarding

1. Fare login con un utente che ha già completato l'onboarding (idealmente
   creato durante Task 1 acceptance test — se no, crearne uno nuovo e
   completare onboarding in Test 1)
2. Dopo login, utente va direttamente in chat (o dashboard)
3. Non deve vedere nessuna schermata onboarding

### Test 3 — `/tasks` non lancia onboarding

1. Utente loggato con onboarding completato
2. Naviga a `/tasks`
3. Vede la lista task normale, **nessun prompt onboarding-like**, nessuna
   raccolta dati stile "dimmi di te"

### Test 4 — Profile popolato correttamente

1. Registrare nuovo utente, completare onboarding
2. Aprire Prisma Studio, tabella `AdaptiveProfile`
3. Verificare che il record di questo utente abbia i campi principali valorizzati:
   `executiveLoad`, `avoidanceProfile`, `activationDifficulty`, `frictionSensitivity`,
   `preferredPromptStyle`, ecc. (lista esatta dipende dall'onboarding —
   verificare con Step 1 quali campi vengono popolati)
4. Tabella `UserProfile`: campo `onboardingCompleted` = `true`

### Test 5 — Resume (se implementato)

1. Iniziare onboarding con nuovo utente
2. Rispondere a 2-3 domande
3. Chiudere browser
4. Riaprire e fare login
5. Utente riprende onboarding **dalla domanda dove si era fermato**, non da capo

---

## Deliverable finale

Claude Code deve restituire:

1. Lista file modificati/creati/cancellati
2. Report Step 1 (mappatura flow) se non già condiviso
3. Decisioni prese in Step 2 (se prese in autonomia, motivare)
4. Output `bun run build` (deve passare)
5. Conferma pulizia `/tasks` (grep per confermare rimozione logica onboarding)
6. Riepilogo: "5/5 test manuali documentati, Antonio li esegue dopo push"
