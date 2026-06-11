# W9 — Store submission bilingue (App Store + Play)

> Fase finale: dipende da W2-W7. Go/no-go agganciato anche ai criteri beta del
> Task 23 (§5): P0=0, SUS ≥70, retention ≥50-60%.

## Apple — checklist rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| **4.2 minimum functionality** (webview remoto) | Review notes con elenco funzioni native (shield Screen Time, push, IAP, deep link) + **video demo** del blocco app; contingency = bundle statico (documentata in W5) |
| **FamilyControls** | Entitlement distribution approvato (richiesto in W0); justification nelle review notes; fallback: release senza blocco reale |
| **3.1.1 IAP** | Tutti gli acquisti via RevenueCat/StoreKit; nessun link/menzione del checkout web nell'app iOS; prezzi coerenti |
| **5.1.1 privacy / dati salute** | ADHD = dato sensibile: privacy nutrition labels con "Health & Fitness"/“Sensitive Info” dichiarati; consent flow art. 9 già esistente; **"Elimina account" in-app GIÀ presente** (Impostazioni → Account → "Elimina account e dati", `tasks/page.tsx:3014-3034` + `DELETE /api/account` — verificare solo che sia raggiungibile/visibile nella build iOS) |
| Sign in with Apple | NON richiesto (login solo email/password; Google OAuth = account-linking calendario, esplicitato nelle review notes) |

## Play — checklist

- **Usage Access declaration** (categoria digital wellbeing) + video demo
  permesso→blocco; **FGS `specialUse` declaration**; giustificazione
  SYSTEM_ALERT_WINDOW (overlay solo durante sessioni avviate dall'utente,
  prominent disclosure in-app prima della richiesta).
- Data safety form aggiornato: FCM token/device id, dati salute/profilo
  comportamentale, finalità.
- Health apps policy: posizionamento productivity/digital wellbeing, nessun
  claim terapeutico/medico (coerente col disclaimer già nel consenso).
- Account deletion URL già live (`/account-deletion`, commit 6eccbcc); la voce
  in-app esiste già (vedi tabella Apple sopra).

## Listing bilingue (it/en)

- Schede store complete nelle 2 lingue (titolo ≤30, sottotitolo/short desc,
  descrizione lunga con le keyword: ADHD, body doubling, AI secretary,
  to-do intelligente, focus/blocco app).
- Screenshot per locale e per piattaforma (set it + en; includere: chat,
  piano del giorno, body doubling con avatar, strict mode/shield, review serale).
- Stringhe native localizzate: `InfoPlist.strings` it/en (usage description),
  `strings.xml` it/en (notifiche FGS, overlay), copy estensioni Shield (W6).
- Nota legale: privacy/terms EN già passate dalla review legale (avviata W0).

## Sequenza consigliata

1. Play: closed → open testing → production (l'infrastruttura closed testing
   c'è già; le declaration del blocker sono state accettate in W5-M5).
2. iOS: TestFlight interno → external → App Store review (mettere in conto
   1-2 rejection cycle sul 4.2/FamilyControls: rispondere con video+notes,
   non riprogettare al primo no).
3. Lancio coordinato solo quando ENTRAMBI gli store sono approvati + verifica
   OAuth Google chiusa (W8) — altrimenti lancio scaglionato Android-first.

## Acceptance

App approvata e pubblica su entrambi gli store, listing it/en, acquisti reali
funzionanti su entrambe le piattaforme + web Stripe, entitlement sincronizzati
cross-platform via RevenueCat, telemetria AiUsage/margini osservabile.
