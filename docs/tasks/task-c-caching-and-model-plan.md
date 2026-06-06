# Task C — Cost engineering: caching, costUsd, scelta modello

> Stato e piano consolidato dalla sessione del 2026-06-05. Complementa
> `docs/tasks/05-task-c-cost-engineering.md` (piano a 5 fasi). Questo doc registra
> l'**esecuzione** della parte caching + la decisione sul modello, perche' la
> ricostruiamo da qui senza ripartire da capo.

---

## 0. Perche' esiste questo doc

Il costo per sessione di review e' la variabile pesante tra "l'app si usa" e "l'app
e' troppo cara". Pre-caching ~EUR 2,50/sessione (stima di progetto). Saldo API molto
basso al momento della sessione. Serve abbattere il costo PRIMA della campagna di
validazione V1.2.4 (N run) e in vista della beta. Questo doc fissa cosa facciamo,
in che ordine, e cosa NON facciamo (e perche').

**Insight centrale, da non dimenticare:** il costo di un walk e' dominato dal
**system prompt da ~16k re-inviato a ogni turno**, NON dal rate del modello. Le leve
grosse sono caching + trim del prompt (model-agnostic). Il rate del modello e' un
moltiplicatore secondario su un residuo piccolo *dopo* il caching. Conseguenza
pratica: si abbatte il prefisso prima, si misura, e solo dopo si decide se il modello
e' ancora il vincolo.

---

## 1. Pricing corrente (verificato 2026-06-05, fonti anthropic.com + comparatori)

| Modello | Input $/M | Output $/M | Note |
|---|---|---|---|
| Claude Sonnet 4.6 | 3.00 | 15.00 | modello `smart` attuale dopo migrazione Fase 1 |
| Claude Haiku 4.5 | 1.00 | 5.00 | modello `fast` (chat generale); ~3x meno di Sonnet |
| Gemini 2.5 Flash | ~0.30 | ~2.50 | ~3.3x meno di Haiku in input |
| Gemini 3.1 Flash-Lite | ~0.25 | ~1.50 | 1M contesto; supera Haiku su benchmark conoscenza/ragionamento |
| Gemini 3.5 Flash | 1.50 | 9.00 | reasoning; aggregato avanti, ma Haiku meglio su coding/tool-use |
| DeepSeek V3.2/V4 | ~0.14 | ~0.28 | il piu' economico "GPT-4-class"; OpenAI-compatibile |

- **Prompt caching Anthropic:** cache-hit input = **10% del prezzo standard** (90% off).
  Cache **write** = 1.25x (TTL 5m) o 2x (TTL 1h). Cache-hit Haiku $0.10/M, Gemini Flash $0.15/M.
- **Soglia minima prefisso cachiabile:** ~1024 token (Sonnet), ~2048 (Haiku). Sotto
  soglia il `cache_control` e' **ignorato silenziosamente** (nessun errore, nessun caching).

---

## 2. Task C — fasi

### Fase 1 — Migrazione modello: FATTA (applicata, NON committata)

`claude-sonnet-4-5` (legacy) -> `claude-sonnet-4-6` (corrente, stesso prezzo $3/$15).
- File: `src/lib/llm/client.ts`, 3 righe: union `ModelName` (:27), `MODELS.smart` (:31),
  chiave `PRICING` (:37). Blast radius verificato: stringa centralizzata in 1 file,
  nessun literal sparso, `fast`/Haiku intoccato.
- `schema.prisma:579` (commento, file protetto) NON toccato -> da bundlare col cleanup
  dell'altro commento stale `schema.prisma:573` (`{toolName,toolInput}`), post-merge.
- Typecheck verde (unico errore = preesistente noto su `scripts/replay-close-review.ts`,
  gitignored, estraneo).
- **Perche' prima della campagna:** la campagna deve validare il modello che la
  produzione usera' davvero. Il `kept` ottenuto a mano su 4-5 e' incoraggiante ma e'
  un altro modello -> all'atto della validazione harness si ri-baselina l'oracolo su 4-6.

### Fase 2b — Caching split del system prompt: RATIFICATA (diff pronto, NON applicato)

**Design.** Il system prompt si spezza in due text-block:
```
STATIC  = CORE_IDENTITY + voice + userContext + modePrompt   <- cache_control: ephemeral
DYNAMIC = modeContext (la "\n\n" di giunzione sta nel dynamic) <- NESSUN cache_control
```
`STATIC + DYNAMIC` e' **BYTE-IDENTICO** all'output attuale di `buildSystemPrompt`
(il caching cambia la fatturazione, NON il prompt che il modello vede).

**Diff su 3 file friction-strict (un file alla volta, ratifica per ciascuno):**
- `src/lib/chat/prompts.ts`: nuova `buildSystemPromptParts(): { staticPrefix, dynamicSuffix }`;
  `buildSystemPrompt` resta esportata come wrapper byte-identico (difensivo).
- `src/lib/llm/client.ts`: `LLMCallParams.systemPrompt: string | { static; dynamic? }`.
  Ramo `string` = piano senza cache (retro-compat completeText/engine one-shot). Ramo
  oggetto = array a 2 text-block, `cache_control` SOLO sullo static, dynamic omesso se
  vuoto (l'API rifiuta text-block vuoti). Import `TextBlockParam` aggiunto. SDK `^0.90.0`,
  tipi confermati.
- `src/lib/chat/orchestrator.ts`: `staticPrefix` const + `dynamicSuffix` let; i 2 callLLM
  passano `{ static, dynamic }`; il rebuild mid-loop aggiorna SOLO `dynamicSuffix`
  (lo static e' invariante mid-walk); `PHASE_MARKER` va nel DYNAMIC (cambia su transizione fase).

**Blast radius verificato:** `buildSystemPrompt` ha esattamente 2 caller (orchestrator);
le occorrenze funzionali di `systemPrompt` nell'orchestrator sono 5 (def + 2 callLLM +
rebuild + append), tutte coperte. Il primo callLLM ora ha SIA `toolChoice: effectiveToolChoice`
(blocco harness di stanotte) SIA `systemPrompt: {static,dynamic}`: campi distinti, coesistono;
l'apply non deve inghiottire la riga toolChoice.

**FINDING di volatilita' (Code) — cosa il caching ottiene davvero:**
La struttura reale e' `[CORE_IDENTITY][voice][userContext][modePrompt ~16k][modeContext]`,
dove `voice` e `userContext` sono **profile-derived e volatili cross-run** (EMA
completionRate/avoidanceRate/activation che driftano + top-8 memorie + motivation profile),
e sono **incastrati in mezzo**, prima del `modePrompt` da ~16k.
- **within-walk: pieno e incondizionato.** voice/userContext sono fetchati UNA volta a
  inizio walk e costanti per tutti i turni -> lo static ~16k si cachea sui ~9 call del
  walk (turno 1 scrive 1.25x, turni 2-9 leggono 0.1x -> ~75% off sul prefisso). E' la
  vincita dominante per un walk multi-turno.
- **cross-run: condizionato.** Lo static si cachea tra run solo se voice/userContext sono
  byte-identici tra run entro il TTL. **Nella campagna funziona** perche' il reset tra run
  ripristina un profilo fisso -> prefisso identico. In **produzione** degrada a
  within-walk-only man mano che il profilo reale drifta.
- Soglia: evening_review static ~16k >> 1024 (Sonnet) -> cachiato. general (fast/Haiku,
  static ~900 tok) < 2048 -> ignorato silenziosamente (nessun danno). morning_checkin ~2.2k -> cachiato.

**Caveat within-walk da osservare:** la close review fa girare il learning-engine
sull'ultimo turno; se le memorie/profilo si aggiornano prima di un turno successivo
dello stesso walk, lo static cambierebbe. Da osservare nel walk di verifica.

### Fase 2c — Fix accuratezza costUsd: COMPANION A BREVE (non opzionale)

Post-2b, `LLMResponse` e il calcolo costo (`client.ts:226`) NON leggono
`usage.cache_read_input_tokens` / `cache_creation_input_tokens`. Conseguenza:
`input_tokens` crolla (solo delta non cachato) -> `costUsd` **sotto-stima**, ignora sia
il write 1.25x sia il read 0.1x. **Pericoloso nel contesto cost-engineering:** decideremmo
sul modello da un numero falso. Fix 2c = surfacare i cache token in `LLMResponse` +
correggere il calcolo. **Da fare presto**, non rinviabile a lungo.
- **Verifica del singolo walk nel frattempo:** `ANTHROPIC_LOG=debug` (l'SDK logga `usage`
  raw incl. `cache_*`) oppure la dashboard Anthropic.

### Fase 2d — Riordino prompt per cross-run garantito: DIFFERITA

Mettere `modePrompt` (il blocco ~16k) PRIMA di voice/userContext darebbe il caching
cross-run **garantito** del chunk grande indipendentemente dal drift del profilo (utile
in PRODUZIONE per utenti ricorrenti). Ma **cambia il prompt** -> rompe il byte-identico
-> richiede **ri-baseline dell'oracolo**. Guadagno marginale inferiore al within-walk
(gia' catturato da 2b). Differita; si valuta dopo, a freddo, se la produzione lo giustifica.

---

## 3. Scelta del modello (Sonnet vs Haiku vs non-Anthropic)

**Decisione metodologica: la scelta del modello la fa la MISURA sull'harness, non i
benchmark generici.** L'harness K/E (validazione V1.2.4) e' anche lo strumento di
model-eval: stesse celle, `smart=X` vs `smart=Y`, e si confronta la qualita' di
classificazione sul task reale (kept/postponed, "nomina ma non rinfaccia").

**Asimmetria che decide l'ordine:** Haiku si A/B-testa **gratis** (stesso SDK, stesso
formato tool, stesso cache_control, si flippa la stringa modello). Gemini/DeepSeek NO:
richiedono un **adapter di provider** (SDK + formato function-calling diversi) -> il costo
per *valutare* Gemini = il costo per *migrare* a Gemini. Quindi: esperimento economico
(Haiku) prima dell'esperimento caro (adapter).

**Vantaggi specifici di Haiku per Shadow (oltre al prezzo 3x sotto Sonnet):**
- Stessa famiglia di Sonnet -> il prompt V1.2.4 (tarato su Claude) trasferisce con
  re-tuning minimo; la disposizione etica e' della stessa stirpe.
- Edge documentato su instruction-following multi-step + tool-use reliability +
  content moderation -> proprio le dimensioni del walk orchestrato + classificazione sensibile.
- Gemini Flash spesso vince i benchmark di conoscenza/ragionamento generico ed e' piu'
  economico al fondo (Flash-Lite ~4x sotto Haiku) -> ma generico != task di Shadow, e
  comporta riscrittura del layer tool + ri-validazione + ri-tuning etico.

**Sequenza decisionale:**
1. 2b caching + trim del prompt (model-agnostic) -> abbatti il costo dominante.
2. **Misura il costo-walk reale post-caching dalla console** (numero ancora da pinnare).
3. Testa **Haiku** via harness (gratis). Se passa la barra K/E -> 3x meno di Sonnet, zero
   re-architecture, fine.
4. **Solo se** Haiku non passa **o** post-caching il costo a scala beta e' insostenibile
   -> allora l'adapter Gemini/DeepSeek si giustifica, valutato con le stesse celle K/E.

**Conclusione gia' raggiunta a freddo (regge):** post-caching, il delta vs Gemini Flash
era insufficiente a giustificare il rischio di migrazione. Cio' che faceva sembrare il
contrario era il numero PRE-caching.

---

## 4. Stato git / disciplina (L4)

- Tutto **modified-uncommitted**: fix V1.2.4 (`prompts.ts`), harness (`orchestrator.ts`),
  migrazione Fase 1 (`client.ts`). 2b si aggiungera' applicato-uncommitted.
- **Nessun commit stanotte/in questa fase.** Le disposizioni commit (V1.2.4 merge,
  harness, Task C) sono R6 a mente fresca, separate.
- **Prima di QUALUNQUE commit: controllare `.claude/hooks-audit.log`** (segnalate 5+
  auto-approvazioni durante la campagna).
- Per far girare la campagna su 4-6+caching basta che le modifiche siano **applicate** al
  working tree (il dev gira sul locale); il commit NON e' prerequisito.

---

## 5. Prossimi passi (ordine)

1. **Applicare 2b** (3 file friction-strict, un file alla volta, typecheck, no commit).
2. **Fase 2c** (fix costUsd) — companion a breve, prima di basare decisioni-costo sul numero in-app.
3. **Walk di verifica su 4-6+caching** (lo lancia l'operatore): conferma cache-read via
   `ANTHROPIC_LOG=debug`/dashboard + costo ridotto, e **ri-baselina l'oracolo su 4-6**.
4. **Fase 0 harness E2E automatico** (gia' briefata in sessione precedente) -> build harness.
5. **Campagna V1.2.4** (spina K/E ratificata, N da finalizzare post-feasibility, prima su Sonnet 4-6).
6. **Eval Haiku** via harness (stesse celle K/E, smart=Haiku vs Sonnet) -> decide il modello sui numeri.
7. (Condizionale) adapter Gemini/DeepSeek solo se 3/6 lo richiedono.
8. (Differito) 2d riordino prompt; cleanup commenti stale `schema.prisma` 573/579.
