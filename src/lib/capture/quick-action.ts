/**
 * Task 75 — quick action da widget/App Shortcuts Android.
 *
 * Il nativo trasporta { id, action } (doppio canale: evento `quickAction` +
 * pending consume-once, come lo share del Task 72); qui si dedupa per id e si
 * naviga alla superficie giusta:
 *  - 'inbox' → `/?action=inbox` (input chat focalizzato, convenzione quick-add
 *    esistente, la stessa dello shortcut PWA);
 *  - 'voce'  → `/tasks?view=inbox&capture=voice`: il boot di /tasks semina il
 *    one-shot `shadow-voice-pending` in sessionStorage e useVoiceCapture lo
 *    consuma avviando il riconoscimento (il param sparisce col replaceState
 *    di syncViewToUrl).
 *
 * Navigazione con location.assign (pieno reload SPA): stesso trade-off dello
 * share nativo — il tap sul widget è un cambio di contesto intenzionale.
 */

export interface NativeQuickAction {
  /** Id per il dedupe: la stessa azione può arrivare come pending E come evento. */
  id: string;
  action: 'inbox' | 'voice';
}

const seenIds = new Set<string>();

/** Chiave one-shot letta da useVoiceCapture al mount dell'inbox. */
export const VOICE_PENDING_KEY = 'shadow-voice-pending';

export function handleQuickAction(
  qa: NativeQuickAction,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): boolean {
  if (!qa || typeof qa.id !== 'string' || seenIds.has(qa.id)) return false;
  seenIds.add(qa.id);

  if (qa.action === 'inbox') {
    navigate('/?action=inbox');
    return true;
  }
  if (qa.action === 'voice') {
    navigate('/tasks?view=inbox&capture=voice');
    return true;
  }
  return false;
}

/** Solo per i test: azzera il registro dedupe. */
export function resetQuickActionDedupe(): void {
  seenIds.clear();
}
