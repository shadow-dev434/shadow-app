# Task 62 — Report di collaudo totale pre-lancio

> Collaudo eseguito il **2026-07-02** (sessione ultracode, Fable 5) sul branch
> `feature/61-strict-onetap-proposta`, **solo in locale** (dev server :3000) contro il
> **DB dev Neon (royal-feather)**, con utenti dedicati `collaudo-*@probe.local`.
> Nessun fix applicato al codice dell'app (regola d'ingaggio §0): questo report è il
> deliverable; l'approvazione dei fix è il checkpoint di Antonio.
> Evidenze complete in `docs/tasks/62-evidenze/` (trascrizioni chat, dump DB, JSON dei
> journey, verdetti di verifica). Metodo: 10 journey + sweep API + audit UX + analisi
> architetturale, **ogni finding verificato adversarialmente** (Fase 5) prima di entrare qui.

---

## 1. Executive summary — verdetto **NO-GO** (condizionato)

Il core loop **funziona ed è buono**: la cattura in chat crea task classificati con una sola
interazione, la review serale conversazionale è snella e senza colpevolizzazione, la friction
anti-uscita dello strict è progettata bene, il rientro dopo assenza è gestito senza shaming.
La spina dorsale c'è. Ma **cinque difetti bloccano il lancio** perché colpiscono le tre promesse
centrali (cattura affidabile, review che prepara il piano, "one-tap e sei al lavoro") o perdono
dati sensibili in silenzio.

**Verdetto: NO-GO finché non sono chiusi gli S1 e i due S2 di privacy.** Sono ~1-2 giorni di
lavoro mirato (proposta Task 63). Nulla di architetturale: sono anelli mancanti in feature
altrimenti complete.

### Bug S1 (bloccano l'uso o perdono dati) — 3
- **S1-A · Cattura allucinata in chat lunga.** In una singola chat (e l'app usa *una chat al
  giorno*, quindi tutte le catture del giorno finiscono nello stesso thread), dopo ~15 messaggi
  il modello fast (Haiku) **smette di chiamare `create_task` continuando a rispondere "Creato"/
  "È già creato"**. I task non esistono in DB e l'utente non ha modo di accorgersene; sull'insistenza
  il modello raddoppia ("Non c'è altro da fare su questo"). Perdita silenziosa sulla promessa più
  importante. *(ADV-hallucinated-create, CONFERMATO 3×; evidenza J3)*
- **S1-B · Review manuale rompe la giornata (D1).** Il tab "Review" invia `{completed/avoided}`
  ma l'API scrive `ReviewTask.status` (NOT NULL) → **500 con la `Review` di oggi già creata a metà**;
  quella riga poi **sopprime la review serale conversazionale per tutto il giorno** (il segnale
  `computeEveningReviewSignal` vede una Review-oggi e non parte più). *(D1 CONFERMATO S1)*
- **S1-C · Refresh durante strict = fuga totale (D8).** Lo store non è persistito e il mount
  reidrata solo il body-double: un `F5` durante lo strict **rimuove ogni friction** e lascia una
  **sessione `active_strict` orfana in DB** (`endedAt` mai valorizzato). L'intero valore
  anti-impulso crolla con un reload. *(D8 CONFERMATO S1)*

### Bug S2 di privacy/dati (vanno chiusi prima del lancio) — 2
- **S2-PRIV1 · La revoca del consenso non ferma il trattamento.** Dopo `DELETE /api/consent`
  (art. 7(3) GDPR), **tutte le API continuano a funzionare**, chat LLM inclusa: il gate consenso
  del middleware è solo sulle *pagine*, il ramo `/api/*` fa passthrough. La UI promette
  "Revocare il consenso ferma l'app": mantenuta a metà. *(ADV-revoca-consenso CONFERMATO S2)*
- **S2-PRIV2 · `/beta/assessment` scrive dati art.9 senza gate + eliminazione account senza
  conferma server-side.** Qualunque utente autenticato (anche non-beta) può `PATCH
  /api/beta/assessment` e persistere punteggi clinici ASRS (dato salute art.9): il perimetro è
  garantito solo dall'invisibilità UI (D66). E `DELETE /api/account` esegue la cascade **senza
  verificare server-side la stringa "ELIMINA"** (controllo solo client). *(D66 + ADV-delete-no-confirm)*

