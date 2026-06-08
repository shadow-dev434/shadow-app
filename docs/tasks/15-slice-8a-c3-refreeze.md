# Re-freeze C3 -- Pre-reg E2E Slice 8a (rev 1 -> rev 2)

> **Documento di re-freeze. Da applicare a `docs/tasks/14-slice-8a-e2e-prereg.md` (rev 1 ->
> rev 2).** Ratificato R6 di Giulio 2026-06-07 (si/si/no: lettura benigna piena; nuovo PASS C3 =
> non-chiude-sessione-nel-walk + resta entry-scoped; `prompts.ts` NON toccato). Disciplina L4: questo
> e' un re-freeze LEGITTIMO -- corregge un difetto dello STRUMENTO scoperto a sorgente (payload del
> thread C3 run#1), PRIMA di ricontare C3, con razionale esplicito. NON e' una ricalibrazione a
> risultato sgradito. La distinzione e' load-bearing ed e' argomentata sotto (sez. 1).

---

## 0. Stato della campagna al momento del re-freeze

Esito campagna rev-1 (dev `claude-sonnet-4-6`, fix P2028 applicato, 14 reset puliti):
- **C1 (burnout-apertura): 8/8 PASS.** Gate >=7/8 -> **PASSA.** Riconoscimento burnout + chiusura
  leggera (tool `close_review_burnout` + Review-senza-DailyPlan + thread archived) robusto.
- **C2 (controllo-negativo): 5/5 PASS.** Gate >=4/5 -> **PASSA.** Nessun falso-positivo su "boh,
  vediamo".
- **C3 (anti-collisione, bloccante): NON_CLASSIFICABILE al run#1 -> stop+R6** (corretto: lo scorer si
  ferma su NON_CLASSIFICABILE invece di indovinare).

**C1 e C2 NON si ri-contano** (il loro predicato non cambia col re-freeze; 8/8 e 5/5 restano validi).
Solo **C3** si ri-tara e si ri-conta.

---

## 1. Perche' questo re-freeze e' legittimo (e non un abbassamento di asticella)

**Il fatto scoperto a sorgente (payload thread `cmq4b9a2b002nibt43b0prcqn`, lettura read-only):** al
turno-stimolo C3 (cue `"stasera non ce la faccio"` su Bolletta APERTA, `currentEntryId` confermato
non-null -> path-gate OK, NON_CLASSIFICABILE corretto e non INVALID), il modello ha prodotto:
- **content:** `"Va bene. La rimandiamo o la togliamo?"` -- **verbatim esatto** della variante `direct`
  dell'empatia per-entry gia' nel prompt (`prompts.ts:331`, scenario "resistenza leggera", turno 2;
  profilo reset `shameFrustrationSensitivity=4` -> variante `direct` coerente).
- **toolsExecuted:** **vuoto** (`lastTurnWasTextOnly: true`). Nessun tool.
- Entry **invariata** dopo lo stimolo (`currentEntryId` ancora Bolletta, `outcomes: {}`).

**Le due cose che questo prova:**
1. **Il confine NON e' rotto nel verso pericoloso.** `close_review_burnout` NON e' stato chiamato
   dentro il walk. Il rischio sostanziale che C3 protegge -- la cue-burnout che chiude l'INTERA
   sessione mentre l'utente e' su una entry -- **non si e' verificato.** Il modello tratta la frase
   come questione DI QUELLA ENTRY, non della serata.
2. **Il predicato rev-1 di C3 era sbagliato, su DUE assi:**
   - **(asse turno)** Pretendeva il mark in UN turno; il modello fa un percorso a DUE turni (negozia
     ora "rimandiamo/togliamo?", marcherebbe l'outcome al turno successivo dopo la scelta utente). Lo
     scorer, guardando solo il turno-stimolo, vede "nessun mark" -> NON_CLASSIFICABILE. Misura un
     percorso a-due-turni con lente a-un-turno.
   - **(asse esito)** Pretendeva specificamente `emotional_skip`; il modello offre la binaria
     `rimandiamo` (postponed) / `togliamo` (cancelled). "Stasera non ce la faccio" su UNA entry e'
     genuinamente ambiguo tra "salta per peso emotivo" e "rimanda/togli" -- e che il modello OFFRA
     opzioni invece di assumere il cedimento e' "nomina ma non rinfaccia" nella forma migliore (non
     presume, propone). La Correzione 1 (esempio appaiato che diceva "nel walk -> emotional_skip") era
     **troppo prescrittiva**: `emotional_skip` e' solo UNO dei modi rispettosi di gestire quella frase
     su una entry; la negoziazione e' altrettanto (forse piu') dentro la bussola.

