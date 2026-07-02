# Task 64 — UX pre-lancio (batch dal collaudo 62) + quick-win tecnici

> Spec operativa per una **sessione pulita** di Claude Code (normale, non ultracode).
> Scritta il 2026-07-02 dalla sessione del Task 63, sulla base del report di collaudo
> (`git show docs/62-report:docs/tasks/62-report-collaudo.md`, §4/§5/§7/§8) e del suo
> dossier verificato. Decisioni di Antonio già prese: batch §8-Task-64 **più i quick-win
> tecnici del §7** (2026-07-02). Effort atteso: ~2-3 giorni.
>
> **Branch di partenza: `feature/63-fix-pre-lancio`** (contiene Task 61 + Task 63, non
> ancora mergiati) → creare **`feature/64-ux-pre-lancio`** da lì. NON partire da main.
> Lo stato di partenza INCLUDE già i fix del 63: nav a 5 tab senza Review, cestino con
> conferma, strict che sopravvive al refresh, guard consenso sulle API, claim-guard,
> "Inizia la review" funzionante.

---

## 0. Regole operative (ereditate, NON negoziabili)

1. **Workflow v2**: esplora → domande di prodotto (AskUserQuestion) → piano in plan mode
   → approvazione = unico checkpoint → implementazione end-to-end con self-verification
   (build + tsc + test + probe + browser) → commit checkpoint su feature branch.
2. **Solo dev locale** (:3000) contro DB dev **royal-feather** (preflight host prima di
   ogni scrittura). MAI probe sui deploy Vercel (Preview/Dev condividono il DB di PROD).
3. **Utenti di test**: i 12 `collaudo-*@probe.local` sono vivi (pwd `Collaudo62!pass`,
   login reale) + effimeri `task64-*@probe.local` col pattern di
   `scripts/e2e/task63/lib.ts` (riusarla: mint cookie, preflight, api helper).
4. **Una sola sessione Code sul repo** (index git condiviso, recidive documentate);
   verifica browser: preview MCP `shadow-dev`, disinstallare SW+cache prima, DOM probe
   invece di screenshot (rAF congelato nelle tab nascoste).
5. File **protetti** (conferma esplicita, da dichiarare nel piano): `orchestrator.ts`,
   `prompts.ts`, `update-plan-preview-handler.ts`, `schema.prisma`, `.env*`,
   `next.config.*`, `package.json`. Nel perimetro 64 possono essere toccati SOLO da
   D75 (se `VALID_MODES` vive in `orchestrator.ts:65-71`) e in caso di ritocchi copy
   della proposta strict (D74 è FUORI scope). `components/ui/**` mai.
6. **Zero migration DB attese.** Se un fix sembra richiederne una, fermarsi e chiedere.
7. Testi utente: **italiano hardcoded** (beta IT-only; niente next-intl runtime — quello
   è v3 W4). I prompt LLM restano master in italiano.

---

## 1. Perimetro — 9 fix UX + 6 quick-win

Riferimenti file:riga dal dossier 62 (verificati al 2026-07-02 su feature/61; il 63 ha
spostato alcune righe di `tasks/page.tsx` — ricontrollare coi Grep, non fidarsi dei numeri).

### A. UX (batch §8)

