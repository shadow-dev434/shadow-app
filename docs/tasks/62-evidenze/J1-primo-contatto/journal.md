# J1 — Primo contatto (il minuto zero) — journal UI [seriale]

Eseguito: 2026-07-03 00:35-01:10 (ora Roma), browser preview pulito (SW+cache+cookie rimossi),
utente: collaudo-vergine@probe.local registrato per davvero dal form.

## Esiti passo-passo

| # | Passo | Esito | Note |
|---|-------|-------|------|
| 1 | Landing `/` da anonimo | PASS | Titolo+tagline+2 CTA. Tagline "il tuo executive function esterno" (D53: genere/anglismo). L6 ok. |
| 2 | `/?auth=error` | **FAIL (D65 confermato)** | Nessun messaggio: la query è ignorata in silenzio, pagina identica. |
| 3 | Form Registrati, password 7 char ("Sette77") | **D28 confermato** | Placeholder promette "Almeno 6 caratteri", il client lascia passare, il server rifiuta "La password deve essere di almeno 8 caratteri". Errore in italiano, form preservato (L4 ok), ma promessa 6 vs realtà 8 (L7). |
| 4 | Register valido → auto-login → /tour | PASS | Redirect corretto dal middleware. |
| 5 | Tour 6 step | PASS (contenuti sotto) | "Salta" presente a step 1 (skip non esercitato qui). **Il tour non nomina MAI la chat**, che è l'ingresso promesso dal core loop: insegna Inbox→classifica→focus→strict→review (L7/L9). |
| 6 | Consenso | PASS con finding | Testi it chiari, doppio checkbox art.9, bottone disabilitato finché non spunti (nessuna spiegazione del perché — L2 minore). **"Informativa di consenso — bozza 0.2-draft" visibile in fondo (D53 confermato)**. Il testo promette revoca "dalle impostazioni" (da riscontrare in Settings). |
| 7 | Onboarding 12 domande | PASS | Domande: età (slider), situazione, cosa studi (testo, skippabile), dove vivi, casa autonoma, fonti carico (multi), aree blocco (multi), motivazioni (tap 1-2 volte), quando produttivo, sessioni, difficoltà iniziare (slider), stile Shadow. |
| 8 | Abbandono a metà (reload a 7/12) | **PASS (L4)** | Resume esatto a 7/12, risposte persistite server-side. |
| 9 | "Crea il mio profilo" → riepilogo | PASS con nota | "Sei pronto!" con 6 righe di profilo. **"Focus mode: Strict (uscita difficile)"** derivato senza che alcuna domanda lo chiedesse (sorpresa; incoerente con default 'soft' del profilo schema). |
| 10 | Atterraggio → `/` chat | PASS | Empty state buono: invito a scrivere + 5 chip + toast benvenuto. Momento "e adesso?" coperto (L2/L6). |
| 11 | Morning check-in | SKIP | Ora Roma <5 (collaudo notturno): trigger non esercitabile su questo utente. Meccanica coperta da J2 (probe strict-proactive già PASS in Fase 0). |
| 12 | Cattura 1 ("assicurazione entro martedì") | PASS | Task creato SUBITO senza domande bloccanti, deadline martedì 7/7 corretta, card "Task creato/admin - urgenza 4" ("admin" enum grezza, D50). Risposta ~15-25s con soli puntini (D38). |
| 13 | Cattura 2 (multipla: presentazione lunedì + chiamare madre) | **FINDING date** | Shadow chiede conferma proponendo "**lunedì 7 luglio (domani)**": il 7/7/2026 è MARTEDÌ (lo aveva appena detto lei), e "domani" era venerdì 3. Percorso ingenuo (tap "Sì, lunedì 7") → **DB: deadline 2026-07-07 (martedì)** mentre l'utente intendeva lunedì 6. Cattura post-mezzanotte = date ballerine. Ripetuto pattern: 2 task creati, dedup assicurazione OK ("Già in lista"). |
| 14 | Riparazione conversazionale | PASS | "lunedì è il 6, sposta al 6" → update_task, DB deadline 2026-07-06. |
| 15 | Ricorrente da guida ("spesa ogni venerdì") | PASS con 2 note | 1 domanda di conferma (carta 3 onboarding promette zero: "Fatto."). Template weekly[5] OK, MA **istanza materializzata per OGGI (giovedì 2/7)** con occurrenceDate=2026-07-02: il ricorrente "solo venerdì" compare subito in inbox oggi. |
| 16 | Guida step 4 "premi Fallo con Shadow" | **FAIL (L7)** | Da inbox NON esiste percorso visibile al dettaglio task: le righe hanno solo "Classifica" + cestino; il click sulla riga non apre nulla. Un utente nuovo che segue la guida non trova "Fallo con Shadow" (i task nuovi non sono in Today finché non c'è un piano). |
| 17 | Icona cestino riga inbox | **S1 candidato (riprodotto 2×)** | Tap su icona trash-2 SENZA aria-label/title, adiacente a "Classifica" → **DELETE immediato dal DB** (findFirst→null), zero conferma, zero undo; toast "Task eliminato" compare dopo ~2s e dura <1s. Perso "Finire presentazione" (urgenza 5 con deadline) con un tap. |
| 18 | Bottone "Voce" inbox | WARN | Tap → nessun feedback osservabile (né UI né console) nel browser di collaudo. Smoke on-device per Antonio (web speech). |

## Contenuti del tour (per l'inventario L7/L9)
1. Inbox — Cattura rapida (esempio dichiarazione redditi)
2. Prioritizzazione automatica
3. AI spezza i compiti
4. Focus / Execution Session
5. Strict Mode — Modalità rigida (spiega la friction: frase+15s+3 conferme)
6. Review e memoria
→ Chat, Cielo, ricorrenti, review CONVERSAZIONALE: assenti dal tour. Il tour descrive
l'app pre-conversazionale (review "racconti tre cose e salvi" = tab manuale, non la chat).

## Misure L1/L8 (tap-budget J1)
- Register→chat operativa: 6 step tour (6 tap) + consenso (3 tap) + 12 domande (~15 interazioni) + 1 tap finale. Tempo totale ~7-8 min di cui ~25s attesa "Crea il mio profilo".
- Cattura singola in chat: typing + 1 tap (Invia) + 0 domande bloccanti = **1 interazione oltre il testo** ✅ target ≤2.
- Cattura multipla: +1 tap (QR di conferma data) — ragionevole, ma la data proposta era sbagliata.
- Ricorrente: typing + 1 tap Invia + 1 tap QR conferma = 2.

## uxNotes / semi automazioni (L3)
- L3-AUTOMAZIONE: i task creati in chat (già classificati con categoria+urgenza) mostrano comunque "Classifica" in inbox: la conferma di classificazione potrebbe essere auto sopra confidenza X (D62/D64).
- L3-AUTOMAZIONE: "(night)" e "Confidenza: 30%" nell'insight della Today: enum EN grezze + percentuale tecnica esposta all'utente (D34/D50).
- Today per utente nuovo: "Pianifica con Shadow" E "Rigenera piano ora" affiancati (D44): due generatori senza spiegazione della differenza.
- Attesa LLM: 15-30s con soli 3 puntini (D38) — a notte fonda percepita lunga.
- Chat→lista: icona "Apri lista" (header) non etichettata visivamente; ritorno = "Torna alla chat". Navigazione a 2 superfici poco spiegata.
