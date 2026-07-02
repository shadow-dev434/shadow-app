# Task 66 — Residui collaudo: URL per vista, economia interruzioni, observability beta

> Spec operativa per una **sessione pulita** di Claude Code (normale, non ultracode).
> Scritta il 2026-07-02 dalla sessione del Task 65, sulla base del report di collaudo
> (`git show docs/62-report:docs/tasks/62-report-collaudo.md`, righe L10/§6.9/§6.15 e
> dossier `62-evidenze/dossier-verdetti.txt`). Decisione di Antonio (2026-07-02):
> batch residui = **D56 + D57 + J10**, con l'invalidazione post reset-password come
> voce OPZIONALE gated da migration. Effort atteso: ~3-4 giorni.
>
> **Branch di partenza: `feature/65-pulizia-automazioni`** (stack 61+63+64+65, non
> mergiato — main è fermo al Task 60) → creare **`feature/66-residui`** da lì. Se nel
> frattempo lo stack è stato mergiato su main, partire da main — verificare con
> `git log --oneline -3 main`.
> Lo stato di partenza INCLUDE già dal 65: reader `?action=` in ChatView (inbox/today),
> SW v9 pulito (zero push/reminder/quick-capture), whitelist settings ridotta,
> ricorrenti self-materializing con rollover, card Ricorrenti in Settings, 401
> `session_invalid` post-delete in `requireSession`, outcome `completed` nel triage,
> badge recovery in Today, piano di rientro nel morning check-in. NON rifarle.

---

## 0. Regole operative (ereditate, NON negoziabili)

1. **Workflow v2**: esplora → domande di prodotto (AskUserQuestion) → piano in plan
   mode → approvazione = unico checkpoint → implementazione end-to-end con
   self-verification (build + tsc + test + probe + browser) → commit checkpoint su
   feature branch. Se Antonio non risponde alle domande: default raccomandati
   DICHIARATI nel piano, ratificati dall'approvazione (pattern 64/65, funziona).
2. **Solo dev locale** (:3000) contro DB dev **royal-feather** (preflight host prima
   di ogni scrittura). MAI probe sui deploy Vercel (Preview/Dev condividono il DB di
   PROD).
3. **Utenti di test**: i 12 `collaudo-*@probe.local` (pwd `Collaudo62!pass`) +
   effimeri `task66-*@probe.local` col pattern di `scripts/e2e/task63/lib.ts` (riusare
   anche `task64/lib.ts`, `task65/lib.ts`). Bonus: `task65-browser@probe.local` è
   seminato con piano a fasce + ricorrenti + badge recovery
   (`scripts/e2e/task65/seed-browser-user.ts` lo ricrea e stampa il cookie).
4. **Una sola sessione Code sul repo** (index git condiviso). Verifica browser:
   preview MCP `shadow-dev` (il dev server è FERMO: riavviarlo con preview_start),
   disinstallare SW+cache prima, DOM probe invece di screenshot. Gotcha noti: un
   cookie HttpOnly stale vince sull'inject `document.cookie` → prima signout via
   `/api/auth/csrf` + POST `/api/auth/signout`; il nome utente nei Settings può
   restare stale da localStorage; fermare il dev server prima di `bun run build`
   (EPERM Prisma su Windows, troubleshooting in CLAUDE.md).
5. File **protetti** (conferma esplicita, da dichiarare nel piano): `orchestrator.ts`,
   `prompts.ts`, `update-plan-preview-handler.ts`, `schema.prisma`, `.env*`,
   `next.config.*`, `package.json`. Nel perimetro 66 il rischio è su **B (D57)**: se
   il taglio del polling proattivo o dei nudge passa da orchestrator/prompts,
   dichiararlo. `components/ui/**` mai.
6. **Migration DB**: attesa SOLO per la voce opzionale D (reset-password). Migration
   = SEMPRE conferma esplicita: la si propone nel piano e ci si ferma lì; senza
   conferma la voce D esce dal piano.
7. Testi utente: **italiano hardcoded** (beta IT-only).

---

## 1. Perimetro — 3 gruppi + 1 opzionale

Riferimenti file:riga dal dossier 62 (rilevati su feature/61; 63/64/65 hanno
spostato `tasks/page.tsx` — **ricontrollare coi Grep, non fidarsi dei numeri**).