> Nota: gli S1/S2 sopra sono **comportamento e dati**, non falle di isolamento/IDOR/auth — quelle
> erano già coperte dal Task 60 e non sono state ri-collaudate (fuori scope §0).

### Il resto in una riga
Oltre agli S1/S2, il collaudo conferma **72 delle ~70 piste del dossier** (1 smentita: D12;
1 by-design: D25; 2 fuori-scope: D19 APK, D26 prod) più diversi finding nuovi. La gran parte
sono **frizioni UX e superfici morte/orfane** che non bloccano ma vanno ripulite per una beta
credibile (Task 64/65). Spesa LLM del collaudo: **~$7.15** (tracciata in `AiUsage`).

---

## 2. Scorecard lente ADHD (L1–L10)

| # | Criterio | Voto | Evidenza / sintesi |
|---|----------|------|--------------------|
| **L1** | Tap-budget | **B** | Cattura in chat = 1 interazione oltre il testo (ottimo). Ma "one-tap Inizia" è **2 tap** (timer atterra in pausa, serve "Sblocca e inizia", D32); completare un task dall'inbox non ha percorso (J1 §16). Tabella §9.1. |
| **L2** | Zero vicoli ciechi | **C** | Vicoli reali: `/focus` senza task (D51), tab Focus senza task, 429 cap "Riprova" fino a domani (D33), "Inizia la review" → chat vuota (D31), Cielo 0/4 senza CTA (D48). |
| **L3** | Automation-first | **C+** | 34 passi manuali automatizzabili censiti (§6). L'app *ha già i dati* (postponedCount, whatBlocked, pattern) ma non agisce: reminder morti, materializzazione ricorrenti solo on-chat, timer che non parte, classificazione da confermare a mano. |
| **L4** | Perdono | **B+** | Onboarding con resume perfetto; abbandono flussi non punitivo. **Ma** review interrotta oltre finestra persa in silenzio (D45), e delete-account con unico attrito client-side. |
| **L5** | Rientro | **A−** | Il migliore dell'app: dopo 4 giorni nessuna colpa ("Capita.", "Bentornato." senza conteggio), rollover corretto, conteggi veri (J4). Difetto: rientro notturno = chat vuota muta. |
| **L6** | Comprensione 10s | **C** | Chat empty state eccellente; ma Cielo, /focus orfano, Today con 2 generatori competono, lingua mista pervasiva abbassano il voto. Walkthrough §9.4. |
| **L7** | Fiducia | **C** | Promesse rotte: "ferma l'app" (consenso), "Disconnesso" (logout finto D5), "riceverai un link" (forgot incondizionato D65), "disattiva nelle impostazioni" (toggle inesistente D67), one-tap. Errori API in EN in UI IT (D34). |
| **L8** | Carico conversazionale | **B−** | Cattura ≤1 domanda (buono). Review felice 8 turni (snella). Ma il procrastinatore = 38+ turni per chiudere; ripetizione mood/energia 3-4×; il modello ignora "rimandiamolo" 2× prima di chiudere. |
| **L9** | Coerenza nomi/superfici | **C−** | Doppioni: Review tab vs review serale, tab Focus vs `/focus`, 2 generatori di piano. Lingua mista sistemica (nav EN + IT, LAUNCH/HOLD/RECOVERY, enum grezze). |
| **L10** | Economia attenzione | **C** | Popup proattivo + nudge + micro-feedback + banner sovrapponibili nella stessa zona (D57); polling LLM ogni 5 min; micro-feedback interrompe il ritorno al piano. |

**Media: C+/B−.** Il loop base è forte (L5/L1-cattura/L4), l'affidabilità e la coerenza sono
il tallone (L2/L7/L9).

---

## 3. Bug per severità (con repro ed evidenza)

### S1 — bloccano l'uso o perdono dati

**S1-A — Cattura allucinata in chat lunga** *(nuovo; ADV-hallucinated-create)*
- Repro: chat general, catture una per turno. Le prime ~3 eseguono `create_task`; da ~15 messaggi
  in poi il modello risponde "Creato con scadenza…" con `toolsExecuted=[]` e **0 righe DB**. Su
  "non lo vedo in lista" → "È già creato. Non c'è altro da fare su questo."
