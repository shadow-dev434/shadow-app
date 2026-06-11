# W2 — Entitlements & billing (RevenueCat + Stripe)

> Dipende da W1. Parallelo a W3. Decisioni: D1, D2, D7, D9 del piano 2026-06-11.

## 1. `src/lib/entitlements.ts` (nuovo)

```ts
export type Tier = 'none' | 'base' | 'plus' | 'pro' | 'max';
export type Capability = 'core' | 'ai_chat' | 'ai_smart' | 'calendar_ingest'
  | 'gmail_ingest' | 'body_double' | 'deep_review';

export interface EntitlementState {
  tier: Tier; effectiveTier: Tier; status: string;
  isTrial: boolean; trialEndsAt: Date | null; trialDaysLeft: number | null;
}
export async function getEntitlements(userId: string): Promise<EntitlementState>;
export function hasCapability(s: EntitlementState, cap: Capability): boolean;
```

- Mappa TIER_CAPABILITIES: base = core+ai_chat · plus = +ai_smart · pro =
  +calendar_ingest(+gmail_ingest in fase 2) · max = +body_double+deep_review.
- **Trial app-managed (lazy bootstrap)**: se l'utente non ha riga Subscription,
  `getEntitlements` la crea con `status='trialing'`, `tier='max'`,
  `store='app_trial'`, `trialEndsAt = max(user.createdAt, SHADOW_TRIAL_EPOCH) + 21gg`.
  Serve a: continuità beta, esperienza pre-paywall, web senza carta. Il percorso
  di conversione canonico resta il **trial store/Stripe con metodo di pagamento**
  (D2) offerto dal paywall. Scelta documentata: nel caso peggiore un utente
  somma 21gg app-managed + 21gg store (più formazione d'abitudine, accettato).
- Trial scaduto senza acquisto → `effectiveTier='none'`: dati sempre leggibili,
  AI bloccata server-side, soft-lock client col paywall.

## 2. `src/lib/api-guard.ts` (nuovo)

`withCapability(cap, handler)` → 401 senza sessione (riusa `requireSession`);
**402** `{ error: 'upgrade_required', capability, requiredTier, tier }` se manca
la capability. Route da wrappare (SOLO queste; export/account/consent mai gated):

| Route | Capability |
|---|---|
| `api/chat/turn`, `api/chat/bootstrap`, `api/decompose`, `api/ai-classify`, `api/ai-assistant` | `ai_chat` |
| `api/calendar/*` (incl. oauth) | `calendar_ingest` |
| `api/body-double/*` (W7) | `body_double` |
| `api/review/deep` (W7) | `deep_review` |

## 3. Webhook RC — `src/app/api/billing/revenuecat/webhook/route.ts`

- Auth: confronto constant-time dell'header `Authorization` con
  `REVENUECAT_WEBHOOK_AUTH`; 401 se mismatch.
- Idempotenza: `rcWebhookEvent.create({ id: event.id })` per primo; su P2002 → 200.
- Out-of-order: scarta se `event_timestamp_ms <= lastRcEventAt`.
- Eventi: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION (willRenew=false),
  UNCANCELLATION, EXPIRATION, BILLING_ISSUE, TRANSFER. Tier dagli `entitlement_ids`.
- `app_user_id` = `User.id` (il client fa `Purchases.logIn(userId)`; Stripe
  checkout passa lo stesso id in `client_reference_id`/metadata).

## 4. Stripe web

- `api/billing/checkout` (POST `{plan, interval}`): Stripe Checkout Session via
  **fetch raw** (no SDK), 8 price IDs da env, `subscription_data.trial_period_days=21`,
  `client_reference_id=userId`. RC ascolta Stripe con la sua integrazione → a noi
  arriva solo il webhook RC.
- `api/billing/portal` (POST): Billing Portal per gestione/cancellazione web.
- `api/billing/entitlements` (GET): `EntitlementState` + catalogo piani per il paywall.

## 5. UI

- Slice Zustand `entitlements` + `paywall: {open, trigger}` in `shadow-store.ts`,
  idratata da `GET /api/billing/entitlements` al mount di ShadowApp e ChatView.
- `src/features/billing/PaywallSheet.tsx` (4 piani, mensile/annuale, CTA:
  web→checkout Stripe; nativo→prodotti RevenueCat, MAI link a checkout web —
  Apple 3.1.1) + `TrialBanner.tsx` ("Giorno N/21" — trasparenza D2). Bilingue da subito.
- Intercettazione **402** nei due call-site AI reali: fetch del turn in
  `ChatView.tsx:213` e `decomposeTask`/`classifyTaskAI` in
  `tasks/page.tsx:150-171` → apre paywall con trigger. NOTA: una UI "connetti
  calendario" oggi NON esiste nel client (SettingsView non ce l'ha) — il gating
  client-side di `calendar_ingest` si aggancia quando W8 introduce la UI di
  connessione; lato server le route calendar sono comunque gated da subito.
- NextAuth: tier/trialEndsAt copiati nel JWT nei callback esistenti **solo per
  display**; gating sempre da DB (lezione flag onboarding). Post-acquisto il
  client chiama `update()`.

## 6. Beta tester (D9)

Entitlement promozionale RC "max" 3 mesi via console/script RC sugli utenti
beta esistenti (lista email da DB) + badge founder (campo derivato, no schema).

## Acceptance

1. Replay stesso event.id → 200 idempotente, nessun doppio update.
2. Sandbox INITIAL_PURCHASE→EXPIRATION muta `Subscription` correttamente.
3. Utente nuovo → effectiveTier=max per 21gg; scaduto → 402 su chat/turn + paywall.
4. Checkout Stripe sandbox → webhook RC → tier aggiornato → badge UI corretto dopo `update()`.
5. `api/export` e `api/account` mai bloccati, qualunque stato billing.
6. `bun run build` + vitest verdi.
