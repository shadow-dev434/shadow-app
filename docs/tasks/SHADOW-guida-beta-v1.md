# Shadow — Guida operativa verso la Beta v1

> Scope deciso: **B (beta robusta, 20-100 tester)**.
> Documento complementare a `shadow-app-stato-completo.md` (lo snapshot resta la
> fotografia dello stato; questa guida è la sequenza di lavoro e i criteri).
> Convenzione: ✅ chiuso · ⚠️ parziale/con riserva · ⏳ non iniziato · 🔁 ricorrente.
> Snapshot di partenza: 2026-06-01.

---

## 0. Decisioni fissate (da non riaprire senza motivo)

- **Scope = B.** Beta robusta per 20-100 tester. Questo rende bloccanti: 8b
  completa, hardening Task 4, GDPR completo, decisione PWA, ricalibrazione Bolletta.
- **8b (spirale negativa, override etico `gentle`) è dentro la beta.** Non
  opzionale. Tocca utenti vulnerabili → revisione pre-implementazione obbligatoria
  (vedi §2, Fase 3).
- **Ordine vincolato Bolletta → caching.** Mai caching prima della ricalibrazione
  del caso `previousEntryOpen`: il caching su prompt che cambierà invalida la cache
  al primo deploy del fix.
- **Orizzonte realistico Scenario B: ~8-12 settimane**, varianza concentrata su
  8a/8b (lavoro su utenti vulnerabili) e stabilizzazione Bolletta. Se devo
  scommettere, più vicino a 12 che a 8.

---

## 1. La prossima mossa singola: chiudere Slice 6c

È il blocco che tiene tutto il resto su fondamenta che non compilano. **Niente
8a/8b, niente hardening, finché 6c non è chiusa e committata pulita.**

Ordine preciso:

1. **Riconciliare lo stato di HEAD.** Oggi HEAD è TS-rotto: pezzi della phase
   machine 6c sono committati senza i file compagni (`buffer.ts`, `trimming.ts`,
   handler `confirm-plan-preview-*`); Vercel passa solo per `ignoreBuildErrors: true`.
   Verificare con `git status` + `bunx tsc --noEmit` *prima* di toccare altro.
   Obiettivo: portare il WIP locale a uno stato dove `tsc --noEmit` è pulito sul
   perimetro 6c, così il commit di chiusura non lascia HEAD inconsistente.
2. **Preparare l'account virgin.** Il DB oggi non ha utenti che soddisfano i
   requisiti (`check-virgin-test-6c-account.ts` lo conferma). Setup richiesto:
   - `AdaptiveProfile`: `optimalSessionLength=25`, `shameFrustrationSensitivity=4`,
     `preferredPromptStyle='direct'`, `bestTimeWindows=["morning"]`
   - `Settings`: `wakeTime='07:00'`, `sleepTime='23:00'`
   - 8 task inbox: 3 con deadline ≤48h, 5 senza deadline, size 1-5 distribuite
   - 0 thread `evening_review` active/paused
   - Rilanciare `check-virgin-test-6c-account.ts` → "VIRGIN OK".
   - **Nota di processo:** questo è il primo candidato per uno *seeder idempotente*
     (vedi §3) — trasformare il setup-a-mano in `bun run seed:virgin-6c`.
3. **Eseguire il retest** con la rubrica pre-registrata (33 criteri, soglia 31/33).
   Sessione fresca, dentro finestra serale (es. 21:00 Roma). ~$0.70-1.00 il retest
   principale + $0.30-0.50 la regressione 6a/6b.
4. **Gestire il fail bloccante.** Rubrica 1.2 (`pinned_exceeds_ceiling` con pattern
   6.2) è fail bloccante a prescindere dal totale. Se fallisce → 1-2 iterazioni di
   fix prima di poter chiudere.
5. **Commit di chiusura** (no push automatico), poi marcare 6c ✅ in `05-slices.md`.

**Disciplina:** nessuna ricalibrazione della rubrica mentre si vedono i risultati.
I criteri sono congelati. Eventuali pattern non previsti si annotano *post*-retest.

---

## 2. Sequenza verso la beta (con dipendenze)

Cinque track. Track 1 è sequenziale (ogni fase dipende dalla precedente). Track
2-5 sono in larga parte parallelizzabili e possono girare nei tempi morti delle
sessioni E2E del Track 1.

### Track 1 — Cuore conversazionale (sequenziale, critico)

