# Retest mirato V1.1 — pre-registrazione (2026-04-29)

> Stato: pre-registrato, da eseguire
> Commit testati: `0582e1c` (V1.1 fix #14) + `89eb0bc` (V1.1 fix #11), entrambi su `origin/main`
> Sessione di riferimento per il fail originale: 2026-04-29 mattina (vedi `05-retro-slice-5-3b.md`)

## Contesto

Slice 5 commit 3b chiuso il 2026-04-29 con verdetto promozione NON raggiunta (testuale 3/5, comportamentale 4/5, ordering 5/5). I due commit di fix V1.1 sono stati implementati in giornata:

- **Commit 1 (`0582e1c`)** — chiude tech debt #14: nuovo tool `propose_decomposition` come prerequisito di `approve_decomposition`, guard server-side, prompt evening_review esteso con sequenza obbligatoria 3 turni + esempio multi-turno positivo + esempio negativo.
- **Commit 2 (`89eb0bc`)** — chiude tech debt #11: prompt evening_review esteso con 12 esempi few-shot mirati su `style × pressure` (FOLLOW-UP DOPO APERTURA + VARIAZIONI PER STYLE).

Tech debt #15 (mismatch dimensioni `AdaptiveProfile` dichiarate vs esposte in `buildUserContext`) **resta non chiuso**. Strategia: il retest mirato verifica se il prompt hardening da solo regge. Se non regge, commit 3 dedicato per estendere `buildUserContext`.

Questo documento pre-registra scope, rubric, criteri di sospensione del retest. La pre-registrazione è essa stessa applicazione della lezione L4 del retro-mortem 2026-04-29: "la pre-registrazione include il criterio di sospensione, non solo lo script". I criteri di sospensione sono nella sezione 5 sotto.

## 1. Scope esatto degli scenari

Il retest è **mirato**, non completo. Riusiamo i 5 scenari pre-registrati della sessione 2026-04-29 in versione ridotta, focalizzata sulle zone dove il fix V1.1 deve provare di reggere.

**Scenari da rieseguire:**

- **S2 turno 2** — apertura entry MANUAL/gentle + risposta utente vaga al turno 2. Test del fix #11 (FOLLOW-UP DOPO APERTURA). 1 turno effettivo + setup.
- **S4 turni 1-4** — apertura entry MANUAL/direct + trigger linguistico decomposizione + sequenza completa propose → confirm → approve. Test combinato fix #14 (sequenza obbligatoria) + fix #11 (VARIAZIONI PER STYLE su gentle se applicabile, ma S4 è direct, quindi solo fix #14). 4 turni.
- **S5 turni 1-3 completo** — apertura entry MANUAL/gentle + trigger numerico (`postponedCount≥3`) + sequenza propose → confirm → approve. Test combinato fix #14 (sequenza obbligatoria con trigger numerico) + fix #11 (gentle in zona decomposizione). Turno 1 e 2 erano stati eseguiti in Decisione 3 della sessione precedente con Opzione C. Qui rieseguire da capo per pulizia di setup post-fix. 3 turni.

**Totale**: ~8-9 turni effettivi browser-based, più setup e lookup pre-turni.

**Out of scope esplicito**: S1 e S3 della sessione precedente erano PASS, non li rieseguiamo. Il fix V1.1 non dovrebbe regredirli — verifica empirica solo se la suite vitest 138/138 dà segnale di regressione (oggi non lo dà).

## 2. Rubric fix #14 (sequenza obbligatoria propose → confirm → approve)

Asserzioni binarie per ogni scenario testato. Tutte e tre devono essere PASS per scenario clean.

**S4 turni 1-4** (trigger linguistico decomposizione):

- **A1** Al turno della proposta della decomposizione (turno N), il modello chiama `propose_decomposition` con microSteps validi (3-5 step). Verifica via `toolsExecuted` nel payload del turno.
- **A2** Al turno N (proposta), il modello NON chiama `approve_decomposition`. Verifica via `toolsExecuted` payload.
- **A3** Al turno N+2 (post-conferma utente "sì" al turno N+1), il modello chiama `approve_decomposition` con microSteps coerenti con quelli proposti al turno N. Verifica via `toolsExecuted` payload.

**S5 turni 1-3 completo** (trigger numerico `postponedCount≥3`):

Stesse asserzioni A1, A2, A3 ma con scope sul trigger numerico invece che linguistico.

**Soglia di promozione fix #14**: **2/2 sequenze clean** (S4 + S5 entrambi PASS su tutte le asserzioni A1-A3) → fix #14 chiuso. Una sequenza fail su qualsiasi asserzione → fix #14 NON chiuso, ricalibrazione richiesta.

## 3. Rubric fix #11 (style × pressure)

Asserzioni binarie sui turni in style=gentle, applicate meccanicamente.

**S2 turno 2** (apertura entry + risposta vaga utente al turno 2, gentle):

- **G1** Output del modello al turno 2 contiene almeno una **frase di riconoscimento esplicito** prima della domanda. Marker accettati (interpretazione semantica, non lista chiusa): "OK, prendiamoci un momento", "Sento che", "Vediamo insieme", "Capisco", oppure equivalente che valida l'utente prima di interrogarlo.
- **G2** Lunghezza output del turno 2 ≥20 parole.

**S5 turno 2** (apertura entry MANUAL/gentle + post-apertura, gentle):

Stesse asserzioni G1, G2.

**S5 turno N (proposta decomposizione, gentle nel contesto di S5 che ha utente con style=gentle)**:

- **G3** Output prosa della proposta contiene almeno uno dei marker delle VARIAZIONI PER STYLE per il turno N gentle: "ho pensato a", "passi piccoli", "praticabile", "controlli", oppure frasing dilatato analogo che ammorbidisce l'imperatività.
- **G4** Lunghezza output del turno N ≥25 parole (orientativa da CORE_IDENTITY: gentle 25-35 parole).

**S5 turno N+2 (post-conferma utente, gentle)**:

- **G5** Output prosa post-conferma propone una **scelta aperta** (non una mossa singola). Marker: "adesso o domani", "Vuoi cominciare", "ci pensiamo", oppure equivalente che dà spazio a opzioni multiple.

**Totale asserzioni gentle**: G1+G2 (×2 scenari S2, S5 turno 2) + G3+G4 (S5 turno N) + G5 (S5 turno N+2) = **5 punti di valutazione gentle distinti**.

**Modalità di scoring**: ogni punto di valutazione PASS se entrambe le asserzioni della coppia sono PASS (es. S2 turno 2 PASS solo se G1∧G2). Se una sola PASS, conta come FAIL. G3+G4 di S5 turno N idem. G5 standalone.

**Soglia di promozione fix #11**: **≥4/5 punti PASS** → fix #11 chiuso. **2-3/5** → fix #11 parzialmente chiuso, valutare se Strada 2 (#15) è necessaria. **≤1/5** → fix #11 NON chiuso, Strada 2 (#15) come commit 3 obbligatorio.

## 4. Rubric ordering (sanità)

Asserzione binaria: gli scenari vengono eseguiti senza side effect cross-scenario sul triage state. Verifica via lookup pre-turni.

**Soglia**: ordering 5/5 invariato dalla sessione precedente. Fail ordering = blocco strutturale fuori conteggio (segnale che l'archittura ha regressioni).

## 5. Criteri di sospensione dello script (L4 retro-mortem)

I tre eventi che fanno sospendere lo script E2E e richiedono decisione esplicita prima di continuare.

**Evento 1: fail comportamentale strict prima dell'ultimo scenario.**

Definizione: in S4 (qualsiasi turno) o S5 (qualsiasi turno), una delle asserzioni A1, A2, A3 è FAIL.

Decisione richiesta: scegliere tra:
- (a) **investigazione live root cause**: leggere prompt + orchestrator + toolsExecuted del turno fail per discriminare se è regressione del fix #14, prompt non sufficiente, o nuovo fail mode. Costo stimato 10-15 min.
- (b) **annota e prosegui**: registrare il fail, terminare lo scenario corrente, eseguire lo scenario rimanente per vedere se il pattern è sistemico.
- (c) **stop**: chiudere il retest, fix #14 ricalibrazione richiesta come commit 3.

Criterio di scelta: stima di ripetibilità del fail (se il fail è in S4, S5 con trigger numerico è ancora informativo perché trigger diverso → preferire b). Investigazione live (a) preferita se il fail è ambiguo nel turno specifico (es. il modello chiama un tool ma non capiamo perché).

**Evento 2: ipotesi di artefatto del setup E2E.**

Definizione: durante o dopo l'esecuzione, emerge ipotesi che il fail osservato dipende da setup E2E (es. profilo utente sovrascritto parzialmente, lookup pre-turni inconsistente, thread sticky non archiviato) e non dal sistema sotto test.

Decisione richiesta: investigare se costo < 15 min, **indipendentemente da ora di giornata e stanchezza**. L'ipotesi smentita è informativa quanto la conferma (lezione L2 retro-mortem). Se costo ≥ 15 min, registrare l'ipotesi nelle note retest e proseguire senza investigare ora.

**Evento 3: scenario eseguibile in versione ridotta.**

Definizione: se un fail noto del fix #14 si presenta a turno N di S4 o S5, i turni successivi (N+1, N+2, ...) potrebbero produrre informazione ridondante.

Decisione richiesta: valutare se i turni successivi aggiungono informazione discriminante (es. testano marker fix #11 indipendenti dal fix #14 fallito). Se sì, completare. Se no, fermare lo scenario al turno N e passare al successivo. Pattern già usato in Decisione 3 della sessione precedente (Opzione C su S5 turni 1-2).

## 6. Procedura operativa

Pattern operativo R1+R2+R3+R6 del retro-mortem.

**Setup pre-retest** (una volta sola):

1. Lookup stato corrente: `bun -e "..."` su `AdaptiveProfile` test user, `Settings` evening window, `ChatThread` orfani da archiviare.
2. Se thread non-evening sticky presenti, archiviare via script (tech debt #1 ricorrente, workaround noto).
3. Profilo test user sovrascritto via `temp-shift-profile-style.ts` per scenari gentle (S2 e S5).

**Esecuzione per scenario** (ciclo S4 → S2 → S5):

1. Lookup pre-scenario: stampa task non-terminali, profilo, active thread, review della giornata.
2. Setup specifico: seed eventuali task con `postponedCount` o stato richiesto dallo scenario.
3. Esecuzione browser-based: utente apre la chat in dev, immette il messaggio iniziale, copia-incolla output verbatim a fine di ogni turno.
4. Applicazione rubric meccanica subito dopo ogni turno: PASS/FAIL per ogni asserzione del scope di quel turno.

**Disciplina**: niente patch in-flight, niente modifiche al prompt o al codice durante il retest. Se il retest fallisce, la decisione su come ricalibrare è separata dalla rubric (sezione 7 sotto).

## 7. Decisioni di scaling post-retest

Albero binario per la decisione finale.

**Caso A — fix #14 PASS (2/2) + fix #11 PASS (≥4/5)**: promozione 3b raggiunta. Slice 5 commit 3b production-ready. Annotare nelle deploy-notes la chiusura di tech debt #11 e #14. Tech debt #15 può restare non chiuso indefinitamente (l'architettura attuale di `buildUserContext` regge per V1).

**Caso B — fix #14 PASS (2/2) + fix #11 PARZIALE (2-3/5)**: il prompt hardening da solo non basta per gentle, Strada 2 (#15) candidata. Decisione: valutare costo/beneficio di estendere `buildUserContext` con `shameFrustrationSensitivity` + popolamento coerente del profilo test user vs accettare il fail testuale gentle come parziale per V1 (tester veri possono settare profilo coerentemente). Sessione di pianificazione dedicata, non decisione live.

**Caso C — fix #14 PASS + fix #11 FAIL (≤1/5)**: Strada 2 (#15) **obbligatoria** come commit 3 dedicato. Pianificazione architetturale per estendere `buildUserContext` a esporre più dimensioni di `AdaptiveProfile` al modello.

**Caso D — fix #14 FAIL (1/2 o 0/2)**: ricalibrazione fix #14 richiesta. Strada 2 server-side guard più aggressiva (es. guard hard livello (a) dell'analisi originale, non livello (c) implementato), oppure investigazione di nuovo fail mode non previsto. Sessione di pianificazione dedicata, fix #11 può restare in sospeso fino a chiusura fix #14.

In tutti i casi B/C/D, registrare il verdetto nel `05-deploy-notes.md` con rubric applicata meccanicamente, evidence verbatim del modello, decisione di scaling esplicita.

## 8. Cosa NON è in scope di questo retest

- Test E2E completi di tutti gli scenari S1-S5 (S1, S3 erano PASS, non rieseguiti).
- Asse comportamentale ordering nei dettagli (asserzione di sanità sì, retest profondo no).
- Test di nuove feature non previste in commit 3b (asse 3.3 frizione emotiva, scope commit 4).
- Verifica architetturale del flow tool execution sequenziale (non testabile via E2E, già coperto da unit test).

---

*Pre-registrato 2026-04-29. Da eseguire in sessione fresca o di seguito su decisione operativa.*
