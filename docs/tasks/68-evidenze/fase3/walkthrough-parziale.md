# Walkthrough L6 — schermate (browser, 2026-07-04) — parte browser-seriale

Catturato via DOM (screenshot congelati in tab nascosta, §2.10). Utenti: vergine (J1),
strict (J8), body (J11), tipo (walkthrough surfaces).

## Schermate coperte e verdetto 10-secondi
- **Welcome** (`/`): chiaro. Tagline "il tuo executive function esterno" = gergo EN (L7/L9).
- **Register/Login**: form a 3 campi. D28: placeholder "Almeno 6 caratteri" ma il server
  esige 8 (contraddizione). Auto-login post-register (buon L1).
- **Tour** (6 step): chiaro; "Salta" solo allo step 1 (N41); titoli step 4-5 in EN (L9).
- **Consent**: 2 switch distinti (terms + art9) → bottone si sblocca. Footer "bozza
  0.2-draft" visibile (N45/D53). ChatView spamma 403 pre-consenso in console (L10 rumore).
- **Onboarding** (12 domande): chiaro; tutte obbligatorie; resume server-side (L4 ok);
  recap finale "Focus mode: Strict" mai scelto esplicitamente (N48).
- **Chat vuota** (post-onboarding): toast "Inizia aggiungendo un task" (N47) sovrapposto e
  persistente (L10); 3 domande intake prima di valore (L8).
- **Chat con cattura**: card "Task creato" con categoria enum EN raw "personal"/"admin" (N38).
- **Inbox**: header "Inbox (N)"; task iniziato mostra "completato 1/3 step · Riprendi"
  (badge X/Y step, Task 56 ok). Task non classificati mostrano bottone "Classifica" senza
  spiegare perché l'AI non l'ha fatto (N35). Categoria "Generale" localizzata (fallback ok).
- **Today**: "IL TUO CONTESTO ORA" + "LE 3 COSE DI OGGI" con "Fai ora"/"Inizia" (due label,
  L9); "Pianifica con Shadow" vs "Rigenera piano ora" con legenda esplicativa (buon L6).
  Empty-state "Nessun piano… Costruiamone uno insieme" (N36).
- **Focus tab**: senza task = "Nessun task selezionato" + solo "Vai a Today" (D51 vicolo cieco).
- **/focus body doubling**: "BODY DOUBLING", scelta durata, avatar 3D (texture fallita in
  console), companion LLM, "In pausa — il timer continua" (N43). Vedi J11.
- **Cielo** (`?view=sky`): "La Lucciola", empty-state con CTA "✦ Creane uno in chat"
  (deep-link presente, a differenza della card Ricorrenti — N49). Chiaro.
- **Impostazioni**: sezioni Account / Profilo Esecutivo / Strict Mode / Giornata / Ricorrenti.
  Finding sotto.

## Finding da Settings (utente loggato = collaudo68-tipo)
- **D-auth CONFERMATA (evidenza dura)**: cookie di sessione = `collaudo68-tipo` (l'inbox e
  /api/profile restituiscono i dati di tipo), MA il pannello **Account** mostra "Vergine
  Collaudo / collaudo68-vergine@probe.local". `localStorage['shadow-user']` conteneva ancora
  `{name:"Vergine Collaudo", email:"collaudo68-vergine@probe.local"}` da J1: il signout NON
  pulisce localStorage e il pannello Account legge da lì. → l'app può mostrare un'identità
  DIVERSA da quella realmente loggata. Repro via login API (che salta l'update client di
  localStorage); l'ampiezza in flusso puro-UI va confermata (Fase 5), ma la radice
  "signout non pulisce shadow-user" è certa. Impatto fiducia/sicurezza-percepita.
- **N38 CONFERMATA (role)**: "Ruolo: worker" — enum EN raw rivolto all'utente. "Modalità
  focus: Soft" (localizzato ok).
- **N34 CONFERMATA**: sezione "Giornata e promemoria" con bottone **"Salva"** manuale
  (niente autosave, pattern già usato altrove).
- **N49 CONFERMATA**: card "Ricorrenti" → "Si creano e si modificano in chat" + "Chiedi in
  chat, ad esempio: 'Meditazione ogni giorno'" — nessun deep-link `/?draft=` (il Cielo ce
  l'ha). Copy suggerisce un'azione ma non la rende cliccabile.
- Copy consenso in Settings: "finche' non lo riconcedi" (apostrofo al posto di accentata —
  N46, testo minore).

## Ancora da fare (walkthrough)
schermata login isolata, chat con review card, task detail, admin/beta (via gate).
Le prime tre le copre l'orchestratore; admin/beta le tocca J10 (workflow) + verifica statica.
