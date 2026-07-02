# Task 67 — Residui finali collaudo: share target onesto, chiusura plan_preview, auto-decomposizione

> Spec operativa per una **sessione pulita** di Claude Code (normale, non ultracode).
> Scritta il 2026-07-02 dalla sessione del Task 66, sulla base del report di collaudo
> (`git show docs/62-report:docs/tasks/62-report-collaudo.md`, voci D21/§6.11/§6.12/D75)
> — sono gli item dichiarati "fuori scope (→ task successivo)" dalla spec 66.
> Effort atteso: ~2-3 giorni.
>
> **Branch di partenza: `feature/66-residui`** (stack 61+63+64+65+66, non mergiato —
> main è fermo al Task 60) → creare **`feature/67-residui-finali`** da lì. Se nel
> frattempo lo stack è stato mergiato su main, partire da main — verificare con
> `git log --oneline -3 main`.
> Lo stato di partenza INCLUDE già: dal 65 reader `?action=` in ChatView (con
> `?action=share` **noop deliberato**), SW v9 pulito; dal 66 URL per vista
> (`/tasks?view=`), economia interruzioni (coordinatore + budget), traccia email
> fallite + notifica fixed, revoca sessioni post reset (`passwordChangedAt`).
> NON rifarle.

---

## 0. Regole operative (ereditate, NON negoziabili)

1. **Workflow v2**: esplora → domande di prodotto (AskUserQuestion) → piano in plan
   mode → approvazione = unico checkpoint → implementazione end-to-end con
   self-verification (build + tsc + test + probe + browser) → commit checkpoint su
   feature branch. Se Antonio non risponde alle domande: default raccomandati
   DICHIARATI nel piano, ratificati dall'approvazione (pattern 64/65/66, funziona).
2. **Solo dev locale** (:3000) contro DB dev **royal-feather** (preflight host prima
   di ogni scrittura). MAI probe sui deploy Vercel (Preview/Dev condividono il DB di
   PROD).
3. **Utenti di test**: i 12 `collaudo-*@probe.local` (pwd `Collaudo62!pass`) +
   effimeri `task67-*@probe.local` col pattern di `scripts/e2e/task66/lib.ts`
   (riusare anche task63/64/65; `task66/lib.ts` ha già `mintAdminCookie` e `sleep`).
   `scripts/e2e/task65/seed-browser-user.ts` ricrea l'utente browser con piano a
   fasce e stampa il cookie.
4. **Una sola sessione Code sul repo** (index git condiviso; branch-check separato
   prima di ogni commit). Verifica browser: preview MCP `shadow-dev` (il dev server
   è FERMO: riavviarlo con preview_start), disinstallare SW+cache prima, signout via
   `/api/auth/csrf` + POST `/api/auth/signout` prima dell'inject cookie, DOM probe
   invece di screenshot; fermare il dev server prima di `bun run build` (EPERM
   Prisma su Windows). Gotcha bun nel Bash tool: usare il percorso WinGet
   (`.../Oven-sh.Bun_.../bun-windows-x64`) nel PATH.
5. File **protetti** (conferma esplicita, da dichiarare nel piano): `orchestrator.ts`,
   `prompts.ts`, `update-plan-preview-handler.ts`, `schema.prisma`, `.env*`,
   `next.config.*`, `package.json`. **Nel perimetro 67 il rischio protetti è
   CENTRALE, non marginale**: B (§6.11) vive nel loop dell'orchestrator e C (§6.12)
   quasi certamente tocca prompts/triage. Il piano DEVE elencare quali protetti
   tocca e perché; l'approvazione del piano è la conferma.
6. **Niente migration attese**. Se l'esplorazione ne facesse emergere una: proporla
   nel piano e fermarsi (senza conferma esplicita la voce esce).
7. Testi utente: **italiano hardcoded** (beta IT-only).
8. Per i cambi al comportamento conversazionale (B e C): oltre alle probe
   deterministiche, **almeno una verifica con LLM reale** del flusso review
   (il 65 ha insegnato che i prompt vanno testati contro il modello vero — gotcha
   "prompt rientro reso imperativo").

---

## 1. Perimetro — 3 gruppi + 1 opzionale

Riferimenti file:riga dal dossier 62 (rilevati su feature/61; 63-66 hanno spostato
molto — **ricontrollare coi Grep, non fidarsi dei numeri**).

### A — D21 · Share target onesto (Android/PWA)

