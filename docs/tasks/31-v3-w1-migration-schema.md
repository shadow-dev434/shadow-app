# W1 — Migration schema unica (Shadow v3)

> Prerequisito di W2/W3/W5. Schema ratificato con l'approvazione del piano
> 2026-06-11. Tutte le modifiche sono **additive**: zero righe esistenti alterate.

## Modelli nuovi in `prisma/schema.prisma`

```prisma
model Subscription {
  id                  String    @id @default(cuid())
  userId              String    @unique
  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tier                String    @default("none")   // 'none'|'base'|'plus'|'pro'|'max'
  status              String    @default("none")   // 'none'|'trialing'|'active'|'grace'|'billing_issue'|'expired'
  store               String    @default("")       // 'app_store'|'play_store'|'stripe'|'promotional'|'app_trial'
  periodType          String    @default("")       // 'normal'|'trial'|'intro'
  currentPeriodEndsAt DateTime?
  trialEndsAt         DateTime?
  willRenew           Boolean   @default(false)
  entitlementsJson    String    @default("{}") @db.Text
  lastRcEventId       String    @default("")
  lastRcEventAt       DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}

model RcWebhookEvent {
  id          String   @id            // event.id RevenueCat → idempotenza
  type        String
  appUserId   String
  payloadJson String   @db.Text
  processedAt DateTime @default(now())
  @@index([appUserId, processedAt])
}

model AppConfig {
  key       String   @id              // 'model_routing' | 'model_pricing' | 'ai_budget'
  valueJson String   @db.Text
  updatedAt DateTime @updatedAt
}

model AiUsage {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  day       String                    // YYYY-MM-DD Europe/Rome
  taskClass String                    // 'chat'|'classify'|'decompose'|'nudge'|'review_deep'|'body_double_checkin'
  calls     Int      @default(0)
  tokensIn  Int      @default(0)
  tokensOut Int      @default(0)
  costUsd   Float    @default(0)
  modelMix  String   @default("{}") @db.Text
  updatedAt DateTime @updatedAt
  @@unique([userId, day, taskClass])
  @@index([userId, day])
}

model PushDevice {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform   String                   // 'web'|'android'|'ios'
  token      String   @db.Text       // FCM token / APNs token / endpoint web push
  p256dh     String?                  // solo web
  auth       String?                  // solo web
  locale     String?
  appVersion String?
  lastSeenAt DateTime @default(now())
  createdAt  DateTime @default(now())
  @@unique([userId, token])
  @@index([userId])
}
```

## Modifiche a modelli esistenti (solo aggiunte)

- `User`: relazioni `subscription Subscription?`, `pushDevices PushDevice[]` e
  `aiUsages AiUsage[]` (la cancellazione account si affida ai cascade:
  senza la relazione le righe AiUsage resterebbero orfane — problema GDPR).
- `UserProfile`: campo `locale String @default("it")`.
- `StrictModeSession.triggerType`: nuovo valore d'uso `'body_double'`
  (campo già String → nessuna modifica schema).

## Procedura

1. Chiudere `bun run dev` e `prisma studio` (EPERM Windows su query engine).
2. Editare `prisma/schema.prisma` (solo blocchi sopra) — ⚠️ file protetto:
   conferma esplicita di Antonio prima dell'edit (contratto Workflow v2).
3. `bun run db:migrate` (⚠️ comando in ask) — migration **additiva** committata
   in `prisma/migrations`, deployabile su prod con `migrate deploy`. NON usare
   `db push`: ricreerebbe il drift migration/DB appena sanato dall'incidente
   `docs/tasks/23-prod-db-incident.md` (le migration esistono già nel repo,
   ultima `20260609_add_consent_fields`). Poi `bunx prisma generate`.
4. `bun run build` → verde (i nuovi modelli non sono ancora usati dal codice).
5. Migrazione dati push: script one-shot `scripts/migrate-push-subscriptions.ts`
   che copia `PushSubscription` → `PushDevice(platform='web')` (si esegue in W5-M4,
   non qui; la tabella vecchia resta finché esiste lo shim).

## Env da aggiungere in questo step

`SHADOW_TRIAL_EPOCH` (ISO date: gli utenti creati prima di questa data hanno
trial 21gg a partire da essa, non da createdAt → i beta attuali non si trovano
col trial già scaduto al deploy). ⚠️ `.env*` è sotto conferma: il valore lo
aggiunge Antonio in `.env.local` + Vercel.

## Acceptance

- Tabelle presenti su Neon (verifica `bunx prisma studio` o query).
- `bun run build` verde; nessun cambiamento comportamentale per gli utenti.
- `api/export` e cancellazione account: aggiungere i nuovi modelli al export e
  verificarne la cascade (Subscription/PushDevice/AiUsage hanno onDelete Cascade
  via relazione User; RcWebhookEvent è log di sistema, NON va nell'export utente
  ma va purgato per appUserId alla cancellazione account).