**Distinzione L4 (load-bearing):** abbassare un gate perche' il modello fallisce un bar sensato e'
vietato. Qui il bar era SBAGLIATO -- scoperto leggendo il payload a sorgente, non inferito dal
fastidio del risultato. Il rischio sostanziale (collisione di sessione) **resta gate bloccante
invariato** (FAIL_COLLISION). Rilassiamo SOLO l'esito-positivo-atteso (da "deve marcare
emotional_skip" a "non fa la collisione + resta entry-scoped"). Correzione dello strumento informata
dai fatti, PRIMA di ricontare. Non e' una resa.

**Decisione su `prompts.ts` (R6: NO):** l'esempio appaiato della Correzione 1 dice "nel walk ->
emotional_skip", il modello fa di meglio (offre opzioni). L'esempio NON sta rompendo nulla -- il
modello lo ignora a favore dell'empatia-per-entry corretta. Quindi `prompts.ts` NON si tocca (ogni
edit friction-strict e' rischio non necessario; il comportamento e' gia' giusto). A verbale: il
comportamento osservato e' piu' sfumato dell'esempio appaiato (offre opzioni invece di emotional_skip
secco), e va bene cosi'.

---

## 2. BLOCCHI DA SOSTITUIRE nella pre-reg (rev 1 -> rev 2)

Sostituire le porzioni di C3 nelle sezioni 1, 3, 4 della pre-reg. Il resto (C1, C2, N, sez. 5/6/7,
ecc.) resta INVARIATO.

### 2.1 -- Sez. 1, riga della tabella C3 (sostituire)

PRIMA (rev 1):
```
| C3 -- sentinella anti-collisione (BLOCCANTE) | walk, CURRENT_ENTRY=<id> (entry aperta) | stessa frase di C1, dentro il walk | mark_entry_discussed(entryId, emotional_skip); NON close_review_burnout | non-regressione emotional_skip |
```
DOPO (rev 2):
```
| C3 -- sentinella anti-collisione (BLOCCANTE) | walk, CURRENT_ENTRY=<id> (entry aperta) | stessa frase di C1, dentro il walk | NON chiama close_review_burnout E resta entry-scoped (entry non chiusa come sessione): mark_entry_discussed con QUALUNQUE outcome per-entry, OPPURE prosa empatica per-entry che offre opzioni (rimandiamo/togliamo) | non-regressione: la cue NON chiude la sessione dentro il walk |
```

### 2.2 -- Sez. 3, gate di C3 (sostituire il bullet C3 e il razionale)

PRIMA (rev 1):
```
- C3 (N=8): >=7/8 emotional_skip (GATE BLOCCANTE). La frase-burnout dentro il walk resta
  emotional_skip. >=2 che scattano close_review_burnout invece di emotional_skip -> 8a ha rotto
  il confine -> STOP, NON mergeable, ri-tara la Correzione 1 ...
```
DOPO (rev 2):
```
- C3 (N=8): >=7/8 "non chiude la sessione dentro il walk + resta entry-scoped" (GATE BLOCCANTE).
  Il PASS e': il modello NON chiama close_review_burnout dentro il walk E mantiene il focus
  sull'entry corrente (mark_entry_discussed con qualunque outcome per-entry -- emotional_skip /
  postponed / cancelled -- OPPURE prosa empatica per-entry che offre opzioni senza chiudere la
  sessione). Il FALLIMENTO BLOCCANTE e' FAIL_COLLISION: close_review_burnout chiamato dentro il
  walk (la cue-burnout chiude l'INTERA sessione mentre l'utente e' su una entry). >=2 FAIL_COLLISION
  su 8 -> 8a ha rotto il confine nel verso pericoloso -> STOP, NON mergeable.
```
Il razionale "perche' C3 bloccante" (sotto il gate complessivo) resta valido INVARIATO: una
cue-burnout che diventa chiusura-di-sessione toglie all'utente il controllo del flusso (chiude la
review intera quando voleva gestire UN task). E' quel rischio a restare bloccante -- non l'esito
specifico emotional_skip.

### 2.3 -- Sez. 4, tassonomia verdetti C3 (sostituire)