**Stato al collaudo**: condividere testo da un'altra app con sessione **scaduta** →
il SW rispondeva "salvato" inghiottendo il 401: contenuto perso in silenzio
(`sw.js:205-231` su feature/61). **Stato post-65 da RI-ESPLORARE**: il SW v9 non ha
più i percorsi quick-capture e il reader `?action=share` di ChatView è un noop
deliberato — quindi oggi lo share target dichiarato nel `manifest.json`
(`share_target` → `/?action=share`) molto probabilmente **scarta il contenuto
condiviso sempre**, anche a sessione valida. Verificare cosa arriva davvero
(GET con `?action=share&text=...`? POST?) e cosa se ne fa il client.

**Contratto**: mai dire "salvato" senza aver salvato; mai perdere in silenzio un
testo condiviso. Due strade (decisione di prodotto, AskUserQuestion):
- **implementare il salvataggio reale**: `?action=share&text=` → precompila
  l'input chat (o crea il task via API con conferma visiva); sessione
  scaduta/assente → il middleware redirige al login e il testo sopravvive al
  round-trip (query param preservato o sessionStorage);
- **rimuovere `share_target` dal manifest** per la beta (onestà > feature; il
  collaudo D68 già suggeriva "rimuovere gli shortcut o implementare il reader" —
  il 65 ha implementato il reader per inbox/today, lo share è rimasto monco).

Attenzione: cambiare `manifest.json` impatta la PWA/TWA installata (re-verifica
manifest in browser). Effort S-M.

### B — §6.11 · Chiusura d'ufficio del plan_preview (ADV-0cand)

**Stato**: nella review serale, arrivati al `plan_preview`, se l'utente risponde
con conferme testuali generiche ("ok", "va bene") il modello può non chiamare mai
il tool di commit → **loop infinito di conferme**; caso estremo collaudato
(ADV-0cand): review con 0 candidate "chiusa" a parole ma senza Review/DailyPlan
scritti, e la review si ripropone il giorno dopo (`triage.ts:618-622`,
`orchestrator.ts:1305-1309` su feature/61).

**Contratto minimo** (calibrare con Antonio):
- dopo **N conferme testuali consecutive senza tool call** in fase plan_preview,
  l'orchestrator chiude d'ufficio (chiama lui il commit con il piano corrente) o
  espone una quickReply esplicita "Conferma il piano" che committa
  deterministicamente — niente terzo giro di "ok";
- la review con 0 candidate deve poter chiudere DAVVERO (Review scritta, stato
  pulito, niente riproposta l'indomani).
- **Decisione di prodotto**: soglia N (2 raccomandato) e comportamento
  (auto-commit vs quickReply; la quickReply è più prevedibile, l'auto-commit è
  più ADHD-friendly — portare trade-off).

Tocca `orchestrator.ts` (PROTETTO) e forse `prompts.ts`/`triage.ts` → dichiarare.
Probe: conversazione simulata deterministica se possibile + **verifica LLM reale**
(review vera con risposte "ok ok ok"). Effort M.

### C — §6.12 · Auto-decomposizione `decompose_then_do` (D61)

**Stato**: quando il classificatore/triage decide `decompose_then_do`, il task
arriva in review SENZA step: l'utente deve chiedere la decomposizione a mano
("il rito"). L'engine di decomposizione esiste già (`src/lib/engines/`,
decomposition — NON riscriverlo).

**Contratto**: arrivare al momento review/triage con gli step **già proposti** per
i task marcati `decompose_then_do` (generazione anticipata, deterministica o LLM
a seconda di cosa fa oggi l'engine — verificare costo: se serve una chiamata LLM
extra per task, quantificarla nel piano).
- **Decisione di prodotto**: quando generare (al triage della review vs alla
  classificazione vs lazy al primo focus) e se auto-applicare o proporre con
  conferma nel triage (raccomandata: proposta nel triage con conferma one-tap,
  coerente col pattern review).

Tocca `evening-review/triage.ts`/`plan-preview.ts` (non protetti) e forse
`prompts.ts` (PROTETTO) → dichiarare. Effort M.

### D — OPZIONALE · VALID_MODES ristretti (D75, quick-fix consigliato dal collaudo)

