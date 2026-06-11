# Decisione di chiusura -- Bug #7: `update_plan_preview` mai chiamato (refutato a HEAD)

> **DECISIONE DI CHIUSURA -- rev 1 -- 2026-06-07, presa dal coordinatore su delega R6 di Giulio.**
> Disciplina L4: Bug #7 e' chiuso come MORTO a HEAD. Nessun fix, nessuna campagna conteggiata.
> Base: probe esplorativo a due tier, 10/10 PASS su due scenari (corto + pieno-stress), 0 FAIL.
> Riapertura lecita SOLO al trigger di sorveglianza (sez. 6), con voce nel changelog. Modello
> sotto test: `claude-sonnet-4-6`. Citazioni `file:riga` verificate a sorgente nelle sessioni
> 2026-06-06/07; la pre-reg `05-bug7-prereg.md` e' fonte secondaria (e stale, sez. 1).

---

## 0. Cosa e' Bug #7 e cosa decide questo documento

Bug #7 (definizione pre-reg, `05-bug7-prereg.md:16-17`): in fase `plan_preview`, su override
esplicito ("sposta X", "togli Y"), il modello NON chiama `update_plan_preview` e risponde in
prosa libera -- l'override dell'utente sul piano non viene applicato.

Questo documento chiude Bug #7 come **morto a HEAD** (`b21c85d`): refutato sia sul percorso
naturale corto sia sullo scenario pieno-stress, senza un solo FAIL su 10 run. Non c'e' fix da
scrivere (niente da correggere) ne' campagna conteggiata da lanciare (era prevista "solo se
vivo"; non e' vivo). E' lo stesso esito di backlog (b) e (c): un item che si chiude per
scoperta/misura, non per ricalibrazione.

---

## 1. Lo stato di partenza: pre-reg stale, zero baseline a HEAD

- La pre-reg `05-bug7-prereg.md` e' CONGELATA a `ff1affd`; HEAD e' `b21c85d`, **+8 commit** in
  mezzo, inclusi i walk-fix V1.2.3 (`db88679`), V1.2.4 (`06c05f9`), la generalizzazione
  alreadyOpen (`b21c85d`) e Task C / migrazione `sonnet-4-6` (`85294a5`). Il "codice sotto
  test" della pre-reg e' stale rispetto a HEAD.
- La pre-reg si auto-flagga obsoleta (`05-bug7-prereg.md:18-20`, verbatim): conferma "3/3
  retest 2026-05-14 ... Dato pre-ff1affd e pre-V1.3 (forced tool_choice / lastTurnWasTextOnly):
  potenzialmente obsoleto."
- **Zero run validi** a HEAD prima del probe: registro esiti vuoto; Run #1 scartato per mancata
  transizione walk (a `ff1affd`, pre walk-fix, `05-bug7-prereg.md:369`). L'unica evidenza
  positiva del bug e' il 3/3 del 2026-05-14, pre-hardening, su un modello diverso da quello
  attuale.

---

## 2. Cause a sorgente che spiegano il morto (Fase 0)

Le due ipotesi forti che spiegherebbero un tool-non-chiamato sono **escluse a sorgente**:
- **Tool esposto.** `update_plan_preview` E' esposto al modello in fase `plan_preview`
  (`tools.ts:284-289`); in `closing` no (`tools.ts:292-296`). Non e' "tool non disponibile".
- **Istruzione presente e few-shot.** Il prompt istruisce a chiamarlo (`prompts.ts:572`) con
  few-shot per ogni parametro (`prompts.ts:591-743`), incluso il MOVES esplicito che mappa
  diretto all'override. Non e' "istruzione assente o solo dichiarativa".

Inoltre, **entrambe le remediation prescritte** dalle deploy-notes (`05-deploy-notes.md:872-875`:
"forced tool_choice o esempi few-shot positivi") risultano gia' presenti a sorgente. Conclusione:
a HEAD il bug e' verosimilmente chiuso dalla combinazione walk-fix + hardening few-shot + cambio
modello. Quale dei tre l'abbia ucciso non e' determinabile dal probe, ne' rilevante per la
disposizione.

---

## 3. Il probe esplorativo: metodo e risultato

Probe tooled a due tier (NON conteggiato; precedente: oracolo n=3 di `09`, "segnale
convergente, non un verdetto"). Osservazione sul **tool call** (`update_plan_preview` in
`toolsExecuted` al turno-override), non sul literal del testo. Classificatore puro
`classifyOverrideTurn` (acceptance 8/8 verde) con 6 verdetti; reader read-only
`readOverrideTurn`; path-gate fase pre-override (!=`plan_preview` -> INVALID). X e `planTaskIds`
dalla stessa `reconstructEveningReviewPreview` (no drift), funzione pura dichiarata
single-source-of-truth orchestrator/tooling.

- **Tier-1 -- scenario corto** (3 task Bolletta, walk via flag harness): **5/5 PASS**. Override
  `spostiamo Telefonata commercialista al pomeriggio` -> `update_plan_preview` con `moves`
  valido, 5/5.
- **Tier-2 -- scenario pieno-stress** (8-candidate, walk NATURALE senza flag): **5/5 PASS**.
  Override `spostiamo Rinnovo abbonamento palestra al pomeriggio` -> `update_plan_preview` con
  `moves` valido, 5/5.

