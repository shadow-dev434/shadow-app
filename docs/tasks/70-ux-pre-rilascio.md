# Task 70 — UX pre-rilascio

> Spec preparata il 2026-07-04 a valle del Task 69, dal batch §9 del report
> del collaudo 68 (`docs/tasks/68-report-collaudo.md`) + quick-win §8 + Top-10
> UX §5. **Base di partenza: `feature/69-pre-rilascio-s1-s2`** (contiene i fix
> S1/S2 e l'harness task69) — creare `feature/70-ux-pre-rilascio` da lì.
> Push/merge di tutta la catena: decisione Antonio a fine lavori.

---

## 1. Contesto

Il collaudo 68 ha dato NO-GO condizionato: il Task 69 ha chiuso il pacchetto
bloccante (S1+S2+legale). Questo task chiude il **secondo batch**: i finding
UX ad alta frequenza che pesano su retention/soddisfazione (L7 fiducia e L8
carico conversazionale sono PEGGIORATI tra collaudo 62 e 68 — è qui che il
prodotto rischia di più con utenti veri).

## 2. Perimetro (dal report 68, §9 batch "Task 70" + §8 quick-win)

Ordinati per leva (impatto × frequenza / effort, §5 del report):

| # | ID | Cosa | Effort | File noti (dal collaudo) |
|---|----|------|--------|--------------------------|
| A | **N32** | La review NON ri-chiede mood/energia da capo: default dal mattino ("stamattina eri a 4, confermi?"). Il dato vive in `DailyPlan(oggi).energyLevel` via `upsertTodayContext` (set_user_mood/energy in chat) — scoperta 69: la riga esiste già | M | `prompts.ts` (intake, PROTETTO), orchestrator modeContext (PROTETTO), `evening-review/*` |
| B | **N28b** | Nav chat↔tasks senza full reload (~3-5s a giro su WebView): via `window.location.href`, dentro `router.push` client | M | `ChatView.tsx`, `tasks/page.tsx` (bottoni nav), rendering già co-locato |
| C | **M-1** | Ponte Cielo: il completamento di un ricorrente porta AL Cielo (oggi solo toast passivo) | S | `tasks/page.tsx` (toast D48 del 64 → cliccabile/navigante) |
| D | **D15 + run69-3** | Mappa mood robusta: "benissimo"/"malissimo"/"3 o 4" + **"4 e 4" in un messaggio unico** (scoperto nella verifica 69: manda l'intake in loop e leaka "il sistema mi blocca") | S | `mood-energy-parse.ts:28-39` |
| E | **N36 + N29** | Empty-state Today GENERA il piano invece di chiedere; install banner PWA anche sulla chat (oggi solo /tasks) | S | `tasks/page.tsx` |
| F | **N26** | Toast celebrativo + micro-feedback al completamento passano ENTRAMBI dal coordinatore 66B (oggi 2 popup simultanei, unico punto che viola "una alla volta") | S | `tasks/page.tsx` (coordinatore) |
| G | **D9/D24** | Uscita friction strict: il task resta `planned` (mai `in_progress` in DB) e nessun segnale positivo → `strictModeEffectiveness` può solo peggiorare | M | strict-mode route + client |
| H | **N9** | `get_today_tasks` ritorna `total`/`hasMore` (il modello dichiara "Hai 15 cose" con 55 in DB) | S | `tools.ts` (non protetto) + eventuale riga in `prompts.ts` |
| I | **N38/N37/N46** | Lingua: enum EN raw nel parlato ("worker","personal"), QR "Attiva strict" con copy italiano, errori grezzi ("HTTP 500", `e'`/`finche'`) | S | `tasks/page.tsx`, `ChatView.tsx`, copy vari |
| J | **N49** | Card Ricorrenti (Settings) → deep-link `/?draft=` come già fa il Cielo | S | `tasks/page.tsx` |
| K | **D-auth** | `localStorage['shadow-user']` pulito al signout (Settings può mostrare un'identità diversa da quella loggata) | S (quick win) | client signout |
| L | **N53** | Rimozione costante morta `CACHE_NAME='shadow-v2'` nel SW | S (quick win) | `public/sw.js` |

**Fuori perimetro** (annotati per il Task 71): S2-I/N19 (dedup notifiche cron),
S2-J/N50b (500 su `?limit=abc`), S2-L/D47 (unpin — non in nessun batch:
decidere se 71 o v1.1), N24/N25, N13 timezone, N33, N61, rimozioni §6.

## 3. Prompt di avvio (per la nuova sessione)

```
Vai con il Task 70 (UX pre-rilascio). La spec è in
docs/tasks/70-ux-pre-rilascio.md — perimetro §2, decisioni da pormi §4.
Parti da feature/69-pre-rilascio-s1-s2 (NON da main: il 69 non è ancora
mergiato), crea feature/70-ux-pre-rilascio. Workflow v2: esplora, fammi le
domande di prodotto in un colpo solo, poi piano in plan mode e implementa
end-to-end con commit checkpoint. Riusa l'harness scripts/e2e/task69/ e
scripts/e2e/collaudo-68/ per le verifiche (gotcha: api() vuole
{cookie, body} come terzo argomento). Push e merge NON si fanno: li decido
io alla fine della catena.
```

## 4. Decisioni di prodotto da porre a inizio sessione (AskUserQuestion)

1. **A/N32** — Riuso mood serale: (a) default confermabile ("stamattina eri a
   4 — confermi o è cambiato?", 1 tap, raccomandata) vs (b) skip totale della
   domanda se il dato del mattino ha meno di N ore vs (c) lasciare doppio rito.
2. **C/M-1** — Ponte Cielo: (a) toast cliccabile che naviga a ?view=sky
   (raccomandata, zero interruzioni in più) vs (b) navigazione automatica al
   Cielo dopo il completamento di un ricorrente (più celebrativo, più invasivo).
3. **G/D9-D24** — Segnale strict: (a) uscita pulita da friction = segnale
   neutro/positivo + task a `in_progress` allo start reale (raccomandata) vs
   (b) solo fix dello status senza toccare effectiveness.
4. **E/N36** — Empty-state Today: (a) genera il piano in automatico al mount
   (raccomandata se c'è un DailyPlan committabile) vs (b) bottone unico
   "Genera adesso" senza domande.

## 5. Vincoli e note operative

- **File protetti attesi**: `prompts.ts` (item A intake + eventuale H),
  orchestrator SOLO se serve il modeContext del mattino per A — dichiararli
  nel piano. `update-plan-preview-handler.ts` non dovrebbe servire.
- Zero migration previste. Zero dipendenze nuove.
- Regola 7 (i18n): siamo pre-W4 — testi in italiano, niente chiavi next-intl
  nelle viste non estratte.
- Verifica: build+tsc+test (baseline 1016), probe e2e mirati (riuso lib),
  1 run LLM reale per l'item A (intake review con default dal mattino) +
  verifica browser per B/C/E/F/J (nav senza reload misurabile via
  performance.navigation / assenza di full document load).
- La coorte `collaudo68-*` resta viva e NON va toccata; utenti effimeri
  `collaudo68-t70-*` via `createEphemeralUser` (lib 68).

## 6. Esito atteso

Batch UX completo su `feature/70-ux-pre-rilascio`, commit atomici, report
finale con: file toccati, esiti probe/LLM/browser, tabella item→stato,
istruzioni di test manuale, aggiornamento ROADMAP, spec Task 71 pronta
(pulizia/robustezza post-rilascio, ultimo della catena).
