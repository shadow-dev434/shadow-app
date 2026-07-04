# J1 — Primo contatto (browser reale, collaudo68-vergine) — 2026-07-04

Percorso: welcome → register → tour 6 step → consent → onboarding 12 domande → chat →
morning check-in → cattura 3 task. Esito complessivo: il flusso FUNZIONA end-to-end
senza vicoli ciechi; i finding sono di fiducia/attrito, non di rottura.

## Esiti passo per passo
1. Welcome: tagline "il tuo executive function esterno" (gergo EN — L7/L9, vivo).
2. Register: **D28 CONFERMATA e AGGRAVATA** — placeholder "Almeno 6 caratteri", il server
   rifiuta con "La password deve essere di almeno 8 caratteri" (contraddizione nello stesso
   form). Errore almeno chiaro e in italiano. Con password valida: register → sessione →
   /tour automatici (zero login separato, buon L1).
3. Tour: 6 step ("Inbox — Cattura rapida", "Prioritizzazione automatica", "AI spezza i
   compiti", "Focus / Execution Session", "Strict Mode — Modalità rigida", "Review e
   memoria"). **N41 CONFERMATA**: "Salta" esiste SOLO allo step 1; dal 2/6 in poi si è
   obbligati a completare (o tornare indietro). Titoli step 4-5 in inglese (L9).
   Step 6 promette "Più lo usi, più si adatta" + esempio pattern venerdì/lunedì
   (da incrociare con N7/§8.7). Transizione "Inizia"→consent ~3s senza feedback.
4. Consent: **N45/D53 CONFERMATA** — footer utente "Informativa di consenso — bozza
   0.2-draft" + consentVersion in DB '0.2-draft'. Struttura consensi CORRETTA: 2 switch
   distinti (consent-terms, consent-art9) che sbloccano il bottone (finding "un solo
   consenso" RITIRATO dopo verifica). Nota a11y: switch senza aria-label (label associata
   via for/id, ok di base). "Esci senza accettare" presente (L2 ok).
   In console: ChatView polla active-thread/bootstrap PRIMA del consenso → 6+ warn 403
   ripetuti (rumore client, spreco rete).
5. Onboarding: 12 domande TUTTE obbligatorie (Avanti disabled senza risposta; slider
   passano col default: età rimasta 25 senza tocco — i default contano come risposte).
   **Resume server-side PASS (L4)**: reload alla domanda 6 → riprende dalla 6.
   Q8 "tappa 1=medio, 2=tanto": meccanica spiegata in una riga, ok ma inusuale.
6. **N48/D-res1 CONFERMATA (anche in DB)**: scelta stile "Diretto e conciso" (copy solo
   comunicativo) → recap finale "Focus mode: Strict (uscita difficile)" e
   profile.focusModeDefault='strict'. Dichiarato nel recap ma MAI scelto né spiegato lì,
   nessun toggle per cambiarlo in loco.
7. Atterraggio chat: toast "Benvenuto in Shadow! … Inizia aggiungendo un task" (N47:
   spinge alla vista task in un'app chat-first) SOVRAPPOSTO al primo messaggio del
   check-in (L10) e ancora visibile dopo >3 minuti.
8. Morning check-in per utente NUOVO con 0 task: **3 domande obbligate in fila**
   (umore 1-5, energia 1-5, tempo oggi) prima di qualunque valore — chiede "quanto tempo
   hai" per pianificare una lista vuota (L8/L3). Risposta post-QR ~20-25s senza streaming
   (D38 percepita). Poi: "Lista vuota. Vuoi aggiungere qualcosa…" (tono Diretto ok).
9. Cattura tripla in un messaggio: 3 task creati NELLO STESSO turno, card con conferma,
   piano proposto con aritmetica corretta (75/180 min) e "scade oggi" corretto
   (entro sabato = oggi 2026-07-04, deadline in DB 2026-07-04). claim-guard ok qui.
   **N38 CONFERMATA**: card mostrano categoria enum EN raw ("personal", "admin").
10. **D65 CONFERMATA**: /?auth=error → nessun banner, param ignorato in silenzio.

## Metrica §11.10a — tempo-al-primo-valore
~30 interazioni: register 3 campi + 1 click; tour 6 click; consent 2 switch + 1 click;
onboarding ~15 tocchi (12 domande, 2 multi-select); intake chat 3 QR; poi la prima cattura.
Primo VALORE percepito (3 task organizzati + mini-piano): dopo ~30 interazioni e
~2 turni chat (~45s di attese LLM cumulative).

## Note L (per scorecard)
- L1: buono al register (auto-login); pesante prima del primo valore (30 interazioni).
- L2: nessun vicolo cieco trovato in J1; "Esci senza accettare" c'è.
- L4: resume onboarding PASS.
- L6: schermate chiare; titoli tour 4-5 in EN.
- L7: bozza 0.2-draft visibile; promessa adattività da verificare (N7); D28 contraddizione.
- L8: 3 domande intake prima del valore; cattura = 1 messaggio per 3 task (ottimo).
- L10: toast benvenuto sovrapposto al check-in e persistente; ChatView spamma 403 pre-consenso.

## Evidenze
- j1-dbcheck.md (profilo+task+thread in DB), script scripts/e2e/collaudo-68/j1-dbcheck.ts
- Trascrizione integrale del thread: negli esiti sopra (testo DOM); thread morning_checkin
  state=active msgs=10 (dump completo a fine giornata J1 se servisse: il thread resta vivo).