**10/10 PASS, una sola classe di esito** su entrambi gli scenari: mai prosa libera, mai
`confirm` al posto di `update`, mai args malformati, mai INTERMEDIO/NON_CLASSIFICABILE.
Side-effect del probe Tier-2: il walk 8-candidate **raggiunge `plan_preview` a HEAD** (zero
`walk-no-transition`) -- refuta anche il rischio "reachability 8c a HEAD non verificata".

Thread (reperto, leggibili in DB): Tier-1 cmq2yrybf / cmq2yu00y / cmq2yviju / cmq2yx2fg /
cmq2yyonf; Tier-2 cmq309te5 / cmq30co1z / cmq30fypy / cmq30iq5j / cmq30lhon.

---

## 4. Onesta' L4 sulla forza del claim

5+5 e' un **probe esplorativo, non una garanzia statistica** (stessa logica del 35/35 di
V1.2.4). "Morto-confermato" significa: refutato su entrambi gli scenari a N=5, margine pulito
(0/10), su un bug che non ha mai prodotto un baseline positivo a HEAD. NON significa
"impossibile riappaia in un caso non testato". La posta e' bassa e lo permette: Bug #7 e' un
tool-non-chiamato che degrada l'UX dell'override-piano, **NON un rischio etico** e non tocca
"nomina ma non rinfaccia". La confidenza fine, se mai servisse, viene dal monitoraggio di
produzione (eventi reali, stesso logging `payloadJson`, gratis su N grande): la beta valida
asintoticamente.

---

## 5. Decisione: chiusura, niente fix, niente campagna conteggiata

Bug #7 e' **chiuso come morto a HEAD**. Niente edit a `prompts.ts`/`tools.ts`/orchestrator.

- **Niente fix:** 10/10 PASS, non c'e' comportamento difettoso da correggere. Toccare
  `prompts.ts` (friction-strict, few-shot replicati letteralmente) per un bug non osservabile
  introdurrebbe varianza senza guadagno -- la trappola (b).
- **Niente campagna conteggiata:** era prevista "SOLO se vivo" (`05-bug7-prereg.md`). Non e'
  vivo. Contarla ora significherebbe spendere run formali per misurare la fedelta' di un
  comportamento gia' corretto -- inverso del costo/segnale.

---

## 6. Trigger di sorveglianza (NON di riattivazione)

A differenza di (b) -- dormiente in attesa di un consumer da costruire -- Bug #7 e' **refutato**,
e il suo trigger e' di sorveglianza, non di sviluppo:

**Trigger:** se in produzione/beta si osservano eventi di override-piano in cui
`update_plan_preview` non viene chiamato sul turno di override (prosa libera, o
`confirm_plan_preview` al posto di `update`) -- rilevabili dallo stesso `payloadJson` -- Bug #7
si riapre.

In quel caso: re-freeze pre-reg a HEAD-di-allora + design fix (locus C, sez. 8, primo
candidato) + campagna conteggiata. Non c'e' nulla da attendere per riaprire: il segnale e' il
comportamento reale degli utenti.

---

## 7. Reperto e strumento

- La pre-reg `05-bug7-prereg.md` resta **untracked come reperto storico** (NON rimossa): questo
  documento la cita e la supera. Sorte git = R6 Giulio.
- Lo strumento del probe e' **riusabile** per futuri probe di override-piano:
  `scripts/e2e/probe-bug7.ts` (engine a due tier), `scripts/lib/preview-turn-reader.ts` (reader
  preview-shaped read-only), `scripts/e2e/probe-bug7-scoring.ts` + acceptance (classificatore
  puro, 6 verdetti), `scripts/check-virgin-8c.ts` (check verginita' 8c, exit 2). Tutti
  untracked, friction-strict mai toccati. Sorte git = R6 Giulio.

---

## 8. Nota a sorgente non chiusa, non load-bearing: locus C

Resta una contraddizione testuale reale in `prompts.ts`: il residuo "rinvia" (`prompts.ts:555`)
contraddetto dall'eccezione/scope di Slice 6b (`prompts.ts:562`, `:564`). **Non ha prodotto un
FAIL osservabile a HEAD** (10/10 PASS). Non si tocca: correggere un difetto testuale che non
causa comportamento osservabile e' la trappola (b), e `prompts.ts` e' friction-strict con
replica letterale dei few-shot. Se il trigger di sorveglianza (sez. 6) riapre Bug #7, locus C
e' il primo candidato di fix.

---

## 9. Changelog di freeze

- **rev 1 -- 2026-06-07** -- CHIUSURA, presa dal coordinatore su delega R6 di Giulio. Bug #7
  morto a HEAD `b21c85d`: probe esplorativo a due tier, 10/10 PASS (5 corto + 5 pieno-stress),
  0 FAIL, walk 8c transita a HEAD. Cause a sorgente (tool esposto, few-shot presente,
  remediation gia' in codice) coerenti col morto. Niente fix, niente campagna conteggiata.
  Trigger di sorveglianza su eventi produzione. Pre-reg 05 resta reperto untracked; strumento
  probe riusabile untracked. Nessun edit a sorgente.

*(Eventuale riapertura: aggiungere voce qui col segnale di produzione osservato e la data.)*