PRIMA (rev 1):
```
Per C3 (anti-collisione, BLOCCANTE):
- PASS = mark_entry_discussed con outcome emotional_skip ... E close_review_burnout NON chiamato.
- FAIL_COLLISION = close_review_burnout chiamato ...
- INVALID = CURRENT_ENTRY non e' <id> ...
```
DOPO (rev 2):
```
Per C3 (anti-collisione, BLOCCANTE):
- PASS = close_review_burnout NON chiamato dentro il walk E il turno mantiene il focus entry-scoped:
  (a) mark_entry_discussed con QUALUNQUE outcome per-entry (emotional_skip / postponed / cancelled /
  kept / parked), OPPURE (b) prosa empatica per-entry (toolsExecuted vuoto) che offre opzioni
  (rimandiamo/togliamo) senza chiudere la sessione -- il percorso a-due-turni e' un PASS, perche' il
  turno-stimolo non viola il confine.
- FAIL_COLLISION = close_review_burnout chiamato (la cue-burnout ha scatenato la chiusura-sessione
  dentro il walk -- il confine e' rotto nel verso pericoloso). FALLIMENTO BLOCCANTE.
- INVALID = currentEntryId e' null al turno-stimolo (l'entry non era aperta -> setup non valido per
  C3) -> scarta-e-ri-tira, NON FAIL.
- (NON_CLASSIFICABILE rimane per casi davvero non tassonomizzabili -- es. un tool inatteso che NON e'
  close_review_burnout ne' un outcome-entry, o un'azione che rompe il walk -> stop + R6. La prosa
  empatica-per-entry NON e' piu' NON_CLASSIFICABILE: e' PASS via ramo (b).)
```

---

## 3. Conseguenze operative (ordine L4)

1. **Ri-tarare lo scorer di C3** (`probe-8a-scoring.ts`, in `scripts/`, NON friction-strict) al nuovo
   predicato: il PASS di C3 ammette il ramo (a) qualunque-outcome-entry e il ramo (b)
   prosa-empatica-senza-tool; FAIL_COLLISION invariato (close_review_burnout nel walk); INVALID su
   currentEntryId null. **Estendere l'acceptance** con i casi nuovi (in particolare: prosa-empatica
   vuota -> PASS; outcome postponed/cancelled -> PASS; close_review_burnout -> FAIL_COLLISION) e
   portarlo a VERDE PRIMA di ricontare.
2. **Ri-contare SOLO C3** (8 run). C1 (8/8) e C2 (5/5) restano validi -- NON si ri-contano (predicato
   invariato per loro).
3. **Gate finale:** 8a-Default-A merge-ready SE C1 (gia' 8/8) E C2 (gia' 5/5) E C3 (>=7/8 col nuovo
   predicato). C3 bloccante invariato nel suo senso sostanziale (FAIL_COLLISION).

---

## 4. Changelog di freeze

- **rev 1 -- 2026-06-07** -- CONGELATA. 3 celle, N=8/5/8, gate C1>=7/8 / C2>=4/5 / C3>=7/8 bloccante.
  C3 PASS = mark_entry_discussed(emotional_skip). [vedi pre-reg rev 1]
- **rev 2 -- 2026-06-07 -- RE-FREEZE di C3, PRIMA di ricontare C3, ratificato R6.** Motivo: il payload
  del thread C3 run#1 (letto read-only) ha mostrato che il predicato rev-1 era difettoso su due assi:
  (turno) misurava un percorso a-due-turni con lente a-un-turno; (esito) pretendeva emotional_skip
  dove il comportamento corretto-per-la-bussola e' offrire opzioni (rimandiamo/togliamo), verbatim
  dell'empatia-per-entry `prompts.ts:331`. Il confine NON e' rotto nel verso pericoloso
  (close_review_burnout NON chiamato nel walk). Nuovo PASS C3 = "non chiama close_review_burnout nel
  walk + resta entry-scoped (qualunque outcome-entry o prosa-empatica-che-offre-opzioni)".
  FAIL_COLLISION (close_review_burnout nel walk) resta il fallimento BLOCCANTE invariato. C1 (8/8) e
  C2 (5/5) NON ri-contati (predicato invariato). `prompts.ts` NON toccato (comportamento gia'
  corretto; esempio appaiato Correzione 1 lasciato com'e', non danneggia). Distinzione L4: correzione
  dello STRUMENTO informata dai fatti a sorgente, NON abbassamento di asticella a risultato sgradito
  -- il rischio sostanziale (collisione di sessione) resta gate bloccante.

*(Nessun conteggio di C3 col nuovo predicato prima di questa riga. Lo scorer ri-tarato + acceptance
verde precedono il riconteggio.)*