### A — D56 · URL per vista (deep-link + back button)

**Stato**: tutte le viste di `/tasks` (inbox, today, task-detail, focus, sky,
settings) vivono in `store.currentView` (`shadow-store.ts:110,257-258` su
feature/61) senza alcun riflesso nell'URL. Conseguenze: refresh/back perdono la
vista; nessun deep-link possibile; su TWA/Capacitor il back di sistema ESCE
dall'app invece di tornare alla vista precedente — per un utente ADHD è perdita
di contesto secca.

**Contratto**:
- vista riflessa nell'URL (raccomandato: query param `/tasks?view=today` — un path
  nuovo richiederebbe matcher middleware e ristrutturazione; decidere nel piano);
- cambio vista → `history.pushState`; `popstate` → `setCurrentView` (il back
  torna alla vista precedente, non fuori dall'app);
- init della pagina legge `?view=` (deep-link diretto);
- ATTENZIONE a non rompere: l'atterraggio one-tap sul focus (Task 61 D3:
  `focusModeActive` check nell'init async, `page.tsx:479-487` su feature/65), la
  route separata `/focus?taskId=` del body doubling (NON toccarla), il matcher
  middleware (`/tasks/:path*` già coperto).
- Micro-decisione da proporre nel piano: il reader `?action=today` di ChatView
  (Task 65 A2) oggi apre il morning check-in in chat (comportamento voluto dal
  Task 44) — resta così di default; eventuale shortcut manifest aggiuntivo verso
  `/tasks?view=today` solo se a costo zero.

Effort M.

### B — D57 · Economia delle interruzioni (collaudo L10, grade C)

**Stato**: "Popup proattivo + nudge + micro-feedback + banner sovrapponibili nella
stessa zona; polling LLM ogni 5 min; micro-feedback interrompe il ritorno al
piano" (`page.tsx:528` polling, `:1289-1336` nudge, `:1489-1597` popup/feedback —
righe di feature/61). Il micro-feedback parte con `setTimeout` 3s dopo l'avvio di
un task (visto dal 65 a `page.tsx:~2372`).

**Passo 1 OBBLIGATORIO (esplorazione)**: inventario COMPLETO delle superfici di
interruzione — grep `setShowMicroFeedback`, `nudge`, `banner`, `Dialog` proattivi,
`setInterval`/polling — con trigger, frequenza e costo LLM di ciascuna. La tabella
va nel piano ed è la base della domanda di prodotto.

**Contratto minimo** (da calibrare con Antonio):
- (a) UNA sola interruzione proattiva visibile alla volta: coda o soppressione con
  priorità, mai stack sovrapposto nella stessa zona;
- (b) micro-feedback SOLO a confini naturali (completamento/fine sessione), MAI
  n secondi dopo l'avvio — l'avvio è il momento più fragile;
- (c) polling proattivo LLM: ridotto, gated su attività o rimosso (valutare costo
  e valore reale coi dati del punto 1);
- (d) budget per apertura (es. max 1 nudge proattivo per apertura app).

