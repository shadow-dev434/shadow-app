# W0 — Checklist amministrativa (Antonio, nessun codice)

> Shadow v3 — piano approvato 2026-06-11. Queste azioni hanno lead time lungo e
> sbloccano i workstream successivi: vanno avviate SUBITO, in parallelo a tutto.
> Riferimento generale: piano sessione 2026-06-11 + `docs/tasks/31..39-v3-*.md`.

## 1. Apple (blocca W6 e W9 — lead time più lungo di tutti)

- [ ] **Apple Developer Program — Individual** (99 $/anno). Serve Apple ID con 2FA.
      Per persona fisica NON serve D-U-N-S (solo per Organization).
- [ ] Appena attivo: **richiesta entitlement Family Controls (distribution)**.
      Form dedicato su developer.apple.com (cerca "Family Controls & Personal
      Device Management entitlement request"). In development si lavora senza
      approvazione; per TestFlight/App Store serve l'ok di Apple (settimane).
      Bozza motivazione (EN):
      > Shadow is a productivity app for adults with ADHD. During user-initiated
      > focus sessions ("strict mode" and AI body-doubling sessions), the app
      > shields apps the user has personally selected on their own device, using
      > FamilyControls with `.individual` authorization, ManagedSettings shields
      > and DeviceActivity schedules. This is self-management for users with
      > executive-function impairment — not parental control. App selections are
      > opaque tokens that never leave the device.
- [ ] Creare **APNs Auth Key (.p8)** (Keys → Apple Push Notifications service).
      Conservare key ID + team ID + file .p8 in password manager.
- [ ] Decidere la **macchina per iOS** (serve per W6, non prima): Mac mini M1/M2
      usato (~400-600 €, raccomandato: il debugging FamilyControls richiede
      Xcode interattivo + iPhone fisico via cavo; il simulatore NON supporta
      FamilyControls) oppure Mac cloud (MacStadium/Scaleway). Xcode Cloud
      (25h/mese incluse nel Developer Program) solo per build CI, non per sviluppo.

## 2. RevenueCat (blocca W2 e W5-M6)

- [ ] Account RevenueCat, progetto "Shadow".
- [ ] 4 **entitlements**: `base`, `plus`, `pro`, `max`.
- [ ] 8 prodotti per store (naming proposto): `shadow_base_1m`, `shadow_base_1y`,
      `shadow_plus_1m`, `shadow_plus_1y`, `shadow_pro_1m`, `shadow_pro_1y`,
      `shadow_max_1m`, `shadow_max_1y`. Prezzi (D1): 4,99/9,99/14,99/19,99 €
      mensili; annuale = 10× il mensile.
- [ ] **Trial 21 giorni** configurato store-side su ogni prodotto: Play = offer
      con free trial 21d sul base plan; App Store = introductory offer "free, 3 weeks".
- [ ] Webhook RC → `https://shadow-app2.vercel.app/api/billing/revenuecat/webhook`
      con Authorization header segreto → env `REVENUECAT_WEBHOOK_AUTH`.
- [ ] Annotare le **API key pubbliche** RC per piattaforma (Android/iOS) → client.
- [ ] Più avanti (W2 chiuso): entitlement promozionali **3 mesi MAX ai beta tester** (D9).

## 3. Stripe (blocca la vendita web, W2)

- [ ] Account Stripe (o riuso esistente), prodotti+prezzi = stessi 8 SKU
      → env `STRIPE_SECRET_KEY` + 8 `STRIPE_PRICE_*`.
- [ ] Collegare **l'integrazione Stripe di RevenueCat** (RC ascolta i webhook
      Stripe direttamente: noi gestiamo solo il webhook RC).

## 4. Google / Firebase (blocca W5-M4 e W8)

- [ ] Progetto **Firebase solo per FCM Android** (niente SDK iOS): service
      account JSON → env server per FCM HTTP v1.
- [ ] **Verifica OAuth Google** per scope sensitive `calendar.readonly` +
      `calendar.events` (flusso già implementato): finché non verificata, cap
      ~100 utenti con schermata "app non verificata". Avviare la submission
      (serve privacy policy pubblica — c'è — e video del flusso).
- [ ] Gmail (`gmail.readonly`) = scope **restricted** → assessment CASA annuale
      (settimane + costi): SOLO informarsi adesso, decisione in W8 fase 2.

## 5. Varie

- [ ] Verificare il backup di `C:\shadow-twa\shadow-upload.keystore` + password
      (è l'upload key per sempre, serve a W5-M2 — il nome `android.keystore`
      che compare nel runbook TWA è solo l'esempio del comando, il file reale
      si chiama `shadow-upload.keystore`).
- [ ] Avviare la **review legale EN** di privacy/terms/consenso (lead time lungo,
      serve a W4/W9). Stesso canale della consulenza GDPR già prevista.
- [ ] Account **Resend** + API key per gli alert beta via email (env
      `RESEND_API_KEY`/`BETA_ALERT_EMAIL_TO`/`BETA_ALERT_EMAIL_FROM` — decisione
      task 23 §A3: email, NON Telegram bot) + creare il gruppo Telegram/WhatsApp
      dei tester (task 23 §A6, canale umano, zero codice).
- [ ] Vercel: verificare il piano (i **cron** di `vercel.json` su Hobby sono solo
      giornalieri; per reminder ogni 5-15 min serve Pro oppure cron esterno tipo
      cron-job.org che chiama l'endpoint con `CRON_SECRET`).

## Env nuove da predisporre (si aggiungono man mano nei workstream)

`REVENUECAT_WEBHOOK_AUTH`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_{BASE,PLUS,PRO,MAX}_{MONTHLY,YEARLY}`,
`SHADOW_TRIAL_EPOCH`, `SHADOW_MODEL_ROUTING` (opz.), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`,
`CRON_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY`.

**Mai** committare questi valori; vanno in `.env.local` + Vercel env.