- Evidenza: `62-evidenze/J3/trascrizione-thread-cmr2vv3u8001bib74mn91v20e.md` (26 "Creato" vs 8 tool reali), `riepilogo-catture.txt`.
- Causa probabile: nessun guardrail che verifichi "testo che dichiara creazione ⇒ tool_result";
  `orchestrator.ts:971-987` copre solo la risposta vuota. Aggravato dal design *una chat/giorno*.
- File: `src/lib/chat/orchestrator.ts:971-987`, `src/lib/chat/prompts.ts` (mode general, nessuna direttiva anti-allucinazione).

**S1-B — Review manuale 500 + soppressione review serale (D1)**
- Repro: compilare il tab "Review" di `/tasks` e salvare → 500; poi la review serale non parte più oggi.
- Evidenza: `62-evidenze/J6/j6g-*.json` (500 + Review orfana), `dossier-verdetti.txt` D1.
- File: `src/app/tasks/page.tsx:3078-3080` (payload `completed/avoided`) vs `src/app/api/review/route.ts:41-56` (`ReviewTask.status` NOT NULL, `schema.prisma:322`); soppressione via `compute-signal.ts:63-67`.

**S1-C — Refresh durante strict = fuga + sessione orfana (D8)**
- Repro: one-tap Inizia → strict attivo → `F5` → app su inbox pulita, nessuna friction; DB: sessione `active_strict`, `endedAt=null`.
- Evidenza: `62-evidenze/J8-strict-focus-bodydouble/journal.md` (verificato di persona).
- File: `src/store/shadow-store.ts` (no persist), `src/app/tasks/page.tsx:584-603` (mount reidrata solo body_double).
- Correlati: **D10** (chiusura-per-sostituzione: `actualDurationMinutes=0, exitReason=''`) e il fatto che **`endedAt` non è mai valorizzato all'uscita** sporcano le statistiche.

**S1-candidato — Cestino inbox senza conferma** *(nuovo, J1)*
- Repro: in inbox l'icona cestino (senza label, adiacente a "Classifica") **elimina il task al
  primo tap**, zero conferma, zero undo; il toast "Task eliminato" compare ~2s dopo e dura <1s.
  Nel collaudo ha cancellato "Finire presentazione" (urgenza 5 con deadline).
- File: gestore delete inline in `src/app/tasks/page.tsx` (riga cestino inbox). Severità S1/S2 a
  giudizio: perdita dati con un tap accidentale, ma reversibile solo ricreando.

### S2 — rompono una promessa core

