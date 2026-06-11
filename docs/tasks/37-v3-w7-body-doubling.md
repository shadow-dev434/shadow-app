# W7 — Body doubling MAX (avatar 3D) + review profonda Opus

> Dipende da W3 (router) e, per il blocco app, da W5-M5 / W6-M8 (su web il
> shield è no-op: la feature funziona comunque con la sola friction esistente).
> Decisioni del piano 2026-06-11 (registro D1-D10 in ROADMAP, Fase v3):
> D3 = MAX include il body doubling; D6 = v1 con avatar 3D + check-in testuali,
> voce TTS rimandata alla v1.1 (cfr. ROADMAP Task 11 / spec 27).

## UX `BodyDoubleView` (gated `body_double`)

- Ingresso: dal task della lista ("fallo con Shadow") o da FocusView.
- Scena: avatar 3D **three.js + VRM** nel webview con stati `presente / parla /
  pausa` (idle animation continua → percezione di presenza senza costi AI).
- HUD: timer sessione, task corrente + micro-step attivo (riusa la
  decomposizione esistente), pulsante pausa, exit con la **friction esistente**
  (StrictModeExitDialog, 4 step). NOTA: oggi è una function privata dentro
  `tasks/page.tsx:~835`, accoppiata a useShadowStore e a `STRICT_EXIT_STEPS` —
  il riuso richiede l'estrazione in un modulo condiviso
  (es. `src/features/strict-mode/`), non un import diretto.
- Avvio sessione: crea `StrictModeSession` con `triggerType: 'body_double'` e
  attiva lo shield nativo via `focus-shield.ts` (W5/W6). Fine/scadenza → stop
  shield + sync `distractionsBlocked`.

## Check-in AI

- `POST /api/body-double/checkin` (`withCapability('body_double')`,
  taskClass `body_double_checkin` → Haiku, risposte ≤2 frasi, tono da companion).
- Cadenza ~10 min + trigger evento (micro-step completato, rientro da blocco).
- Input: task, micro-step corrente, minuti trascorsi, esito ultimo check-in.
- Costo: ~$0,001/check-in → ~$0,01 per sessione di 2h (trascurabile, dentro il
  cap giornaliero MAX).

## Asset e performance

- Dipendenze nuove (⚠️ edit package.json → conferma esplicita; giustificate:
  unico modo di fare 3D nel webview): `three`, `@react-three/fiber`,
  `@pixiv/three-vrm`. Lazy load (next/dynamic)
  SOLO in questa vista: zero impatto sul bundle del resto dell'app.
- Modello VRM servito da CDN/`public` (non nel binario nativo); licenza del
  modello da verificare (CC0/redistribuibile) o commissionarne uno.
- Tier qualità per device deboli: cap 30fps, pixelRatio max 1.5, fallback 2D
  (immagine animata) se WebGL assente/contesto perso; pausa render quando l'app
  è in background (battery).

## Review profonda mensile (MAX, `deep_review`)

- `POST /api/review/deep`: Opus 4.8 + `thinking:{type:'adaptive'}`,
  `export const maxDuration = 300`. Input: aggregati ultimi 30gg (task,
  pattern, streak, strict sessions, pulse beta se presenti). Output: analisi
  strutturata + 3 raccomandazioni concrete, salvata e mostrata in una card
  dedicata. Trigger: manuale da Settings/Review + suggerimento mensile.
- Costo stimato: ~50-100k token in / 2-4k out ≈ $0,3-0,6 per review → 1/mese
  per utente MAX: sostenibile. Batch API (−50%) solo se il volume lo
  giustificherà (decisione rinviata).

## Acceptance

1. Sessione body doubling end-to-end su Android reale: avatar visibile, timer,
   check-in che arrivano, app vietata → overlay/shield, exit con friction,
   `StrictModeSession` chiusa con `actualDurationMinutes` e `distractionsBlocked`.
2. Su web: identica ma senza blocco nativo (no-op silenzioso).
3. Device low-end (Android 2-3 anni): scena fluida o fallback 2D automatico.
4. Review profonda: output in lingua dell'utente, salvata, visibile, costo
   tracciato in `AiUsage` con taskClass `review_deep`.
5. Utente non-MAX → 402 + paywall con trigger `body_double`/`deep_review`.