| Fase | Cosa | Stato | Gate |
|---|---|---|---|
| 1.1 | Chiudere Slice 6c | ⚠️ WIP | vedi §1 |
| 1.2 | Bug #3 (Gmail today-aware) | ⏳ | label data relativo **server-side** (non prompt-only); `clientDate` non è renderizzato nel prompt |
| 1.3 | Slice 8a — burnout ("non ce la faccio stasera") | ⏳ | dopo 6c stabile |
| 1.4 | Slice 8b — spirale negativa + override `gentle` | ⏳ | **revisione pre-implementazione** (vedi sotto) |
| 1.5 | Ricalibrazione Bolletta (`previousEntryOpen` anti-kept-passivo) | ⏳ | sblocca caching |
| 1.6 | Prompt caching | ⏳ | **solo dopo** 1.5 |

**Disciplina 8a/8b:** non è "Claude Code propone, tu approvi". È "Claude Code
propone, tu chiedi conferma all'autore prima di procedere". Per 8b in particolare:
riconoscimento semantico della spirale negativa, falsi positivi/negativi, override
di registro — tutto revisionato a freddo prima di scrivere codice. Mossa B + ascolto
breve, no terapia improvvisata, no domande aperte.

**1.6 caching non è beta-blocking di per sé** (è ottimizzazione costo/latenza), ma
è vincolato dietro 1.5. Se i tempi stringono, si può spedire la beta senza caching
e aggiungerlo dopo — purché Bolletta sia chiusa.

### Track 2 — Hardening pre-beta (Task 4)

Ingegneria deterministica, basso rischio comportamentale. **La spec non esiste
ancora — primo passo: crearla** (`docs/tasks/04-pre-beta-hardening.md`).

- Rate limiting registrazione (max 3/IP/giorno)
- Rate limiting chiamate AI (max N/utente/giorno — dimensionare su costo Sonnet)
- Sentry free tier (error tracking)
- UptimeRobot (uptime monitoring)
- Documento di test manuale formale per l'isolamento end-to-end

### Track 3 — Privacy / GDPR (bloccante per utenti EU reali)

- Privacy policy + consent flow
- Cancellazione account (cascade già nello schema)
- Data retention policy
- Export dati (route `export` già esistente — verificare completezza)
- **Dipendenza esterna:** consulenza legale/privacy. È la cosa con lead time più
  lungo non sotto il tuo controllo → avviarla **presto**, in parallelo al Track 1.

### Track 4 — Igiene infrastrutturale

- Consolidare i 4 progetti Vercel in 1 (Task 3.6); fissare URL canonico
- Migration baseline: `migrate resolve --applied 0_init` + `migrate deploy` al
  primo deploy beta (mai `migrate dev` su prod)
- Backup Neon (piano Pro) **prima** di avere dati di utenti reali
- Decisione + implementazione PWA/SW (Task 3.7): adottare libreria manutenuta
  (`next-pwa`/`@serwist/next`) o rimuovere `sw.js`. Per scope B con ambizione
  mobile, probabilmente adottare.

### Track 5 — Kickoff automatico review

- Oggi la review serale in finestra richiede click sul button + primo messaggio.
- Implementare l'avvio automatico all'ingresso in finestra ("apri l'app la sera e
  Shadow ti aspetta col piano"). È prodotto, non solo infra: cambia l'esperienza
  percepita. Lavoro contenuto.

---

## 3. Automazione test E2E — priorità #1 di workflow

Il collo di bottiglia non è scrivere codice: è **stabilizzare comportamento LLM
non-deterministico**. Ogni bug comportamentale = una sessione manuale (soldi,
contesto fresco, setup account in Studio, lettura visiva dello stderr). L'infra è
già mezza costruita: `verify-6c-retest-state.ts`, gli script di seed, i prefissi di
telemetria, le rubriche pre-registrate. Manca il collante.

**Obiettivo:** trasformare una sessione manuale di ~90 minuti in `bun run e2e:6c`.

### Principio guida

`payloadJson` da DB è ground truth, mai la trascrizione HTTP/UI. Il non-determinismo
non è un ostacolo all'automazione: è esattamente ciò che già fai a mano contando i
pass su N run. L'harness gira N volte e **riporta una distribuzione** (pass rate per
criterio), con soglia pre-registrata.

### Architettura, costruibile in 4 fasi incrementali

**Fase 0 — Turn driver** (`scripts/e2e/driver.ts`)
Una funzione che:
1. Autentica una volta (mint del cookie `next-auth.session-token` per lo userId di
   test — riusare il pattern di auth degli script esistenti; se non c'è, helper
   dedicato che genera il JWT NextAuth con `NEXTAUTH_SECRET`).
2. Invia una **sequenza fissa** di messaggi utente a `POST /api/chat/turn`
   (un turno alla volta, passando `clientDate`/`clientTime` semantici).
3. Dopo *ogni* turno, legge da DB `ChatThread.contextJson` (phase, previewState,
   triageState) + l'ultimo `ChatMessage.payloadJson` — riusando la logica di
   `verify-6c-retest-state.ts` (estrarla in un modulo importabile invece di uno
   script standalone).