**Decisione di prodotto DA FARE (AskUserQuestion)**: aggressività del taglio —
solo de-sovrapposizione (a+b) vs budget rigido (a+b+d) vs anche kill/gating del
polling (a+b+c+d, raccomandata se l'inventario conferma il costo).

Effort M.

### C — J10 · Observability del feedback loop beta

**C1 — Monitor invii Resend falliti** (registro §6.15): oggi il fallimento
dell'email serale è solo `console.error` in
`src/lib/evening-review/evening-email.ts` → il tester che non riceve l'email è
invisibile. Contratto: fallimento → traccia PERSISTENTE e visibile all'admin.
Opzioni da valutare in esplorazione (zero migration: riusare l'esistente):
riga `Notification` (modello esistente) marcata admin, `captureApiError` verso
Sentry (cablato dal Task 60), o contatore nella dashboard admin del Task 23
(esplorare `/admin` e le sue API). Scegliere la superficie MINIMA che risponde a
"chi non sta ricevendo le email?".

**C2 — Notifica "fixed" al tester** (registro §6.9): quando l'admin marca un bug
report come fixed (BugOps Task 23 — esplorare `/api/beta/*` e `/admin`), il
tester non riceve alcun feedback. Contratto: alla transizione di stato → notifica
al tester. **Decisione di prodotto**: canale — riga `Notification` in-app (ma il
client oggi NON legge `/api/notifications`, verificato nel 65: servirebbe un
ingresso UI minimo) vs email via canale Resend del Task 58 (zero UI nuova,
raccomandata per la beta) vs entrambi.

Effort S-M.

### D — OPZIONALE · Invalidazione sessioni post reset-password (MIGRATION)

Il 65 (C2) ha chiuso la sessione fantasma post-DELETE; il reset-password lascia
ancora vive le sessioni JWT fino a scadenza 30gg (commento esplicito in
`api/auth/reset-password`). Serve `passwordChangedAt DateTime?` su `User`
(**MIGRATION → proporla nel piano e FERMARSI: senza conferma esplicita di
Antonio la voce esce**), set nel reset, confronto `token.iat` vs
`passwordChangedAt` in `requireSession` (la query su User c'è già dal 65 C2 —
costo marginale zero).

### Fuori scope (→ task successivo o v3)
D21 share-target 401, §6.11 chiusura d'ufficio plan_preview, §6.12
auto-decomposizione, i18n runtime (W4), nativo/APK (v3), web push (v3 W5).

---

## 2. Ordine suggerito e verifica

1. **Esplorazione** (inventario D57 + BugOps/admin + store view) → domande di
   prodotto → piano in plan mode (dichiarare protetti se B li tocca; proporre la
   migration D e fermarsi su quella voce).
2. **C (J10)** — piccolo e isolato, un commit per C1 e C2.
3. **A (D56)** — URL per vista + history.
4. **B (D57)** — dopo l'inventario, il pezzo più delicato UX.
5. **D** solo se migration confermata.

Verifica per step: `bun run build` (dev server FERMO) + `bunx tsc --noEmit` +
`bun run test`; probe e2e in `scripts/e2e/task66/` (riusare `task63/lib.ts` e
successive): C1 invio fallito → traccia persistente interrogabile; C2 PATCH
admin→fixed → notifica creata per il tester giusto; A deep-link `?view=` →
vista corretta (DOM probe browser) + popstate; D (se fatta) login dopo reset →
vecchia sessione 401. Browser (preview MCP, SW pulito): back button tra viste,
deep-link diretto su today/settings, una-sola-interruzione-alla-volta con seed
che forza nudge+micro-feedback insieme.
Report finale: file toccati, esiti probe, comandi di test manuale, costi.

Domande di prodotto da fare PRIMA del piano (AskUserQuestion, non inventare):
- B/D57: aggressività del taglio interruzioni (con l'inventario alla mano).
- C2/J10: canale della notifica fixed (email vs in-app vs entrambi).
- D: conferma esplicita della migration `passwordChangedAt` (senza → voce fuori).
- A/D56: solo se l'esplorazione rivela trade-off reali (param vs path è tecnica:
  decidere nel piano).

---

## 3. Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`)

```
Leggi docs/tasks/66-post-lancio-residui.md ed eseguila col workflow v2: parti dal
branch feature/65-pulizia-automazioni (o da main se lo stack 61-65 è già stato
mergiato — verifica con git log), crea feature/66-residui, esplora i punti
indicati (inventario interruzioni D57 obbligatorio, BugOps/admin per J10, store
currentView per D56), fai le domande di prodotto previste dalla spec, poi proponi
il piano in plan mode dichiarando eventuali file protetti e proponendo (senza
eseguirla) l'eventuale migration della voce D. Dopo l'approvazione implementa
end-to-end con self-verification (build, tsc, test, probe e2e in
scripts/e2e/task66/ riusando le lib di task63/64/65, verifica browser via preview
MCP con SW pulito) e commit checkpoint. Solo dev locale contro il DB dev
royal-feather (preflight host). Utenti collaudo-* (pwd Collaudo62!pass) o
effimeri task66-*. Al termine: report con file toccati, esiti probe e comandi di
test manuale.
```

Nota per Antonio: chiudere la sessione del Task 65 (o non usarla sul repo) mentre
gira la 66 — index git condiviso. Il dev server del preview è fermo: la 66 lo
riavvia con `preview_start shadow-dev`.