**A1 — D50 · Lingua mista sistemica.** Un solo idioma visibile: italiano.
- Nav: "Inbox / Today / Focus" → etichette italiane (decidere con Antonio le parole:
  proposta "Inbox / Oggi / Focus" — "Inbox" è ormai lessico dell'app, vedi guida).
- `MODE_CONFIG` LAUNCH/HOLD/RECOVERY (page.tsx ~:128): label italiane ("Partenza",
  "Tieni il ritmo", "Recupero" — proporre e far scegliere).
- Settings: enum grezze (`focusModeDefault`, "active strict") → label italiane.
- Errori API in EN mostrati in UI: vedi A4.
- NON toccare i termini di prodotto consolidati ("strict" può restare come nome proprio
  della modalità — decisione di prodotto da confermare con AskUserQuestion).

**A2 — D43+D44 · Un solo piano visibile, con conferma.**
- Oggi: la review serale scrive gli slot in `DailyPlanTask` (close-review.ts:230-248) ma
  la Today mostra una Top3 piatta; e "Rigenera piano ora" (page.tsx ~:2188-2222,
  ~:2374-2377) sovrascrive il piano serale senza conferma; terzo generatore =
  "Pianifica con Shadow" (chat `?plan=today`).
- Contratto: (a) la Today legge e mostra le **fasce del piano serale** quando esistono
  (mattina/pomeriggio/sera con i task dentro), fallback Top3 per i piani senza slot;
  (b) "Rigenera piano ora" chiede **conferma esplicita** se sta per sovrascrivere un
  piano della review ("Il piano di stasera verrà sostituito: procedo?"); (c) i punti di
  ingresso restano due ma dichiarati: rigenera-veloce (engine) vs "Pianifica con Shadow"
  (conversazionale) — copy che spiega la differenza. Dettagli UI: proporre mockup
  testuale nel piano e decidere con Antonio se serve.

**A3 — D48(+D49 minimo) · Cielo che si spiega.**
- Empty state con una riga: "Le stelle si accendono completando i task ricorrenti —
  creane uno in chat ('ogni lunedì palestra')" + CTA che porta in chat con input
  precompilato. Ponte visibile completamento→stella (toast o micro-animazione SOLO se
  a costo basso). D49 (lista/edit ricorrenze da UI) resta FUORI (Task 65): qui solo la
  CTA e la spiegazione.

**A4 — D34 · Errori API in italiano nella chat.**
- turn/route.ts:69-155 emette "attachment too large", "userMessage too long" ecc. →
  ChatView:711 li mostra raw. Mappa server→messaggi IT (o traduzione degli error code
  lato ChatView con fallback generico IT). Copre anche gli errori allegati (413/415).

**A5 — D33 · Il 429 non è un vicolo cieco.**
- ChatView ~:721-733: su cap giornaliero raggiunto, niente bottone "Riprova" identico
  fino a domani: messaggio dedicato ("Per oggi ho finito i messaggi: ci risentiamo
  domani. I tuoi task restano qui.") + niente retry, + le superfici non-chat restano
  usabili. Testabile con `CHAT_DAILY_CAP=1` su dev secondario :3001 (env inline; il
  collaudo ha documentato il rischio `.next` condiviso su Windows: usare
  `--turbopack-dir` alternativo O accettare il test solo-codice, MAI far cadere :3000).

**A6 — D2+D3 · Nudge e dialog portano il task giusto.**
- D2: il nudge "accetta" apre il PRIMO task non completato dello store (page.tsx ~:1312)
  perché `NudgeMessage` non porta `taskId` (shadow.ts:519-531): aggiungere `taskId?` al
  tipo + al nudge engine (estensione, NON riscrittura engine) + il tap apre QUEL task.
- D3: `PriorityConfirmDialog` senza binding taskId (page.tsx ~:1169, ~:1210): con 2
  catture rapide classifica il task sbagliato → il dialog porta il `taskId` del task
  che l'ha generato.

**A7 — Auto-classificazione dei quick-capture (registro §6.3).**
- Oggi i task creati dalla barra inbox restano "da Classificare" (5/5 nel collaudo).
- Contratto: dopo il POST dalla barra, classificazione in background con la **stessa
  pipeline Haiku** già esistente (classificatore Task 45); sopra la soglia di
  confidenza → auto-conferma silenziosa (badge "classificato da Shadow"); sotto soglia
  → dialog attuale (che con A6 porta il taskId giusto). Nessun nuovo endpoint se ne
  esiste già uno riusabile — esplorare `src/lib/engines/` + `api/tasks` + il percorso
  chat prima di scrivere alcunché.

**A8 — D5 · Logout reale.**
- page.tsx ~:614-625: oggi solo store+localStorage, il cookie resta valido 30gg →
  `signOut()` NextAuth reale (pattern `triggerRelogin` di `lib/api/fetch.ts:24`) +
  cleanup store/localStorage esistente. Verificare che dopo il logout una GET API
  autenticata risponda 401 (probe).

**A9 — D6+D7 · Coerenza focus/soft.**
- D6 (page.tsx ~:2945-2951): "Inizia" da TaskDetail con `focusModeDefault` settato crea
  uno strict/soft APPARENTE (store) senza sessione server né scudo → instradare su
  `enterStrictMode`/`startStrictModeSession` (helper del 61/63 già pronti in
  `lib/strict-mode/enter.ts`).
- D7 (page.tsx ~:2739): "Disattiva" del soft non chiude la sessione server → PATCH
  `{status:'exited', exitReason:'user_disabled'}` + pulizia store.

### B. Quick-win tecnici (§7, decisione Antonio 2026-07-02)

| # | Fix | Note |
|---|-----|------|
| B1 | `POST /api/tasks` senza `title` → **400** (oggi 500 Prisma, D14); validare anche `status` fuori dominio nel PATCH | route `api/tasks` |
| B2 | `PATCH /api/settings` con orari invalidi ("25:99") → **400** esplicito (oggi 200 falso-successo, D29) | route `api/settings` |
| B3 | `GET /api/calendar/oauth` senza env → **404/JSON pulito** (oggi 500 nudo, D23) | superficie orfana, solo hardening |
| B4 | `VALID_MODES` ristretto ai 3 mode usati — `general`, `morning_checkin`, `evening_review` (D75: `planning`/`focus_companion`/`unblock` accettati via API con tool sensibili, `unblock` a prompt vuoto) | se il set vive in `orchestrator.ts:65-71` è un **file protetto**: dichiararlo nel piano |
| B5 | Import morto `Bell`/`BellOff` rimosso (D70, page.tsx:31) | 1 riga |
| B6 | Stub `GET /api` "Hello world" rimosso | route morta |

### Fuori scope (→ Task 65 o v3)
Superfici morte D13/D68-D72 (reminder, shortcuts, calendar UI, notifiche in-app, delega,
campi settings), materializzazione ricorrenti su Today/inbox, D56 URL per vista, D57
economia interruzioni, D49 gestione ricorrenze da UI, registro automazioni §6 restante,
i18n runtime (W4), tutto il nativo/APK.

---

## 2. Ordine suggerito e verifica

1. **B1-B6 quick-win** (route isolate, green rapidi, un commit).
2. **A4+A5** (ChatView errori/429 — stesso file, un commit).
3. **A8** logout + probe 401.
4. **A6** nudge/dialog taskId (+ tipo shadow.ts + engine esteso).
5. **A9** coerenza focus (riusa helper 61/63).
6. **A1** lingua (batch di label — safe, grosso ma meccanico).
7. **A3** Cielo empty state.
8. **A2** Today/piano (il più delicato: UI + conferma — per ultimo, con verifica browser
   accurata).
9. **A7** auto-classifica (dipende dall'esplorazione della pipeline Task 45).

Verifica per step: `bun run build` + `bunx tsc --noEmit` + `bun run test`; probe e2e in
`scripts/e2e/task64/` (riusare `task63/lib.ts`): B1/B2/B3 contratti 400/404, A8 logout→401,
A6 nudge con taskId, A7 task da barra → riga DB classificata; browser (preview MCP):
nav/label IT, Today con fasce, conferma rigenera, Cielo empty state, 429 (se testabile),
D6 "Inizia" da TaskDetail → sessione server creata (GET /api/strict-mode non-null).
Report finale: file toccati, esiti, comandi di test manuale, costi probe.

Domande di prodotto da fare PRIMA del piano (AskUserQuestion, non inventare):
- A1: parole esatte della nav e dei mode (proposta inclusa sopra) + "strict" resta nome
  proprio?
- A2: layout della Today a fasce (proporre 2 varianti) + copy della conferma.
- A7: soglia di auto-conferma (proporre quella già usata dalla chat) e badge.

---

## 3. Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`)

```
Leggi docs/tasks/64-ux-pre-lancio.md ed eseguila col workflow v2: parti dal branch
feature/63-fix-pre-lancio, crea feature/64-ux-pre-lancio, esplora i punti indicati,
fai le domande di prodotto previste dalla spec, poi proponi il piano in plan mode.
Dopo l'approvazione implementa end-to-end con self-verification (build, tsc, test,
probe e2e in scripts/e2e/task64/ riusando task63/lib.ts, verifica browser via preview
MCP con SW pulito) e commit checkpoint. Solo dev locale contro il DB dev royal-feather
(preflight host). Utenti collaudo-* (pwd Collaudo62!pass) o effimeri task64-*. Al
termine: report con file toccati, esiti probe e comandi di test manuale.
```

Nota per Antonio: chiudere QUESTA sessione (o non usarla sul repo) mentre gira la 64 —
index git condiviso. Il dev server del preview può restare: la 64 lo riusa
(`preview_start shadow-dev`).