4. Ritorna un array di "turn record": `{ userMsg, assistantText, phase,
   previewState, payloadJson, toolsExecuted }`.

**Fase 1 — Layer di assertion** (`scripts/e2e/rubrics/6c.ts`)
Codificare i 33 criteri come **predicati puri** su `(turnRecords, telemetry)`. Es.:
```ts
// Rubrica 1.3: distingue "ok spostala" (update) da "ok blocca" (confirm)
const r1_3 = (turns) => {
  const t = turns.find(x => /spostala|sposta/i.test(x.userMsg));
  return t?.toolsExecuted.some(e => e.name === 'update_plan_preview');
};
// Rubrica 5.1: phase transita per_entry → plan_preview → closing ai turni 10 e 15
const r5_1 = (turns) =>
  turns[9]?.phase === 'plan_preview' && turns[14]?.phase === 'closing';
// Rubrica 2.1: NON inventa numeri nel preview (proxy: nessuna cifra oraria/% nel content)
const r2_1 = (turns) => !turns.some(t =>
  t.phase === 'plan_preview' && /\b\d{1,2}:\d{2}\b|\b\d{1,3}%/.test(t.assistantText));
```
Ogni predicato ritorna pass/fail + (opzionale) verbatim per i criteri "documentare,
non blocker" (es. Rubrica 4.4).

**Fase 2 — Cattura telemetria** (per Rubrica 4.3)
Avviare il dev server con redirect UTF-8 (`cmd /c "bun run dev > dev-e2e.log 2>&1"`
— mai `*>` PowerShell, produce UTF-16 illeggibile a grep). L'harness fa il tail del
file e filtra i prefissi `[V1.3.2 set]`/`[V1.3.2 clear]`/`[V1.3 forced tool_choice]`/
`[V1.2 replica detection]`. Mappa ogni riga al turno corrispondente via timestamp.

**Fase 3 — Loop N-run + report**
```ts
const N = 6;                      // dimensionare su budget: ~$1/run sul 6c
const results = [];
for (let i = 0; i < N; i++) {
  await seedVirgin6c();           // seeder idempotente, vedi sotto
  const turns = await runScenario(SCENARIO_6C_H);
  const telemetry = await readTelemetry('dev-e2e.log');
  results.push(scoreRubric(turns, telemetry));   // {passed: 31, total: 33, fails: [...]}
}
report(results);  // pass rate per criterio + verdetto soglia 31/33 + fail bloccante 1.2
```

### Prerequisiti che pagano da soli

- **Seeder idempotenti** (`scripts/seed/virgin-6c.ts`, ecc.): "Antonio prepara a
  mano in Studio" → `bun run seed:virgin-6c`. Già hai `check-virgin-test-6c-account.ts`
  come oracolo di verifica; affiancagli un seeder deterministico che lo soddisfa.
- **Estrarre la logica di lettura DB** da `verify-6c-retest-state.ts` in un modulo
  riusabile (oggi è uno script CLI; serve come funzione).
- **Wake preflight Neon**: un `SELECT 1` con un retry a ~5s a inizio harness, per
  assorbire il cold-start `P2028`/connection-error del branch autosospeso.

### Cosa NON aspettarsi dall'automazione

- Non elimina il giudizio a freddo: la rubrica resta pre-registrata a mano.
- Non rende deterministico il modello: riporti una distribuzione, non un pass secco.
- Il primo investimento (~1-2 sessioni per costruire driver + rubrica 6c) si ripaga
  dalla **seconda** volta che riusi l'harness — e 8a/8b/Bolletta sono tutte sessioni
  E2E che ne beneficeranno.

### Suggerimento di sequenza

Costruisci l'harness **subito dopo** la chiusura manuale di 6c (§1), riusando la
rubrica 6c come primo banco di prova. Così il retest manuale che farai comunque ti
serve anche come oracolo per validare che l'harness automatico dia lo stesso verdetto.

---

## 4. Altri miglioramenti di workflow

1. **Gate `tsc --noEmit` pre-commit (o pre-push).** È la guardia che avrebbe
   impedito HEAD-rotto-senza-WIP. `typecheck-on-ts-edit.js` è non-bloccante; aggiungi
   un gate bloccante sul commit (lefthook/husky o raw `.git/hooks/pre-commit` con tsc
   incrementale). È anche il prerequisito per togliere `ignoreBuildErrors: true`.
2. **Build cross-platform.** Sostituire `cp -R`/`cp -r` con `fs.cpSync` in uno
   script TS (o `shx`/`cpy`). Toglie un papercut ricorrente su Windows.
3. **Flag env nei script npm.** Aggiungere `prisma:studio` con `dotenv -e .env.local`
   già dentro, ed estendere il pattern a tutti gli script Prisma → la disciplina è
   imposta dal comando, non dalla memoria.