| ID | Titolo | File / evidenza |
|----|--------|-----------------|
| **ADV-consenso** | Revoca consenso non ferma le API (chat LLM inclusa) | `middleware.ts:136-143,114,207-212`; `consent-guard.ts` usato solo in 2 route beta |
| **ADV-delete** | `DELETE /api/account` senza conferma server-side (solo client "ELIMINA") + cookie resta valido dopo (sessione fantasma) | `api/account/route.ts:11-25`; `page.tsx:3282` |
| **D66** | `/beta/assessment` scrive art.9 da qualunque autenticato; Export GDPR beta-only | `page.tsx:3394`; J10 parte1 step3 |
| **D4** | `isBetaTester` mai mintato dal login/register custom → strumentazione beta invisibile al tester reale | `api/auth/login/route.ts:61-70`; J10 parte1 |
| **D31** | "Inizia la review" non avvia nulla: chat vuota con chip generici, nessun thread creato | `ChatView.tsx:538-560` (verificato di persona) |
| **D32** | one-tap → timer in pausa: serve un tap extra ("Sblocca e inizia"), contro la promessa Task 61 | `strict-mode/enter.ts:100-109`; `page.tsx:2500-2505` |
| **D5** | Logout finto: solo store+localStorage, cookie valido 30gg → su PC condiviso si rientra | `page.tsx:614-625` |
| **D6** | "Inizia" da TaskDetail con `focusModeDefault` → strict apparente senza sessione/scudo/friction | `page.tsx:2945-2951` |
| **D7** | "Disattiva" del soft non chiude la sessione server (nessun PATCH) | `page.tsx:2739` |
| **D2** | Il nudge "accetta" apre il PRIMO task non completato dello store, non quello del nudge (nudge senza `taskId`) | `page.tsx:1312`; `shadow.ts:519-531` |
| **D3** | `PriorityConfirmDialog` senza `taskId`: con 2 catture rapide classifica il task sbagliato | `page.tsx:1169,1210` |
| **D13** | Reminder morto end-to-end: input assente, nessun dispatcher, SW chiama un'API inesistente | `page.tsx:2902-2933`; `sw.js:257-278` |
| **D21** | Share target: sessione scaduta → SW redirige "come salvato" (401 inghiottito), contenuto perso | `sw.js:205-231` |
| **D43** | Piano per fasce in review ma Today mostra Top3 piatta (slot `DailyPlanTask` ignorati) | `close-review.ts:230-248` vs Today |
| **D44** | "Rigenera piano ora" sovrascrive il piano serale senza conferma (2 generatori) | `page.tsx:2188-2222,2374-2377` |
| **D45** | Review interrotta oltre finestra persa in silenzio (intake mai materializzato) | `normalize.ts:86-95` |
| **D46** | "le altre due dopodomani" senza alcun meccanismo di ripescaggio | `prompts.ts:1170-1184`; `triage.ts:98` |
| **ADV-0cand** | Review con 0 candidate non chiudibile ("Chiuso" ma niente Review/DailyPlan; si ripropone domani) | `triage.ts:618-622`; `orchestrator.ts:1305-1309` |
| **ADV-ricorrenti** | Materializzazione ricorrenti innescata SOLO dalla chat: inbox/Today non la chiamano | `api/tasks/route.ts`, `api/daily-plan/route.ts` (nessun `materializeRecurringForDate`) |
| **ADV-crisi** | Su messaggio di crisi il modello esegue `record_emotional_offload` (vietato HARD R6): la risposta utente è corretta (112/Telefono Amico), ma un LearningSignal etichetta la crisi come "sfogo" | `tools.ts:2401-2417`; `prompts.ts:434`; J6d |

### S3 e UX
Confermati (dossier + nuovi): D9, D10, D11, D14, D15, D16, D17, D18, D20, D22, D24, D27, D28,
D29, D30, D33-D42, D47-D64, D67-D76, D-tz, D-auth, D-w7, D-b45. Verdetti puntuali in Appendice A.
Nessuno blocca il lancio singolarmente; nel loro insieme abbassano fiducia e comprensione.

---

## 4. Finding UX ordinati per impatto (retention × frequenza / effort)

1. **one-tap che non parte (D32)** — colpisce l'azione più pubblicizzata, a ogni sessione. Effort S. → *pre-lancio*.
2. **"Inizia la review" no-op (D31)** — il bottone d'ingresso della serata fa nulla. Effort S. → *pre-lancio*.
3. **Lingua mista sistemica (D50)** — su ogni schermata, mina credibilità. Effort M (i18n già presente ma inusata). → *pre-lancio parziale (almeno la nav)*.
4. **Today: 2 generatori di piano + Top3 piatta (D43/D44)** — confonde il passo 3-4 del loop. Effort M. → *pre-lancio*.
5. **Cielo isola senza spiegazione/CTA (D48/D49)** — feature-reward che non insegna se stessa. Effort S/M. → *pre-lancio (empty state) / post (gestione ricorrenti)*.
6. **Cattura inbox: 5 task restano non classificati + cestino senza conferma** — attrito e rischio dati. Effort S. → *pre-lancio*.
7. **Errori API in EN (D34) + 429 vicolo cieco (D33)** — l'utente incontra inglese e muri. Effort S. → *pre-lancio*.
8. **Sovrapposizione interruzioni (D57)** — popup+nudge+micro-feedback insieme. Effort M. → *post-lancio*.

---

## 5. Cose di troppo — RIMUOVI / COLLEGA / UNIFICA (da Fase 4, verificato a codice)

