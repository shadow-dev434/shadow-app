# Task 43 — Fix bug beta: review serale non parte + loop check-in emotivo

> Bug rilevati da Antonio usando l'app (2026-06-14). Diagnosi confermata con
> verifica adversariale (workflow `shadow-two-bugs-diagnose`, 7 agenti).
> Decisioni di prodotto: Bug 1 → banner in chat; Bug 2 → cooldown ~30 min.

---

## Bug 1 — La review serale non parte (e non si avvia dalla chat)

### Sintomo
Alle 20:28, dentro la finestra serale, la review non si apre. La chat companion
risponde che non può avviarla e suggerisce "esci e rientra" — che non funziona.

### Causa (confermata)
1. Il thread di chat resta `state='active'` **per sempre**: nessuna transizione
   automatica active→archived (commento esplicito in
   `src/app/api/chat/bootstrap/route.ts:29-34`).
2. In `GET /api/chat/active-thread`, `computeEveningReview()` è chiamata **solo
   nel ramo `!thread`** (`route.ts:332-336`). Con un thread attivo, la route
   ritorna `eveningReview:{shouldStart:false}` hardcoded (`route.ts:372`).
3. La "spina re-entry 8c" archivia i thread non-serali solo con gap di inattività
   **≥3 giorni** (`route.ts:283-330`, `inactivity-gap.ts:59`,
   `RE_ENTRY_RECOGNITION_THRESHOLD_DAYS=3`). Un thread usato la sera stessa
   (gap=0 → `null`) non viene mai archiviato.
4. Lato client, `EveningReviewCard` compare solo se `messages.length===0`
   (`ChatView.tsx:331`). Con thread riattivato pieno di messaggi → nessun
   punto d'ingresso.

Net: thread attivo non-serale dentro la finestra → `shouldStart:false` → nessuna
card → review irraggiungibile. È un buco di design (la priorità serale esiste in
`priority.ts` ma è gated a `!thread`), non un refuso.

### Fix (decisione: banner in chat)
**Edit A — server (`src/app/api/chat/active-thread/route.ts`, blocco response ~365-374).**
Calcolare `computeEveningReview()` anche quando il thread riattivato è non-serale,
invece dell'hardcoded `false`. `computeEveningReview` è read-only e ritorna
`shouldStart:false` se esiste già una Review-oggi o un thread `evening_review`
attivo/in-pausa — quindi è sicuro chiamarla sempre nel ramo `thread!==null`
(durante una review in corso non mostra il banner).

```ts
const eveningReview = await computeEveningReview(userId, validatedNowHHMM, clientDate);
const body: ActiveThreadResponse = {
  activeThread: { threadId: thread.id, mode: thread.mode, messages, hasMore },
  eveningReview,
};
return NextResponse.json(body);
```