4. **`STATE.md` vivo.** Istituzionalizzare lo snapshot come una pagina aggiornata in
   coda a ogni sessione (slice corrente, prossima azione, blocker, stato repo). Riduce
   il cold-start delle sessioni a contesto fresco. Le deploy-notes (1288 righe) restano
   l'archivio forense, non il documento da rileggere a inizio sessione.

---

## 5. Miglioramenti dell'app (prioritizzati per la beta)

Ordine di leva-su-sforzo. I primi tre attaccano la radice di bug che ti sono già
costati settimane.

1. **History management / pruning.** La "history dominance" non è solo costo: è la
   causa radice del pattern di replica (Slice 5 V1.x, Bug #1 forced-path). Un
   management principiato (riassumi-e-tronca i turni vecchi, o limita l'esposizione
   few-shot) riduce **insieme** costo e superficie di bug comportamentali. Unico
   intervento che paga su due fronti.
2. **Kickoff automatico review** (= Track 5). Promessa centrale del prodotto, lavoro
   contenuto.
3. **Principio: tool-gating > istruzione-nel-prompt.** Il fix B1 di Bug #1 (togli il
   tool dal toolset quando non deve essere chiamato) è il pattern giusto, da
   generalizzare ovunque il flow abbia un'aspettativa "il modello non deve fare X
   adesso". Affidarsi al prompt per un *non*-comportamento è fragile.
4. **Unificazione timezone.** `Settings.timezone` + triage TZ-aware lato server. Core
   per un prodotto "la cosa giusta al momento giusto"; bloccante prima di utenti
   non-Roma e dell'espansione EN. Oggi `shouldTriggerMorningCheckin` resta UTC-affetto.
5. **Togliere `ignoreBuildErrors` in modo mirato.** Sistemare *solo* gli errori TS del
   monolite `tasks/page.tsx` che tengono in vita il flag — non il refactor completo
   (Task 9). È ciò che ha permesso a HEAD di rompersi e a TS rotto di raggiungere prod.
6. **`userId` da NextAuth, non da Zustand** in `page.tsx`. Elimina il bug "UI mostra
   chat con sessione scaduta finché non pulisci lo store". Basso sforzo, smell di
   correttezza/sicurezza.

---

## 6. Fuori scope beta (consapevolmente rimandati)

- Split completo del monolite `tasks/page.tsx` (Task 9) — solo gli errori TS, non il
  refactor.
- `persist` di Zustand — la rehydration via `active-thread` copre già il caso
  importante.
- Consolidamento provider Claude/GLM — la review è tutta su Claude; debito da gestire
  consapevolmente ma non urgente.
- Task 11 (body doubling voice-first), Task 6 (ingest Gmail completo oltre Bug #3),
  Task 7 (calendar bidirezionale), Slice 8c (rientro ≥14gg), Slice 9 (calibrazione
  fill ratio — può girare *durante* la beta).

---

## 7. Decisioni ancora aperte

- **8b in beta: pavimento etico minimo o versione completa?** Con scope B la spec
  dice non-opzionale. Decidere il livello di profondità del riconoscimento spirale
  negativa (R6).
- **PWA: libreria manutenuta o rimozione SW?** Per scope B con ambizione mobile,
  probabilmente adottare `next-pwa`/`@serwist`. Decisione + implementazione end-to-end.
- **Dimensionamento rate limit AI** (max N chiamate/utente/giorno): dipende dal budget
  Sonnet che vuoi tollerare per tester.
- **N del loop E2E** (§3): trade-off costo vs confidenza statistica sul
  non-determinismo. Default proposto 6.

---

## 8. Checkpoint (come sapere se sei in linea)

- **Checkpoint 1 — fondamenta sane:** 6c ✅ committata, HEAD compila pulito, Track 3
  (legale) avviato. → fine settimana ~1-2.
- **Checkpoint 2 — harness + cuore:** `bun run e2e:6c` funzionante, Bug #3 chiuso,
  8a ✅. → fine settimana ~4-5.
- **Checkpoint 3 — etica + stabilità:** 8b ✅ (revisionato), Bolletta ricalibrata. →
  fine settimana ~7-9.
- **Checkpoint 4 — beta-ready:** Track 2 (hardening) + Track 3 (GDPR) + Track 4
  (infra) + Track 5 (kickoff) chiusi, migrate baseline + backup Neon fatti. →
  fine settimana ~10-12 → invito ai primi tester.

---

*Documento di pianificazione. Aggiornare quando una fase si chiude o quando una
decisione di §7 viene sciolta. Coerente con la metodologia slice e con le regole
non negoziabili di `CLAUDE.md` (piano prima del codice, no push automatico,
commit atomici, revisione pre-implementazione per gli edge case ADHD).*
