# Task 75 — Widget Android quick-add + App Shortcuts

> Brief: Antonio, 2026-07-18 — "voglio capire se attualmente è già possibile
> mettere un widget di shadow sul proprio telefono in modo che inserire i task
> da fare sia la cosa più veloce e immediata possibile". Audit: NON esisteva
> nulla (né AppWidgetProvider né shortcuts.xml). Piano ratificato 2026-07-18
> (punto 4): pattern A — bottoni → launch intent → superfici quick-add
> esistenti, auth gratis via WebView. Il POST headless senza aprire l'app
> (pattern B, CookieManager) resta fuori scope.

## Scope

### A. Widget home screen (AppWidgetProvider)

Widget compatto (4×1 ridimensionabile) con due bottoni:
- **"＋ Aggiungi task"** → apre Shadow su `/?action=inbox` (input chat
  focalizzato — convenzione quick-add esistente, stessa dello shortcut PWA);
- **"🎤 Voce"** → apre Shadow su `/tasks?view=inbox&capture=voice` e avvia
  subito il riconoscimento vocale nativo (RecognizerIntent, Task 72 E): il
  transcript precompila l'input dell'inbox (zero LLM).

Meccanica: PendingIntent → MainActivity con **azioni custom**
(`com.shadow.adhd.executor.action.QUICK_INBOX` / `QUICK_VOICE`, componente
esplicito = nessun intent-filter necessario). `ShadowCapturePlugin` le
trasporta al layer web col **doppio canale del Task 72** (pending consume-once
per il cold start + evento `quickAction` retained, dedupe per id): il nativo
trasporta, il web decide — zero logica di prodotto in Java.

### B. App Shortcuts statici (long-press sull'icona)

`res/xml/shortcuts.xml` con gli stessi due intent ("Aggiungi task", "Voce").
Gratis una volta costruito il canale A.

### C. Lato web

- `capture.ts`: interfaccia `getPendingQuickAction` + evento `quickAction`.
- `native-bootstrap.tsx`: handler (modulo `src/lib/capture/quick-action.ts`,
  puro e testato: dedupe per id + navigazione).
- `useVoiceCapture`: consuma il one-shot `sessionStorage['shadow-voice-pending']`
  seminato dal boot di /tasks quando l'URL ha `capture=voice` (il param viene
  ripulito dal replaceState esistente di syncViewToUrl).

## Non-scope

- iOS (non esiste il guscio); input testuale DENTRO il widget (RemoteViews non
  supporta EditText) e POST headless con cookie CookieManager (taglia L, dopo
  il lancio se i dati d'uso lo giustificano); widget con lista task (RemoteViews
  collection: altra iterazione).

## Decisioni minori prese in autonomia

- Due target diversi per i due bottoni: testo → chat (convenzione `?action=inbox`
  già usata dallo shortcut PWA), voce → inbox diretta (l'unica superficie con
  la voce nativa cablata, zero LLM). Ognuno sul percorso più corto reale.
- Azioni custom sull'intent invece di extra: sopravvivono meglio ai
  PendingIntent (niente collasso di extras con FLAG_UPDATE_CURRENT).
- Icone shortcut = launcher icon (icone dedicate = rifinitura post-lancio).

## Verifica

- `tsc` + unit test (quick-action handler) + `bun run test` + `bun run build`.
- `gradlew assembleDebug` verde (l'occhio reale sull'APK resta ad Antonio:
  widget in home, tap dei 2 bottoni, long-press icona — 4 passi, sotto).
- Nessun probe server: il canale è tutto client/nativo (il POST /api/tasks a
  valle è già coperto dai probe del 72/74).

### Test manuale APK (Antonio)

1. Installa `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Long-press su una zona vuota della home → Widget → Shadow → trascina il
   widget "Quick add".
3. Tap "＋ Aggiungi task" → l'app si apre sulla chat con input focalizzato.
4. Tap "🎤 Voce" → dialog vocale di sistema → parla → l'inbox si apre col
   testo precompilato.
5. Long-press sull'icona Shadow → compaiono "Aggiungi task" e "Voce".

## File toccati

Java/res: `widget/QuickAddWidgetProvider.java` (nuovo),
`capture/ShadowCapturePlugin.java` (quick action), `AndroidManifest.xml`
(receiver + meta-data shortcuts), `res/layout/widget_quick_add.xml`,
`res/drawable/widget_bg.xml` + `widget_btn_bg.xml`,
`res/xml/quick_add_widget_info.xml`, `res/xml/shortcuts.xml`, `strings.xml`.
Web: `src/lib/native/capture.ts`, `src/lib/capture/quick-action.ts` (+test,
nuovo), `src/components/native/native-bootstrap.tsx`,
`src/app/tasks/page.tsx` (boot param + hook voce). Nessun file core chat,
nessuna migration, nessuna dipendenza nuova.
