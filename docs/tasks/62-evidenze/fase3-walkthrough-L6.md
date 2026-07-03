# Fase 3 — Walkthrough di comprensione (L6) + inventario lingua (L9/D34/D50)

Schermate esaminate al browser (preview :3000, DB dev). Verdetto "10 secondi": un utente
NUOVO capisce a cosa serve e cosa fare? (SÌ / PARZIALE / NO).

| Schermata | 10s | Note peggiori (testi/label) |
|-----------|-----|------------------------------|
| Welcome `/` | SÌ | Tagline "il tuo executive function esterno" — anglismo + genere sbagliato (D53). |
| Login/Registra | SÌ | Placeholder password "Almeno 6 caratteri" ma il server ne pretende 8 (D28). |
| Tour 6 step | PARZIALE | Insegna Inbox/Prioritizzazione/Focus/Strict/Review ma **non nomina mai la chat**, che è l'ingresso reale. "Strict Mode" e "Execution Session" in EN. |
| Consent | SÌ | Chiaro e serio; ma **"bozza 0.2-draft"** in fondo (D53) e "Ho letto" senza scroll forzato. |
| Onboarding 12 | SÌ | Fluido, resume perfetto. Deriva "Focus mode: Strict" senza chiederlo. |
| Chat vuota | SÌ | Ottimo empty state: invito + 5 chip + toast benvenuto. La schermata più chiara dell'app. |
| Sidebar storico | SÌ | "Una chat al giorno. I giorni passati sono in sola lettura." — chiaro. |
| Inbox | PARZIALE | Task già classificati da chat mostrano comunque "Classifica" (D62). Icona **cestino senza conferma** accanto a "Classifica" (S1). "AI" badge. |
| Today (con piano) | PARZIALE | **"LE 3 COSE DI OGGI" piatta (Top3), niente fasce orarie** (D43): la review promette per fasce, la Today appiattisce. **Due bottoni generatori** "Pianifica con Shadow" + "Rigenera piano ora" senza spiegazione della differenza (D44). "Fai ora" ok; "Altre modalità" = icona "…" senza label (D52). |
| Today (vuota) | PARZIALE | Insight con "(night)" e "Confidenza: 30%" — enum EN + percentuale tecnica esposta (D34/D60). |
| Focus (execution) | PARZIALE | "LAUNCH / HOLD / RECOVERY" e "In pausa" (D32/D50). Dopo l'uscita strict resta appeso qui (D-store). |
| `/focus` senza task | NO | "Nessun task selezionato per la sessione." + un solo bottone = vicolo cieco (D51). |
| Review (tab manuale) | PARZIALE | **Duplica** la review conversazionale: form statico "Cosa hai fatto/evitato/bloccato + Umore + Salva e aggiorna il modello" (D1/L9). Contatori 0/0/0 senza filtro data (D54). |
| Cielo | NO | "La Lucciola 0/4 stelle" con 4 puntini spenti, **zero spiegazione e zero CTA** su come si accendono (D48). Isola dal resto (L9). |
| Impostazioni | PARZIALE | Solo Account (Esci/Revoca consenso/Elimina) + Profilo Esecutivo READ-ONLY + stato Strict. **Nessun toggle finestra serale, nessun opt-out email, nessun campo modificabile** (D67/D71). "Focus mode: soft", "Strict Mode: Inactive" raw (D50). |

## Inventario lingua mista (L9 / D34 / D50) — CONFERMATO sistemico
- Navigazione: **Inbox / Today / Focus / Review** (EN) vs **Cielo / Impost.** (IT).
- Stati esecuzione: **LAUNCH / HOLD / RECOVERY**, "active_strict", "In pausa".
- Enum grezze esposte: categoria "admin/work/household/personal", "Focus mode: soft",
  "(night)", "Confidenza: 30%".
- Errori API in EN in UI IT (da J9): "attachment too large", "userMessage too long" (D34).

## Verdetti 10-secondi peggiori
1. **Cielo** — NO: 0/4 stelle senza contesto, un utente non capisce cosa deve fare.
2. **/focus orfano** — NO: vicolo cieco.
3. **Today "e adesso?"** — PARZIALE: due generatori competono; il piano è piatto.

## Note economia dell'attenzione (L10)
- Zona Today satura: header energia+tempo+luogo, 2 CTA generatori, card insight SHADOW AI,
  lista piano, e (dopo un'azione) micro-feedback card "Com'è andato l'inizio?". Molte superfici
  interruttive nello stesso viewport (D57).
- Micro-feedback appare come card in coda al piano dopo l'uscita da una sessione (Facile/Giusto/
  Troppo difficile + Salta/Invia): interrompe il ritorno al piano.