`/api/chat/turn` accetta ancora i modi latenti `planning`/`focus_companion`/
`unblock` (quest'ultimo con prompt VUOTO) con tool sensibili esposti. Il collaudo
lo marcava "FIX consigliato, effort S". Verificare in esplorazione se i task
63-66 l'abbiano già chiuso (grep `VALID_MODES`); se no: restringere ai 3 modi
usati (chat generale, morning_checkin, evening_review). Se il fix vive in
`orchestrator.ts` → è già dichiarato tra i protetti del piano.

### Fuori scope (restano ad Antonio / v3)
Push+merge dello stack 61→67 e deploy (verificare `[migrate-on-deploy]` nel build
log: c'è la migration `user_password_changed_at` del 66); env: `CRON_SECRET` in
`.env.local` e Vercel, dominio Resend verificato + `EVENING_EMAIL_FROM`,
`BETA_TESTERS`; riconciliazione consenso C1/C2 (versione `0.2-draft` a runtime —
BLOCCATA sui testi legali definitivi di Antonio); checklist on-device APK
(report 62 §11); i18n runtime (W4), nativo (v3), web push (v3 W5).

---

## 2. Ordine suggerito e verifica

1. **Esplorazione** (stato share-target post-65 OBBLIGATORIO, loop plan_preview
   nell'orchestrator com'è oggi, percorso `decompose_then_do` end-to-end, grep
   VALID_MODES) → domande di prodotto → piano in plan mode **con l'elenco dei
   protetti toccati**.
2. **D** (se ancora aperto) — piccolo e isolato, un commit.
3. **A (D21)** — share target, un commit.
4. **B (§6.11)** — chiusura plan_preview, il pezzo più delicato (orchestrator).
5. **C (§6.12)** — auto-decomposizione.

Verifica per step: `bun run build` (dev server FERMO) + `bunx tsc --noEmit` +
`bun run test` (919 attesi verdi al netto dei nuovi); probe e2e in
`scripts/e2e/task67/` (riusare le lib 63-66): A share con sessione valida →
salvato/precompilato davvero (o manifest senza share_target se si rimuove); A con
sessione scaduta → nessun "salvato" mentito, testo non perso; B review simulata
con sole conferme testuali → commit/quickReply entro N giri, review 0-candidate
chiudibile; C task `decompose_then_do` → step proposti al triage senza richiesta
manuale. Browser (preview MCP, SW pulito): flusso share simulato via URL, review
serale vera con LLM (utente seminato con finestra aperta — occhio: la finestra
serale si apre via `Settings.eveningWindowStart/End`, pattern probe-c1 del 66).
Report finale: file toccati (protetti evidenziati), esiti probe, comandi di test
manuale, costi LLM se B/C aggiungono chiamate.

Domande di prodotto da fare PRIMA del piano (AskUserQuestion, non inventare):
- A/D21: implementare lo share reale vs rimuovere share_target dalla beta.
- B/§6.11: soglia N e auto-commit vs quickReply.
- C/§6.12: quando generare gli step e auto-applicare vs proporre con conferma.
- D: solo se risulta ancora aperto (fix S, si può includere d'ufficio nel piano).

---

## 3. Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`)

```
Leggi docs/tasks/67-post-lancio-residui-finali.md ed eseguila col workflow v2:
parti dal branch feature/66-residui (o da main se lo stack 61-66 è già stato
mergiato — verifica con git log), crea feature/67-residui-finali, esplora i punti
indicati (stato share-target post-65 obbligatorio, loop plan_preview
dell'orchestrator, percorso decompose_then_do, grep VALID_MODES), fai le domande
di prodotto previste dalla spec, poi proponi il piano in plan mode dichiarando
esplicitamente i file protetti che B/C toccano (orchestrator.ts, prompts.ts,
update-plan-preview-handler.ts se serve). Dopo l'approvazione implementa
end-to-end con self-verification (build, tsc, test, probe e2e in
scripts/e2e/task67/ riusando le lib di task63/64/65/66, verifica browser via
preview MCP con SW pulito, e per B/C almeno una verifica del flusso review con
LLM reale) e commit checkpoint. Solo dev locale contro il DB dev royal-feather
(preflight host). Utenti collaudo-* (pwd Collaudo62!pass) o effimeri task67-*.
Al termine: report con file toccati (protetti evidenziati), esiti probe, comandi
di test manuale e costi LLM.
```

Nota per Antonio: chiudere la sessione del Task 66 (o non usarla sul repo) mentre
gira la 67 — index git condiviso. Il dev server del preview è fermo: la 67 lo
riavvia con `preview_start shadow-dev`. Se aggiungi `CRON_SECRET` a `.env.local`
prima della 67, la probe-c1 del 66 diventa lanciabile senza rituale.
