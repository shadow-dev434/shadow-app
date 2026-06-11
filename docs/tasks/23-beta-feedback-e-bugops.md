# Task 23 — Beta: risposta rapida ai bug, feedback giornaliero, valutazione efficacia

> **Stato:** decisioni di prodotto sciolte da Antonio il 2026-06-11 (registro
> in §7). Piano operativo in approvazione (plan mode); implementazione a valle.
> **Scope:** Beta robusta B (20-100 tester), web Vercel + TWA Play closed testing.
> **Complementare a:** `SHADOW-guida-beta-v1.md` (questo è un nuovo track
> parallelizzabile, da chiudere PRIMA dell'invito ai tester — Checkpoint 4).
> **Convenzione:** 🔵 DECISIONE = punto che richiede scelta esplicita di Antonio.

---

## 0. Obiettivi e principi

Tre deliverable, un unico sistema:

1. **BugOps** — sapere di un bug entro minuti (non quando il tester si stanca
   e disinstalla), triagarlo e shipparlo con un processo ripetibile.
2. **Feedback giornaliero** — un micro-form quotidiano che raccoglie
   impressioni, frizioni, bug e proposte, calibrato su utenti ADHD
   (≤90 secondi, tap-first, zero colpa se saltato).
3. **Valutazione di efficacia** — protocollo pre/post a 14 giorni sui sintomi
   core ADHD con strumenti validati e gratuiti, integrato con le metriche
   oggettive d'uso già presenti nel DB.

Principi di design:

- **ADHD-first**: ogni richiesta di feedback dev'essere completabile in meno
  tempo di quanto serve a decidere se ignorarla. Testo libero sempre opzionale.
- **Segnale, non prova**: 14 giorni, n piccolo, nessun gruppo di controllo →
  il protocollo misura un *segnale* di efficacia e direzione, non un claim
  clinico. Il wording verso i tester deve riflettere questo.
- **Riuso**: pattern UI esistenti (MicroFeedbackDialog, OnboardingView,
  Dialog shadcn), pipeline esistenti (requireSession, export, consenso art. 9).
- **Ogni domanda mappa su una decisione di lancio** (vedi §5). Se una domanda
  non cambia nessuna decisione, non si fa.

---

## 1. Stato attuale rilevante (audit 2026-06-10)

| Capability | Stato | Note |
|---|---|---|
| Error tracking client (crash, unhandled) | ❌ assente | Nessun ErrorBoundary, nessun `window.onerror` |
| Error tracking server | ⚠️ solo `console.error` | Pattern uniforme nelle route, ma nessuno li legge |
| Sentry | ❌ ma **già pianificato** | ROADMAP Task 4 + guida beta Track 2 ("Sentry free tier") |
| Invio push server→utente | ❌ | `PushSubscription` salvata, `sw.js` ha handler push pronto, ma **manca `web-push` + VAPID + cron** |
| Cron / scheduled jobs | ❌ | Nessun `vercel.json` |
| Feedback in-app | ⚠️ parziale | `MicroFeedback` + `LearningSignal` → AdaptiveProfile (serve al learning, non alla beta) |
| Pattern UI riusabili | ✅ | MicroFeedbackDialog (card bottom, `tasks/page.tsx:1656`), Dialog shadcn, OnboardingView multi-step, ProactiveChatbotPopup (floating) |
| Consenso GDPR art. 9 | ✅ | `UserProfile.consentArt9`, versione "0.2-draft", gate in middleware |
| Export dati / cancellazione account | ✅ | `api/export` JSON+CSV; i nuovi modelli andranno aggiunti |
| Ruoli admin | ❌ | Nessun RBAC; serve allowlist email via env |
| Versione app esposta al client | ❌ | Solo `package.json` 0.2.0 + cache SW v2/v3, nulla arriva al client |
| Hotfix delivery | ✅ strutturale | TWA = wrapper della web app → deploy Vercel arriva **istantaneamente** anche su Android, niente review Play |
| Metriche oggettive d'uso | ✅ già nel DB | Task, Streak, StrictModeSession, DailyPlan, ChatThread, LearningSignal |

---

## 2. Parte A — BugOps: intervenire subito

### A1. Telemetria automatica degli errori

**Scelta consigliata: Sentry free tier** (`@sentry/nextjs`) — è già nella
roadmap (Task 4) quindi la dipendenza è documentata e sanzionata.

Cosa copre out-of-the-box:
- Errori client non gestiti (crash React, promise rejection) con stack trace
- Errori server (route API) senza toccare i `try/catch` esistenti
- Grouping automatico (stesso bug segnalato 30 volte = 1 issue)
- **Alert email immediato** su issue nuova → "intervenire subito" gratis
- Release tagging: si lega la versione app a ogni errore

Configurazione minima per la beta:
- `beforeSend` che **scrubba** ogni contenuto utente (messaggi chat, titoli
  task) — verso Sentry vanno solo stack, route, userId pseudonimo, versione.
  Punto privacy obbligatorio vista la natura art. 9 dei dati.
- `tracesSampleRate: 0` (solo errori, niente performance) per restare nel free tier.
- DSN in env (`NEXT_PUBLIC_SENTRY_DSN`), spento in dev.

✅ **DECISO (2026-06-11): Sentry free tier.** Il fallback in-house decade
(niente modello `ClientError`); resta comunque l'ErrorBoundary qui sotto.

In entrambi i casi si aggiunge comunque un **ErrorBoundary React** con
schermata di recovery in italiano ("Qualcosa è andato storto — ricarica") +
bottone "Segnala" che apre il form di A2 precompilato. Un crash silenzioso
per un utente ADHD = app chiusa e mai più riaperta.

### A2. Segnalazione manuale: bug report in-app

Bottone flottante discreto (icona 🐞 o "?") visibile in tutte le viste,
z-index sotto i dialog esistenti. Apre un Dialog (pattern
`PriorityConfirmDialog`) con il form più corto possibile:

| Campo | Tipo | Obbligatorio |
|---|---|---|
| **Dove?** | chips, precompilato con la vista corrente (Chat, Review serale, Inbox/Task, Piano di oggi, Focus/Strict, Notifiche, Onboarding, Login/Account, Impostazioni, Altro) | sì (1 tap) |
| **Cosa è successo?** | textarea breve, placeholder: *"Es. ho premuto Completa e il task è rimasto lì"* | sì |
| **Cosa ti aspettavi?** | textarea breve | no |
| **Quanto ti blocca?** | 3 chips: 🛑 *Mi impedisce di usare l'app* / 😤 *Fastidioso ma vado avanti* / 🎨 *Dettaglio estetico* | sì (1 tap) |
| **Succede sempre?** | 3 chips: *Ogni volta* / *A volte* / *Successo una volta* | sì (1 tap) |

**Contesto auto-allegato** (invisibile all'utente, mostrato come nota "alleghiamo
automaticamente info tecniche sulla schermata"): `currentView` e
`selectedTaskId` da Zustand, route, user agent, viewport, online/offline,
`display-mode: standalone` (distingue TWA da browser), versione app (vedi A5),
timestamp, ultimi ~10 breadcrumb (ring buffer client di: cambi vista, errori
fetch, azioni chiave — da implementare, ~30 righe).

Endpoint: `POST /api/beta/bug-report` → modello `BugReport` (schema in §6).
Niente screenshot in v1 (storage + privacy complicano); il canale umano (A6)
copre i casi dove serve un'immagine.

**Loop di chiusura col tester** — il pezzo che mantiene viva la beta:
- Nel dialog, tab "Le mie segnalazioni" con stato: *Ricevuta → In lavorazione
  → Risolta* (lettura da `GET /api/beta/bug-report`).
- Quando una segnalazione passa a Risolta, toast alla prossima apertura:
  *"Il problema che hai segnalato è stato risolto — grazie!"*. Un tester che
  vede i suoi bug morire segnala di più.

### A3. Alerting immediato ad Antonio

| Evento | Canale | Latenza |
|---|---|---|
| BugReport con severità "Mi impedisce di usare l'app" | **Email immediata** (Resend via REST `fetch`, zero dipendenze npm; env `RESEND_API_KEY`, `BETA_ALERT_EMAIL_TO`, `BETA_ALERT_EMAIL_FROM`) | secondi-minuti |
| Errore nuovo (client o server) | Email/alert Sentry (built-in) | minuti |
| BugReport non bloccante, pulse giornaliero con utilità ≤2 | Niente alert: si vedono nella **triage giornaliera** (A4) | <24h |

L'email include: severità, area, descrizione, userId abbreviato, versione
app, link diretto alla pagina admin. Implementazione: ~30 righe in
`lib/beta/alert.ts` che chiama `POST https://api.resend.com/emails` via
`fetch` (niente SDK, coerente con la regola "REST via fetch, zero SDK
vendor"), fire-and-forget (mai bloccare la risposta all'utente se l'invio
fallisce; in quel caso `console.error`, il record resta comunque in admin).

✅ **DECISO (2026-06-11): email, non Telegram.** Scelta tecnica annotata
(decisione minore): provider **Resend** via REST — zero dipendenze npm, free
tier 100 email/giorno; in modalità sandbox (`onboarding@resend.dev`) consegna
solo all'email del titolare dell'account, che è esattamente il nostro caso
d'uso (alert ad Antonio). Setup richiesto: account Resend + API key. Se
preferisci altro provider/SMTP, l'implementazione resta una singola `fetch`
da sostituire.

### A4. Pagina admin `/admin/beta`

Gate: `session.email ∈ ADMIN_EMAILS` (env, comma-separated) — check sia nel
layout della pagina sia nelle route API admin. Niente RBAC nello schema.

Contenuto (v1 minimale, shadcn Table + recharts già disponibili):
- **Segnalazioni**: lista BugReport filtrabile per stato/severità; azioni:
  assegna priorità P0-P3, cambia stato, nota interna.
- **Pulse**: media giornaliera di utilità e dei 3 item sintomi, trend per
  settimana; lista risposte testuali (frizioni, suggerimenti) più recenti.
- **Questionari**: chi ha completato pre/post, punteggi e delta.
- **Engagement**: tester attivi oggi / ultimi 7 giorni (da `LearningSignal`
  o `ChatThread` — già nel DB, zero strumentazione nuova).

### A5. Versionamento e processo di hotfix

**Versione visibile**: esporre `NEXT_PUBLIC_APP_VERSION` (sincronizzata con
`package.json` nel build) + mostrarla in Impostazioni e allegarla a ogni
report/errore. Senza questo, "da quale versione arriva il bug?" è
irrisolvibile.

**Runbook hotfix** (da affiggere, letteralmente):

1. Alert ricevuto → riprodurre. Se non riproducibile: guardare contesto
   auto-allegato + breadcrumb; se ancora no → chiedere nel canale tester.
2. Classificare: **P0** (blocco totale, perdita dati, login rotto, crash al
   lancio) / **P1** (feature core rotta, esiste workaround) / **P2**
   (fastidio minore) / **P3** (estetica, idea).
3. SLA: P0 → fix entro 24h; P1 → 72h; P2 → batch settimanale; P3 → backlog.
4. P0/P1 → issue GitHub etichettata `beta` + priorità, anche per i fix di
   10 minuti (la storia dei bug della beta è oro per il post-mortem).
5. Fix su `main` → `bun run build` verde → commit → push (con OK) → Vercel
   deploya in ~2'. **La TWA riceve il fix subito** (è web). Rollback: Vercel
   "Instant Rollback" al deployment precedente, 1 click.
6. Se si tocca `public/sw.js`: bump della versione cache, sempre (lezione
   Task 3.5).
7. Chiudere il loop: stato → Risolta (toast al tester) + messaggio nel
   canale beta se il bug era diffuso.
8. **Rituale fisso: 15 minuti ogni mattina** sulla pagina admin: nuovi
   errori, nuove segnalazioni, pulse con utilità ≤2 di ieri. È il battito
   della beta; saltarlo due giorni = beta che muore in silenzio.

### A6. Canale umano diretto

Gruppo **Telegram dei beta tester** (o WhatsApp): zero codice, è dove i bug
"non riesco a entrare" arrivano comunque (se l'app non parte, il form in-app
non esiste). Messaggio pinnato: come segnalare bene un bug (cosa facevi,
cosa è successo, screenshot benvenuto). Il form in-app struttura il flusso
normale; il gruppo è la valvola di sfogo e il termometro del sentiment.

---

## 3. Parte B — Form feedback giornaliero

### B1. Trigger e UX

- **Quando**: alla prima apertura dell'app nella finestra serale dell'utente
  (`Settings.eveningWindowStart/End` esiste già), oppure al termine della
  review serale conversazionale se l'utente la fa. Mai più di una volta al
  giorno (chiave `userId+date`, con `clientDate` come fa già la chat — evita
  il bug timezone UTC noto).
- **Come**: card compatta non bloccante in fondo alla ChatView — *"Com'è
  andata oggi? · 60 secondi"* — che espande il flow a step (pattern
  MicroFeedbackDialog). **Non** un modal che interrompe: la review serale
  conversazionale è il cuore del prodotto in test, non va inquinata.
- **Se saltato**: nessun recupero, nessun sollecito aggressivo, nessun
  messaggio di colpa. Il giorno mancante è esso stesso un dato di engagement.
- **Push reminder**: NON in v1 (manca l'infra web-push). Da valutare come
  enhancement quando/se si costruisce l'invio push (serve comunque al
  prodotto per i nudge). ✅ **DECISO (2026-06-11):** si parte senza push reminder.

### B2. Le domande — pulse giornaliero (60-90 sec)

Tutte le scale a 5 punti sono tap singoli (5 bottoni), wording italiano:

**Blocco sintomi** (time-series di efficacia, sempre per primi):
1. *"Oggi quanto sei riuscito/a a concentrarti su quello che dovevi fare?"*
   — 1 Per niente · 5 Benissimo
2. *"Quanto hai sentito di avere il controllo della tua giornata?"*
   — 1 Per niente · 5 Totale
3. *"Quanto hai rimandato cose che volevi fare?"*
   — 1 Per niente · 5 Tantissimo *(item invertito in scoring)*

**Blocco app:**
4. *"Shadow oggi ti è stato utile?"* — 1 Per niente · 5 Moltissimo
5. *"In cosa ti ha aiutato di più?"* — chips multi-tap: Chat/check-in ·
   Piano del giorno · Decomposizione di un task · Focus/Strict mode ·
   Review serale · Promemoria · Oggi non l'ho quasi usata
6. *"Hai trovato problemi o malfunzionamenti oggi?"* — No / Sì →
   apre il bug report di A2 precompilato / *"L'ho già segnalato"*
7. *"C'è stato un momento in cui l'app ti ha confuso o rallentato?"* —
   No / Sì → *"Dove? Racconta in una riga"* (testo breve)
8. *(opzionale, ultima)* *"Se potessi cambiare una cosa di Shadow entro
   domattina, quale sarebbe?"* (testo libero)

Tap obbligatori: 6. Tempo stimato: 45-75 secondi. Storage: `BetaFeedback`
`kind='daily_pulse'`, risposte JSON versionate (`version: 'v1'` — se si
cambia una domanda a metà beta, si sa quale wording ha visto chi).

**Razionale delle domande**: 1-3 sono l'outcome di efficacia più sensibile
del protocollo (media settimana 1 vs settimana 2, vedi §4); 4-5 misurano il
valore percepito e quale feature lo genera (decisione: cosa tagliare/puntare
al lancio); 6 è la rete di cattura bug a costo zero; 7 cattura le frizioni
UX che non sono "bug" e che nessuno segnala spontaneamente; 8 è la miniera
di proposte, opzionale per non pesare.

### B3. Check settimanale (giorno 7, ~3-4 min)

Stesso meccanismo, `kind='weekly'`, una volta sola:

1. Per ogni feature core (Chat mattina, Review serale, Piano del giorno,
   Decomposizione, Focus/Strict, Inbox): *"L'hai usata questa settimana?"*
   → se sì: utilità 1-5; se no: *"Perché?"* — chips: Non sapevo esistesse ·
   Non ho capito come funziona · Non mi serve · Non funzionava
   *(la distinzione discoverability/comprensione/valore/bug è la singola
   informazione più actionable per il lancio)*
2. *"Cosa ti manca di più che Shadow non fa?"* (testo breve)
3. *"Consiglieresti Shadow a un altro adulto con ADHD?"* — 0-10 + *"Perché?"*
4. *"Quanto ti fidi delle proposte di Shadow (priorità, piano)?"* — 1-5
   *(misura la fiducia nel priority engine, core del prodotto)*
5. *"C'è qualcosa che l'onboarding ti aveva fatto capire male o non
   spiegato?"* (testo breve, opzionale)

### B4. Chiusura (giorno 14, ~10-12 min, insieme ai questionari post)

`kind='final'`, somministrato nella stessa sessione dei questionari §4:

1. **SUS** — System Usability Scale, 10 item, scala 1-5 (versione italiana
   validata). Score 0-100 → benchmark di usabilità per il go/no-go (§5).
2. **PGIC** — *"Rispetto a quando hai iniziato a usare Shadow, come
   descriveresti il cambiamento nella gestione delle tue giornate?"* —
   7 opzioni: Moltissimo migliorato · Molto migliorato · Un po' migliorato ·
   Nessun cambiamento · Un po' peggiorato · Molto peggiorato ·
   Moltissimo peggiorato
3. *"Continuerai a usare Shadow dopo la beta?"* — Sì / Probabilmente / No —
   + *"Cosa ti farebbe dire di sì senza esitazione?"*
4. *"Le 3 cose da sistemare assolutamente prima del lancio pubblico?"*
   (3 campi brevi)
5. *(opzionale)* *"Una frase sulla tua esperienza che potremmo citare?"*
   (testimonial, con checkbox di consenso esplicito all'uso)
6. Controllo confondenti: *"Nelle ultime 2 settimane hai iniziato, sospeso o
   cambiato dose di farmaci (per ADHD o altro) o iniziato una psicoterapia?"*
   — No / Sì → quale cambiamento

---

## 4. Parte C — Protocollo di efficacia a 14 giorni

### C1. Disegno

Within-subject pre/post: **T0** (arruolamento, dopo onboarding) → 14 giorni
d'uso → **T1** (giorno 14). Nessun gruppo di controllo → si dichiara
apertamente che misura un segnale. Tre livelli di outcome, dal più al meno
sensibile:

1. **Daily pulse** (item 1-3 di §B2): media settimana 2 − media settimana 1.
   Con ~10-14 punti per persona è molto più potente di un singolo pre/post.
2. **Questionari pre/post** (sotto): Δ T1−T0.
3. **Metriche oggettive dal DB** (zero strumentazione nuova): task
   completati/pianificati, ratio completamento del DailyPlan, streak,
   sessioni strict mode portate a termine, giorni attivi. Usate sia come
   outcome comportamentale sia come **moderatore dose-risposta** (chi usa di
   più migliora di più?).

### C2. Strumenti scelti

| Strumento | Cosa misura | Item | Quando | Licenza |
|---|---|---|---|---|
| **ASRS-v1.1** (WHO) | Sintomi core ADHD DSM (disattenzione + iperattività/impulsività) | 18, scala 0-4 | T0 + T1 | **Gratuito**, traduzione italiana ufficiale esistente |
| **ADEXI** | Funzioni esecutive (memoria di lavoro + inibizione) — il *meccanismo* su cui Shadow agisce | 14, scala 1-5 | T0 + T1 | **Gratuito** (adexi.se) — ⚠️ verificare disponibilità traduzione italiana ufficiale |
| **PGIC** | Impressione globale di cambiamento | 1 | solo T1 | libero |
| **SUS** | Usabilità (non efficacia) | 10 | solo T1 | libero, versione italiana validata |

**ASRS-v1.1 è lo strumento primario** richiesto dal task ("sintomi core"):
self-report, standard de facto negli studi su adulti, 5 minuti.
- **Scoring severità**: somma 0-72 (Mai=0 … Molto spesso=4) + due
  sottoscale (disattenzione item dispari…, iperattività/impulsività) — per il
  pre/post si usano totale e sottoscale.
- **Part A screener** (primi 6 item): si calcola a T0 anche il numero di
  item sopra soglia (≥4 = screen positivo) — utile per descrivere il campione
  (quanti tester sopra cut-off), non come outcome.
- ⚠️ **Adattamento dichiarato**: l'istruzione standard chiede "ultimi 6
  mesi"; per il pre/post si usa *"nelle ultime 2 settimane"* a entrambe le
  somministrazioni. È prassi negli studi con follow-up brevi, ma va annotato
  nel protocollo perché devia dallo standard.
- **Wording**: usare la **traduzione italiana ufficiale** dell'ASRS (non
  ri-tradurre). Stesso principio per ADEXI e SUS.

**Perché non altri**: DIVA-5 è un'intervista diagnostica (non outcome);
BAARS-IV e Brown EF/A sono a pagamento; WFIRS-S (70 item) e AAQoL (29,
copyright) troppo onerosi per una beta. Se ADEXI non avesse italiano
ufficiale: ✅ **DECISO (2026-06-11)** — traduzione interna **dichiarata** nel
protocollo (traduzione non validata = limite riportato nell'analisi). Stesso
approccio per ASRS/SUS qualora il wording ufficiale italiano non fosse
integralmente reperibile.

### C3. Covariate e confondenti (raccolti a T0, 1 minuto)

- Diagnosi formale di ADHD: sì (da chi) / in valutazione / autoidentificato
- Terapia farmacologica attuale per ADHD: sì/no + *"dose stabile da almeno
  4 settimane?"*
- Psicoterapia in corso: sì/no
- Età, occupazione (già in `UserProfile` se l'onboarding li raccoglie)
- A T1: item 6 di §B4 (cambi di terapia) → chi cambia terapia nei 14 giorni
  viene flaggato e analizzato separatamente.

### C4. Somministrazione

- **In-app**, pagina multi-step con progress bar (pattern OnboardingView),
  un item per schermata o gruppi da 3, salvataggio incrementale (riprendibile
  — un utente ADHD che deve rifare 18 domande da capo non le rifà).
- **T0**: proposta subito dopo il completamento dell'onboarding ("Prima di
  iniziare: 8 minuti per misurare il tuo punto di partenza"). Bloccante? No —
  ma fortemente incentivata: senza T0 il tester non entra nell'analisi.
- **T1**: trigger quando `today - firstAssessmentDate ≥ 14 giorni` → card
  prioritaria all'apertura + (se mai ci sarà push) reminder. Finestra di
  grazia: accettare T1 fino al giorno 18, annotando il giorno effettivo.
- Storage: `AssessmentResponse` con punteggi per-item (JSON), totale,
  sottoscale, wave pre/post (schema §6).

### C5. Analisi (pre-registrata in questo doc, prima di vedere i dati)

- **Primaria**: Δ ASRS totale T1−T0, test di Wilcoxon per ranghi con segno,
  effect size (r). Ipotesi direzionale: riduzione.
- **Secondarie**: Δ sottoscale ASRS; Δ ADEXI; media pulse item 1-3
  settimana 2 vs 1 (stesso test); PGIC ≥ "un po' migliorato" come % di
  responder.
- **Dose-risposta**: correlazione (Spearman) tra giorni attivi e Δ outcome.
- **Campione analizzato**: completer (T0+T1 entrambi); riportare
  trasparentemente i dropout — il tasso di dropout È un risultato della beta.
- **Esclusioni**: cambio di terapia nei 14 giorni → analisi di sensibilità
  con e senza.
- Con n=20-40 completer si rilevano effetti medi (dz≈0.5) — onesto per un
  segnale; tutto sotto va riportato come direzione, non conclusione.

### C6. Etica e GDPR

- I punteggi ASRS/ADEXI sono **dati art. 9**. Il consenso esistente
  (`consentArt9`) copre "dati relativi alla salute e profilo comportamentale";
  **aggiungere una riga esplicita** alla prossima versione del consenso:
  *"questionari di autovalutazione dei sintomi, usati in forma aggregata per
  valutare e migliorare l'app"*. 🔵 **DECISIONE C6**: far passare la riga
  dalla consulenza legale già prevista nel Track 3.
- Includere i nuovi modelli in `api/export` e nella cascade di cancellazione.
- Disclaimer fisso nelle pagine questionario: *"Questo non è uno strumento
  diagnostico e non sostituisce un percorso clinico."* Shadow non è e non
  dichiara di essere un dispositivo medico; il protocollo è valutazione
  interna di prodotto.
- Punteggi ASRS molto alti NON generano consigli clinici automatici (non
  siamo in grado di gestirli responsabilmente in beta); il gruppo Telegram
  e il rapporto diretto con i tester sono il canale umano.

---

## 5. Parte D — Criteri di lancio (ogni domanda → una decisione)

| Dimensione | Metrica (fonte) | Soglia GO proposta |
|---|---|---|
| Stabilità | P0 aperti (BugReport/Sentry) | 0 negli ultimi 7 giorni |
| Stabilità | Errori nuovi/settimana (Sentry) | trend in discesa, nessun crash al lancio |
| Usabilità | SUS medio (B4) | ≥ 70 (≥ 80 = ottimo) |
| Valore | Utilità giornaliera media, settimana 2 (B2.4) | ≥ 3.5 |
| Valore | Feature core con mediana utilità < 3 (B3.1) | nessuna — o decisione esplicita di tagliarla |
| Retention | Tester attivi al giorno 14 / attivi al giorno 1 | ≥ 50-60% |
| Raccomandazione | % 9-10 su B3.3 | direzionale (n piccolo), leggere i "perché" |
| Efficacia (segnale) | Δ pulse focus+controllo sett.2−sett.1 | > 0 |
| Efficacia (segnale) | PGIC ≥ "un po' migliorato" | ≥ 50% dei completer |
| Backlog | P1 aperti | tutti chiusi o consapevolmente schedulati |

✅ **DECISO (2026-06-11)**: soglie confermate come da tabella, congelate prima
della raccolta dati.

---

## 6. Parte E — Implementazione proposta

### E1. Nuovi modelli Prisma (⚠️ richiede discussione pre-modifica, regola CLAUDE.md)

```prisma
model BugReport {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  area            String                    // chips di A2
  description     String   @db.Text
  expected        String?  @db.Text
  severityUser    String                    // blocking | annoying | cosmetic
  reproducibility String                    // always | sometimes | once
  context         String   @db.Text         // JSON auto-allegato
  appVersion      String?
  status          String   @default("new")  // new | triaged | in_progress | fixed | wont_fix | duplicate
  priority        String?                   // P0 | P1 | P2 | P3 (assegnata in triage)
  adminNotes      String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([userId])
  @@index([status])
}

model BetaFeedback {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      String                 // daily_pulse | weekly | final
  day       String                 // YYYY-MM-DD client-side (timezone-safe)
  version   String                 // versione del questionario (v1)
  answers   String   @db.Text      // JSON
  createdAt DateTime @default(now())
  @@unique([userId, kind, day])
}

model AssessmentResponse {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  instrument     String                // asrs | adexi | sus | pgic
  wave           String                // pre | post
  itemScores     String   @db.Text     // JSON array per-item
  totalScore     Float
  subscales      String?  @db.Text     // JSON {inattention, hyperactivity, ...}
  administeredAt DateTime @default(now())
  @@unique([userId, instrument, wave])
}
```

Tutti e tre entrano in `api/export` e sono in Cascade con User (cancellazione
account già conforme). Il modello `ClientError` decade: A1 risolta con Sentry.

**Nuove variabili d'ambiente** (`.env.local` + Vercel — i file `.env*` sono
protetti: i valori li inserisce Antonio): `NEXT_PUBLIC_SENTRY_DSN`,
`SENTRY_DSN`, `RESEND_API_KEY`, `BETA_ALERT_EMAIL_TO`, `BETA_ALERT_EMAIL_FROM`,
`ADMIN_EMAILS` (comma-separated). Setup esterno richiesto: account Sentry
(progetto Next.js) + account Resend (~10 minuti totali).

### E2. Fasi di lavoro (ognuna chiusa da `bun run build` verde + commit)

| Fase | Contenuto | Stima |
|---|---|---|
| **1. Fondamenta BugOps** | migration 3 modelli; versione app esposta al client; ErrorBoundary; Sentry; breadcrumb ring buffer; `POST/GET /api/beta/bug-report`; BugReportDialog + bottone flottante; alert email (Resend REST) | 2 sessioni |
| **2. Admin** | `/admin/beta` (gate ADMIN_EMAILS): tabella segnalazioni con cambio stato/priorità, vista pulse, engagement | 1 sessione |
| **3. Daily pulse + weekly** | card serale in ChatView, flow a step, `POST /api/beta/feedback`, trigger su finestra serale + `clientDate`, weekly al giorno 7 | 1-2 sessioni |
| **4. Questionari T0/T1** | pagina multi-step riusabile (ASRS/ADEXI/SUS/PGIC come config), scoring, salvataggio incrementale, trigger T0 post-onboarding e T1 a 14gg, vista admin punteggi | 2 sessioni |
| **5. Rifiniture** | toast "risolto", tab "le mie segnalazioni", testi finali, acceptance test end-to-end | 1 sessione |

Totale: ~7-8 sessioni. Le fasi 1-2 sono il minimo per "intervenire subito"
e hanno senso anche da sole; 3-4 vanno chiuse prima dell'invito ai tester.

### E3. Acceptance test (da eseguire a fine implementazione)

1. Errore JS forzato in una vista → ErrorBoundary mostra recovery, l'errore
   appare in Sentry (o ClientError) entro 1 minuto.
2. Bug report con severità "mi blocca" → messaggio Telegram entro 10 secondi,
   record visibile in `/admin/beta`, stato modificabile, toast all'utente
   dopo il passaggio a Risolta.
3. Utente non-admin su `/admin/beta` → redirect/404.
4. Pulse: appare la sera (clientDate), una sola volta al giorno, salvataggio
   `BetaFeedback` corretto, non appare due volte dopo refresh.
5. T0: dopo onboarding → ASRS+ADEXI completi → punteggi e sottoscale
   corretti (fixture con risposte note); riprendibile a metà.
6. T1: account con `firstAssessment` retrodatato di 14gg → card T1 appare;
   delta visibile in admin.
7. `api/export` include i 3 nuovi modelli; cancellazione account li elimina.
8. `bun run build` verde; nessun impatto sul flusso chat esistente.

---

## 7. Registro decisioni

| # | Decisione | Esito (2026-06-11) |
|---|---|---|
| A1 | Sentry vs in-house | ✅ **Sentry free tier** (scrub privacy in `beforeSend`, `tracesSampleRate: 0`) |
| A3 | Canale alert | ✅ **Email** (provider Resend via REST fetch — scelta tecnica minore, annotata) |
| B1 | Push reminder per il pulse | ✅ **No in v1** (trigger all'apertura serale) |
| C2 | ADEXI senza traduzione ufficiale | ✅ **Traduzione interna dichiarata** (limite riportato nel protocollo) |
| C6 | Riga sul consenso per i questionari | ⏳ aperta — passa nella consulenza legale Track 3 (non blocca l'implementazione; blocca l'**invito ai tester**) |
| D | Soglie GO/NO-GO | ✅ **Confermate** come da §5 |
| E1 | Schema Prisma: 3 nuovi modelli | ⏳ conferma puntuale al momento di edit + migration (regola CLAUDE.md: sempre sotto conferma esplicita) |

---

*Documento di pianificazione creato il 2026-06-10. Nessun codice scritto:
implementazione solo dopo OK esplicito, fase per fase, secondo il workflow
di CLAUDE.md.*
