# Slice 6c — Rubrica retest E2E pre-registrata

**Stato:** rubrica bloccata prima del retest. Niente ricalibrazione mentre si vedono risultati.
**Totale voci:** 33. **Target globale:** 33/33. **Soglia di pass per shippare:** 31/33 con annotazione esplicita dei 2 fail accettati.

**Origine rubrica:** Sezione H di `docs/tasks/05-slice-6c-plan.md` (rubriche 1, 2, 3) + integrazioni V1.x interaction (rubrica 4) + DB-side verification (rubrica 5) co-progettate con Claude.ai chat strategico durante audit pre-retest.

**Modifica strutturale rispetto Sezione H originale:** la voce "warnings al turno 13" è stata assorbita in Rubrica 1 punto 2 (il modello presenta warning con pattern 6.2). Decisione presa dopo lookup empirico sulla shape del payloadJson: i tool 6c ritornano `data: { ok: true }` magro per design G.6 (canale espositivo unico via mode-context), quindi le warnings non sono persistite in DB. La verifica passa via output del modello al turno corretto, coerente con G.6.

---

## Rubrica 1 — Verifica prompt 6c (target 7/7)

1. Modello presenta cut[] con `cutReason='low_priority'` (pattern B.5.1).
2. Modello presenta warning `pinned_exceeds_ceiling` con pattern 6.2 (B.5.2), NON con pattern di taglio normale. (Voce ampliata: assorbe l'ex-Rubrica 5 punto 3 — la presenza testuale del warning nel content del modello al turno 13 è proxy fedele dello stato server-side.)
3. Modello distingue "ok spostala" (→ `update_plan_preview`) da "ok blocca" (→ `confirm_plan_preview`).
4. Modello chiama `confirm_plan_preview` solo quando l'utente esprime conferma esplicita di chiusura.
5. In `phase='closing'`, modello dice frase di chiusura minimale (B.5.6) e si ferma.
6. `fillEstimate.state` riflette correttamente sensitivity=4 (denominatore ridotto). Verifica via comportamento del modello: con sensitivity=4 (fillRatio=0.5) cut[] appare prima rispetto a sensitivity default 3 (fillRatio=0.6) sullo stesso scenario.
7. Trimming preserva task con deadline ≤48h dal cut anche con priorityScore basso.

## Rubrica 2 — DIVIETO out-of-scope (target 5/5)

1. Modello NON inventa numeri (orari, percentuali) nel preview.
2. Modello NON ricostruisce il preview da zero in prosa.
3. Modello NON chiama tool delle fasi precedenti (triage, per-entry).
4. Modello NON propone autonomamente di togliere task pinned eccedenti il soffitto.
5. Modello NON chiama `confirm_plan_preview` se l'utente sta ancora facendo override.

## Rubrica 3 — Regressione 6a + 6b (target 9/9 + 6/6)

Replicare scenari standard 6a (preview presentato, no override) e 6b (override classici). FillRatio applicato in 6c può far emergere `cut[]` non vuoto in scenari 6a/6b dove prima era vuoto: la prosa deve restare coerente.

**6a (target 9/9):** scenari da replicare letteralmente da `docs/tasks/05-slice-6a-plan.md` Sezione H.
**6b (target 6/6):** scenari da replicare letteralmente da `docs/tasks/05-slice-6b-plan.md` Sezione H.

I 15 scenari letterali si dettagliano all'inizio del retest, leggendo i piani 6a/6b. Non in questa rubrica.

## Rubrica 4 — V1.x interaction (target 4/4)

1. Replica testuale del preview: ≤2 turni con recovery automatico = pass (pre-existing V1.x accettato). >2 turni o senza recovery = fail (regressione).
2. In `phase='closing'` con `firstTurnAfterResume=true`: modello produce frase di chiusura senza chiamare tool, anche se forced `tool_choice='any'` scatta. Pass = B.5.6 rispettato.
3. `lastTurnWasTextOnly` resta clear nei turni 10-14 (verifica via stderr telemetria `[V1.3.2 set]`/`[V1.3.2 clear]`). Pass = nessun set in plan_preview/closing.
4. Comportamento su "ok va bene" ambiguo dopo override: documentare verbatim. Non blocker.

## Rubrica 5 — DB-side verifica (target 2/2)

1. `contextJson.phase` transita `per_entry` → `plan_preview` → `closing` ai turni 10 e 15. Verifica via `scripts/verify-6c-retest-state.ts <userId> <threadId>`, sezione `=== PHASE ===`.
2. `previewState.pinnedTaskIds` aumenta ai turni 11-12, diminuisce al turno 14. Verifica via stesso script, sezione `=== PREVIEW STATE ===`, riga `pinnedTaskIds`.

(Voce 5.3 originale "warnings al turno 13" assorbita in Rubrica 1.2, vedi nota in testa.)

---

## Operative

### Telemetria stderr durante retest (verifica Rubrica 4 punto 3)

Lo stderr V1.x è scritto sulla console del processo `bun run dev`, non su file separato. Durante il retest, tenere aperta la console del dev server e filtrare visivamente i prefissi:
- `[V1.3.2 set]` — lastTurnWasTextOnly attivato
- `[V1.3.2 clear]` — lastTurnWasTextOnly disattivato
- `[V1.3 forced tool_choice]` — tool_choice='any' forzato
- `[V1.2 replica detection]` — replica testuale rilevata
- `[V1.2.2 skipped-close detection]` — escape hatch firstTurnAfterResume

Se lo stderr scrolla troppo veloce, alternativa Windows PowerShell:
```powershell
bun run dev 2>&1 | Tee-Object -FilePath dev-retest.log
# In altra finestra:
Get-Content dev-retest.log -Wait | Select-String '\[V1\.'
```

### Verifica DB-side tra turni (Rubrica 5)

```
node_modules/.bin/dotenv -e .env.local -- bunx tsx scripts/verify-6c-retest-state.ts <userId> <threadId>
```

Stampa: phase corrente, previewState completo (pinned/removed/added con title lookup), triageState, ultimi 3 messaggi con payloadJson parsato. Lanciare ai turni 10, 13, 14, 15 secondo Sezione H del piano.

### Setup virgin account

Nessun utente attualmente nel DB soddisfa i requisiti virgin (verificato via `scripts/check-virgin-test-6c-account.ts`). Antonio deve preparare manualmente in Studio o via `bun run prisma:studio`:

- AdaptiveProfile: `optimalSessionLength=25`, `shameFrustrationSensitivity=4`, `preferredPromptStyle='direct'`, `bestTimeWindows=["morning"]`
- Settings: `wakeTime='07:00'`, `sleepTime='23:00'`
- 8 task in inbox: 3 con deadline ≤48h da now, 5 senza deadline, durate variate (size 1-5 distribuite)
- Nessun thread `evening_review` in stato `active`/`paused` (lazy archive automatico al login fuori finestra OK, oppure archiviazione manuale via Studio)

Rilanciare `scripts/check-virgin-test-6c-account.ts` per conferma "VIRGIN OK".

### Costo stimato e logistica

- ~14 turni con Sonnet 4.5, ~$0.70-1.00 per il retest principale.
- Regressione 6a + 6b in scenari aggiuntivi (~15 scenari brevi): variabile, stimato $0.30-0.50 in più.
- Apertura review serale dentro finestra (es. 21:00 ora locale Roma).
- Rischio principale: modello chiama tool sbagliato (confirm vs update) — Rubrica 1 punto 3 + 4. Mitigazione documentata in B.5.4 prompt 6c.
- Rischio Windows: `bun run build` con dev server attivo causa EPERM su query_engine.dll. Spegnere dev prima di build finale.

---

*Rubrica versionata. Aggiornare se durante retest emergono pattern non previsti, ma SOLO post-retest, mai durante (no ricalibrazione live).*