**RIMUOVI per la beta (superfici morte/orfane che promettono e non mantengono):**
- **Reminder** (D13): input morto nel detail + nessun dispatcher + SW che chiama API inesistente. Rimuovere lo stato reminder dal TaskDetail e `syncReminders` dal SW. Effort S.
- **Shortcuts manifest + `?action=` + quick-capture offline + push handler** (D68/D21): nessun client legge `?action`; niente sender push. Rimuovere gli shortcut dal manifest (o implementare il reader). Effort S.
- **Google Calendar** (D69/D23): route complete, zero UI, `oauth` senza env → 500 nudo. Già invisibile; assicurarsi che nessun testo lo menzioni. Fuori scope beta. Effort S.
- **Notifiche in-app + push-subscription** (D70): API complete, `Bell` importata mai renderizzata. Rimuovere l'import morto. Effort S.
- **Delega** (D72): quadrante "delegate" + Contact CRUD senza alcun flusso di assegnazione. Nascondere il quadrante per la beta. Effort S.
- **Campi Settings morti** (D71): defaultEnergy/Context/Duration/Format, wake/sleep, productiveSlots, theme, reminderMinutes — scrivibili da API, invisibili in UI. Effort S (nascondere) / M (esporre).
- **`GET /api/stub` "Hello world"** e **`next-intl` importato mai usato**: codice morto. Effort S.
- **Modi latenti orchestrator** `planning`/`focus_companion`/`unblock` (D75): accettati da `/api/chat/turn` con tool sensibili; `unblock` ha prompt vuoto. Restringere `VALID_MODES` ai 3 usati. Effort S. **(FIX consigliato)**

**UNIFICA:**
- **Review tab manuale ⇄ review serale** (D1/D54/L9): stessa tabella `Review`, il tab manuale genera il 500 S1 e contatori senza filtro data. Rimuovere il tab o ricondurlo alla review conversazionale. Effort M.
- **"Rigenera piano" ⇄ "Pianifica con Shadow" ⇄ `commit_today_plan`** (D44): 2-3 generatori che si sovrascrivono. Unificarli con conferma. Effort M.
- **tab Focus ⇄ `/focus`** (D51): stesso nome, esperienze diverse; `/focus` orfano è un vicolo cieco. Effort M.
- **`/` ⇄ `/chat`**: stessa ChatView, tenerne una. Effort S.

**COLLEGA:**
- **Cielo → resto** (D48): CTA "crea un ricorrente" nell'empty state; ponte visibile completamento→stella.
- **Nudge/insight → task** (D2/D60): far portare `taskId` al nudge e aprire QUEL task.
- **Slot del piano → Today** (D43): la Today deve leggere gli slot, non solo `top3Ids`.
- **Materializzazione ricorrenti → inbox/Today** (ADV-ricorrenti): chiamarla anche in `GET /api/tasks` e `daily-plan`, o via cron.

---

## 6. Registro delle automazioni (L3) — il deliverable per "l'utente deve fare il meno possibile"

Ordinato per valore. Ogni voce: *passo manuale oggi → cosa può fare l'app da sola* (dati già disponibili).