**Edit B — client (`src/features/chat/ChatView.tsx`).**
Nuovo componente `EveningReviewBanner` (riga sticky sopra l'input) mostrato quando
`eveningReviewShouldStart && messages.length > 0 && mode !== 'evening_review'`.
Riusa `handleStartEveningReview` (già esistente: `threadId=null`,
`mode='evening_review'`). Aggiungere `setMessages([])` in `handleStartEveningReview`
così l'avvio parte da schermo pulito sia dal banner sia dalla card.

### Fate del thread in corso (decisione: resta, lo riprendi dopo)
Il vecchio thread general resta `active`. Finita la review (`close-review`
archivia l'evening thread), al mount successivo `active-thread` riapre il general
(unico active rimasto) e `computeEveningReview` ritorna `false` (Review-oggi
esiste) → niente banner. I due thread active possono coesistere brevemente:
l'ordinamento `orderBy lastTurnAt desc` fa vincere l'evening durante la review e
il general dopo. Nessun guard nuovo richiesto.

---

## Bug 2 — Il popup "come ti senti?" va in loop

### Sintomo
Dopo aver completato dei task, il popup `success_milestone` chiede "come ti senti".
Qualsiasi risposta (opzione o testo libero) lo ri-mostra all'istante, all'infinito.

### Causa (confermata)
- `detectProactiveTriggers` emette `success_milestone` con ≥3 `task_completed`
  recenti (`ai-assistant-engine.ts:396-404`). Nessun cooldown/dedup.
- Rispondere chiama `recordSignal('micro_feedback', …)` →
  `store.setAdaptiveProfile(data.profile)` (`tasks/page.tsx:242`; learning-signal
  ritorna sempre un profilo, `learning-signal/route.ts:114-130`).
- `store.adaptiveProfile` è dipendenza dell'effetto `checkTriggers`
  (`tasks/page.tsx:435`) → l'effetto rigira subito → rifà `GET /api/ai-assistant`
  → i ≥3 `task_completed` sono ancora lì → `success_milestone` ricompare
  (`tasks/page.tsx:414-417` sovrascrive il `setShowProactiveChatbot(false)` del
  handler). Loop immediato.
- La finestra "ultimi 20 signal" (`route.ts:233`) è fragile sotto completamenti
  rapidi.

### Fix (decisione: cooldown ~30 min, lato server, niente migration)
Convenzione: signal di ack con `signalType = 'proactive_ack:<triggerType>'`.

**Edit A — client (`src/app/tasks/page.tsx`).** Registrare l'ack su **tutte** le
chiusure del popup: `handleOptionClick` (1341), `handleFreeTextSubmit` (1373) e
`handleDismiss`/X (1391). Registrare l'ack **prima** del `micro_feedback`
(awaited), così è persistito prima di ogni re-run dell'effetto. Serve sapere il
tipo di trigger mostrato → nuovo campo store `proactiveChatbotTriggerType`,
settato in `checkTriggers` quando si mostra il popup.

**Edit B — server (`src/app/api/ai-assistant/route.ts`).** In GET (431) e in
`detect_triggers` POST (254), dopo `detectProactiveTriggers`, filtrare i trigger
i cui tipi risultano "acked" entro 30 min. Query dedicata (robusta, indipendente
dalla finestra dei 20):

```ts
const COOLDOWN_MS = 30 * 60 * 1000;
const acks = await db.learningSignal.findMany({
  where: { userId, signalType: { startsWith: 'proactive_ack:' },
           createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } },
  select: { signalType: true },
});
const ackedTypes = new Set(acks.map(s => s.signalType.slice('proactive_ack:'.length)));
const filtered = triggers.filter(t => !ackedTypes.has(t.type));
```

Helper condiviso `getAckedTriggerTypes(userId)` per non duplicare. Cooldown
**per-tipo**: un ack di `success_milestone` non zittisce `avoidance_pattern`.
Scaduti i 30 min, se la condizione è ancora vera, il popup può ricomparire
(comportamento celebrativo voluto). `ai-assistant-engine.ts` **non** viene
toccato (regola 2: la logica trigger è corretta, si filtra a valle).

**Edit C — client guard (`tasks/page.tsx`, `checkTriggers`).** Early-return se
un popup è già aperto (`if (store.showProactiveChatbot) return;`) per evitare
flicker/refetch ridondanti. Cheap, nessun cambio schema.

---

## Self-verification
- `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi prima di ogni commit.
- Unit: `active-thread` ritorna `shouldStart:true` con thread attivo non-serale
  dentro finestra + niente Review-oggi; `false` se Review-oggi esiste.
- Unit: `ai-assistant` GET sopprime `success_milestone` con ack <30 min;
  lo riemette con ack >30 min; non sopprime altri tipi.
- Component (ChatView): banner reso con `{messages:[…], eveningReview:{shouldStart:true}}`;
  click → `handleStartEveningReview` (`threadId=null`, `mode='evening_review'`).
- Manuale (preview, mint-cookie e2e; disinstallare SW+cache prima — gotcha noto):
  orologio 20:28, 2-3 messaggi → banner → "Inizia" → review su thread nuovo;
  completa 3 task → popup → rispondi → resta chiuso; reload entro cooldown →
  resta chiuso; dopo cooldown + nuovo completamento → ricompare.

## Fuori scope (segnalato, NON in questo task)
- `set_user_energy` risulta esposto in `evening_review` pur essendo documentato
  "solo morning checkin" (`tools.ts:117` vs ~347) — possibile inquinamento del
  mood intake serale. Task separato.

## File toccati
- `src/app/api/chat/active-thread/route.ts` (Edit A — Bug 1)
- `src/features/chat/ChatView.tsx` (Edit B — Bug 1) + nuovo `EveningReviewBanner`
- `src/app/tasks/page.tsx` (Edit A + C — Bug 2)
- `src/app/api/ai-assistant/route.ts` (Edit B — Bug 2)
- `src/store/shadow-store.ts` (campo `proactiveChatbotTriggerType`)