**Alto valore (tolgono attrito sul core loop):**
1. **Timer che parte da solo dopo one-tap** (D32): oggi atterra in pausa. → avviarlo subito.
2. **Materializzare i ricorrenti su Today/inbox** (ADV-ricorrenti): oggi solo in chat. → chiamare `materializeRecurringForDate` in `GET /api/tasks`/`daily-plan` o con cron giornaliero, così "il ricorrente di oggi c'è" anche senza chattare.
3. **Auto-classificazione batch dei quick-capture** (J3): i 5 task da barra inbox restano "da Classificare". → classificarli in background con la stessa pipeline Haiku (già esiste per la chat), auto-confermando sopra una soglia di confidenza.
4. **Piano di rientro precompilato** (J4): al ritorno con N scaduti, proporre da soli i 2 critici in Top3 con una sola conferma, invece della chat vuota.
5. **whatBlocked → primo micro-step armato** (J5): dopo che la review cattura "non so da dove partire", la Today del giorno dopo può armare il micro-step da 30s del task evitato (l'engine `generateRecoveryAction` lo genera già).
6. **"l'ho fatta" nel triage → completa il task** (J2): oggi non esiste nemmeno il percorso manuale (né `outcome 'done'`).

**Medio valore (chiudono promesse a metà):**
7. **Revoca consenso → blocco server-side automatico** su tutte le API (guard `requireConsent` accanto a `requireSession`). (chiude S2-PRIV1)
8. **Invalidazione sessioni al delete/reset** (claim `passwordChangedAt`/`userVersion` in `requireSession`): chiude la sessione fantasma (D5, ADV-delete).
9. **Notifica al tester quando l'admin marca "fixed"** (J10): oggi zero feedback → riga Notification o email.
10. **Attivazione beta senza logout** (D4): mintare `isBetaTester` anche nel login/register custom (o rileggerlo da allowlist a ogni request), così il tester vede subito la strumentazione.
11. **Chiusura d'ufficio in plan_preview** (J5/ADV-0cand): dopo 2 conferme testuali senza tool, chiudere/esporre una quickReply, invece di loop infinito.
12. **Auto-decomposizione con `decision='decompose_then_do'`** (D61/J5): arrivare in review con gli step già proposti invece di aspettare il rito.
13. **Reminder reali o rimozione** (D13): se si tiene la promessa "te lo ricordo", serve dispatcher + campo orario sul task; altrimenti non prometterlo.
14. **Materializzazione retroattiva dei ricorrenti saltati** (J7): se non apri l'app, l'istanza di ieri non nasce mai → cron o rollover.
15. **Monitor invii Resend falliti** (J10): oggi solo `console.error`, il tester che non riceve l'email è invisibile.

Elenco completo (34 semi) in `62-evidenze/` (uxNotes L3 dei journey).

---

## 7. Quick win (≤1h ciascuno, alto rapporto)

- Rimuovere l'import morto `Bell/BellOff` (D70) e lo `stub GET /api` (codice morto).
- `POST /api/tasks` senza title → **400** invece di 500 (D14); validare lo `status` in `PATCH` (dominio).
- `GET /api/calendar/oauth` senza env → **404/JSON pulito** invece di 500 nudo (D23).
- Tradurre in IT gli errori API della chat (D34) e le label di navigazione (D50 nav).
- Confermare il cestino inbox con un dialog (S1-candidato) o dare un undo reale.
- `PATCH /api/settings` con orari invalidi → **400 esplicito** invece del 200 falso-successo (D29).
- Restringere `VALID_MODES` ai 3 mode usati (D75).
- Cielo empty state: una riga "Le stelle si accendono coi task ricorrenti — creane uno in chat" (D48).

---

## 8. Proposta di batch dei fix (decide Antonio)

- **Task 63 — Pre-lancio S1/S2 (bloccante, ~1-2 gg):** S1-A (guardrail claim-vs-tool sulla cattura), S1-B/D1 (allineare payload review manuale o rimuovere il tab), S1-C/D8 (persist strict + chiusura sessione orfana + `endedAt`), S2-PRIV1 (guard consenso sulle API), S2-PRIV2 (conferma server-side delete + gate art.9 su `/beta/assessment`), D4 (mint `isBetaTester`), D31 (avviare davvero la review), D32 (timer parte da solo), cestino con conferma.
- **Task 64 — UX pre-lancio (~2-3 gg):** lingua mista (D50), 2 generatori/Top3 piatta (D43/D44), Cielo empty state + CTA (D48), errori IT (D34), 429 non-vicolo-cieco (D33), nudge→taskId (D2/D3), auto-classifica quick-capture, D5 logout reale, D6/D7 coerenza focus.
- **Task 65 — Post-lancio (pulizia + automazioni):** RIMUOVI superfici morte (D13/D68/D69/D70/D71/D72), materializzazione ricorrenti su Today (ADV-ricorrenti), reminder reali, deep-link/URL per vista (D56), economia interruzioni (D57), registro automazioni §6 alto/medio valore.

---

## 9. Metriche del collaudo

### 9.1 Tabella tap-budget (L1, misurata)
| Azione | Tap/interazioni reali | Target | Esito |
|--------|----------------------|--------|-------|
| Catturare un task (chat) | 1 (testo + Invia), 0 domande bloccanti | ≤2 | ✅ |
| Catturare un task (inbox quick) | 1 (testo + Invio) ma resta "da Classificare" | ≤2 | ⚠️ non finito |
| Iniziare a lavorare dalla Today (one-tap) | **2** (Inizia → Sblocca e inizia) | 1 (Task 61) | ❌ D32 |
| Completare un task (3 step) | ~4 (3 step + complete) | ≤2 | ⚠️ |
| Fare la review | solo conversazione (8 turni felice) | conversazione | ✅ |
| Attivare strict | 1 (poi vedi D32) | 1 | ⚠️ |
| Avviare body doubling | 2-3 (setup + durata) | ≤3 | ✅ |
| Correggere una classificazione | apre form manuale con slider | ≤2 | ⚠️ |
| Rimandare un task a domani | via chat/review | — | ✅ |
| Creare una ricorrenza | testo + 1 QR conferma | ≤2 | ✅ |
| Vedere i progressi (Cielo) | 1 tab, ma 0/4 senza spiegazione | ≤1 | ⚠️ |
| Cambiare finestra serale | **impossibile da UI** (D67) | ≤3 | ❌ |
| Disattivare le email | **impossibile da UI** (D67) | ≤3 | ❌ |

### 9.2 Coverage
- **Journey**: 10/10 eseguiti. J1/J8 in UI reale; J2-J7,J10 via API+chat (workflow); J9 rieseguito manualmente (l'agente si era bloccato su `curl`). PASS complessivo con i finding sopra.
- **Route API**: ~44 check di contratto su 53 route (401/happy/invalid) + cron. Escluse dal test attivo: le route Google Calendar oltre `oauth` (orfane, fuori scope) e il loop cron reale (rischio email — vedi §9.4).
- **Schermate**: 14/14 walkthrough (`62-evidenze/fase3-walkthrough-L6.md`).
- **Dossier §12**: 77 verdetti su ~70 piste — 72 CONFERMATO, 1 SMENTITO (D12), 1 BY-DESIGN (D25), 2 FUORI-SCOPE (D19 APK, D26 prod), 1 PLAUSIBILE (D9). Nessuna lasciata cadere.

### 9.3 Spesa LLM del collaudo
**~$7.15 totali** su `AiUsage` per gli utenti `collaudo-*` (202 chiamate, tier chat/review reali).
Ordine di grandezza atteso; nessun costo anomalo.

### 9.4 Note di sicurezza operativa del collaudo
- **Dev server caduto una volta**: il passo cap-giornaliero di J9 (secondo dev server :3001 con `.next` condiviso su Windows) ha degradato :3000; **ripristinato** con `preview_start` e i journey hanno recuperato. Il test cap live è stato quindi **saltato** (documentato via codice: 429 IT su cap raggiunto/kill-switch) per non ricadere.
- **Cron email NON lanciato in reale**: `GET /api/cron/evening-review` invia email Resend a *ogni* utente in finestra del DB condiviso (al momento del test: 1 utente non-probe con dominio fittizio + 5 probe). Testati **gate auth (404)** e **logica (candidati/dedup/opt-out/finestra) via funzioni pure senza invio**. → checklist Antonio.
- **CRON_SECRET assente** da `.env.local` (prerequisito §3.3 non soddisfatto): in dev la cron risponde 404 a chiunque; il path "secret giusto" non è esercitabile finché non viene aggiunto.

### 9.5 Utenti di test lasciati vivi per la QA manuale di Antonio
Tutti sotto `@probe.local`, password **`Collaudo62!pass`** (login reale):
`collaudo-vergine` (registrato da zero, con 3 task + ricorrente spesa), `collaudo-tipo` (giornata piena, piano oggi),
`collaudo-strict` (blockedApps + piano), `collaudo-procrastinatore`, `collaudo-review`, `collaudo-rientro` (dati -4gg),
`collaudo-ricorrenti`, `collaudo-caos`, `collaudo-errori`, `collaudo-beta`/`collaudo-admin`/`collaudo-nonbeta` (gate; allowlist in `.env.local`).
Gli utenti effimeri dei sotto-scenari (j6b-h, j10gdpr, sweep, throttle, cron) sono stati cancellati; `collaudo-j10del` è stato eliminato apposta (test cascade).

---

## 10. Appendice A — esito puntuale del dossier §12

Legenda verdetto: CONFERMATO / SMENTITO / BY-DESIGN / FUORI-SCOPE / PLAUSIBILE.
Tabella completa con file:riga in `62-evidenze/dossier-verdetti.txt` e ragionamenti in `62-evidenze/fase5-verifica.json`.

**Confermati (72)** — S1: D1, D8. S2: D2, D3, D4, D5, D6, D7, D13, D21, D31, D32, D43, D44, D45, D46, D66. S3/UX: D10, D11, D14, D15, D16, D17, D18, D20, D22, D24, D27, D28, D29, D30, D33, D34, D35, D36, D37, D38, D39, D40, D41, D47, D48, D49, D50, D51, D52, D53, D54, D55, D56, D57, D58, D59, D60, D61, D62, D63, D64, D65, D67, D68, D69, D70, D71, D72, D74, D75, D76, D-tz, D-auth, D-w7, D-b45.

**Non confermati (5):**
- **D12 — SMENTITO**: il re-submit della review manuale re-incrementa `avoidanceCount` SOLO nel branch `tr.status==='avoided'`, ma quel branch è guardato e nel flusso reale non si ripete come temuto. (`review/route.ts:113-131`)
- **D25 — BY-DESIGN**: la prima occorrenza di un ricorrente nato da task non-manual non accende la stella; è una scelta documentata (`lit-stars.ts:10-15`, monotonia loss-free). Resta un difetto UX minore (nessuna spiegazione).
- **D9 — PLAUSIBILE**: l'uscita friction forza `planned`; coerente col codice (`page.tsx:1131-1132`) ma non isolato a runtime il caso "era in_progress".
- **D19 — FUORI-SCOPE**: riga permesso batteria hardcoded — APK on-device (Task 59), non collaudabile in web.
- **D26 — FUORI-SCOPE**: prefisso `__Secure-` cookie — solo su https di produzione.

**Finding NUOVI (non nel dossier), tutti CONFERMATI in Fase 5:**
- ADV-hallucinated-create (S1), ADV-crisi-offload (S2), ADV-revoca-consenso (S2), ADV-delete-no-confirm (S2), ADV-review-0-candidate (S2), ADV-ricorrenti-non-materializzati (S2).
- Da J1/J8/J10: cestino inbox senza conferma (S1/S2), `endedAt` mai valorizzato all'uscita strict, execution-view che persiste nello store dopo l'uscita, off-by-one date sulle catture post-mezzanotte, "Focus mode: Strict" derivato senza domanda in onboarding.

---

## 11. Appendice B — checklist on-device per Antonio (APK + prod, non collaudabile in web dev)

- [ ] **Scudo reale**: su APK, con `blockedApps` impostate, aprire Instagram/TikTok durante lo strict → deve bloccare davvero (su web è no-op dichiarativo).
- [ ] **Dialog 4 permessi + riga batteria** (D19): verificare che lo stato "Batteria senza limiti" rifletta il permesso reale (oggi hardcoded `false`) e che i permessi concessi a metà sessione riarmino lo scudo.
- [ ] **Tasto Indietro** durante strict: non deve aggirare la friction.
- [ ] **Share target Android** (D21): condividere un testo da un'altra app con sessione **scaduta** → non deve dire "salvato" se non ha salvato (401 inghiottito); e senza doppioni.
- [ ] **Banner install PWA mobile** e **shortcuts `?action=`** (D68): oggi ignorati — verificare/decidere.
- [ ] **Notifica/email serale su telefono**: lanciare `GET /api/cron/evening-review` con `CRON_SECRET` **su staging o DB isolato** (mai sul DB dev/prod condiviso: invia email vere a tutti gli in-finestra) e verificare ricezione + dedup + opt-out.
- [ ] **Riavvio sessione dopo grant permessi**: dopo aver concesso i permessi, lo scudo deve attivarsi senza riavvio manuale.
- [ ] **Cookie `__Secure-`** (D26) su https di produzione.
- [ ] **Prerequisito mancante**: aggiungere `CRON_SECRET` a `.env.local`/Vercel (§3.3 non fatto).
- [ ] **Consenso legale** (D53/C1-C2): versione ancora `0.2-draft` a runtime, `/privacy` con apostrofi al posto degli accenti — da finalizzare prima del lancio pubblico.

---

*Fine report. Nessun file dell'app è stato modificato durante il collaudo (solo `scripts/e2e/collaudo-62/` e `docs/tasks/62-*`). Le evidenze granulari sono in `docs/tasks/62-evidenze/`.*
