import { isAndroid } from './platform';
import { ShadowAppBlocker, type BlockerPermissions } from './app-blocker';

// Facade dello scudo nativo (Task 59 / W5-M5). Tutto guardato da isAndroid():
// su web e iOS è no-op (iOS = W6 differito). Aggancio agli start/stop dello
// strict mode in tasks/page.tsx.

/** Evento per chiedere alla UI di mostrare la disclosure + richiedere i permessi. */
export const SHIELD_PERMISSION_EVENT = 'shadow:shield-permission-needed';

export async function getShieldPermissions(): Promise<BlockerPermissions | null> {
  if (!isAndroid()) return null;
  try {
    return await ShadowAppBlocker.checkPermissions();
  } catch {
    return null;
  }
}

/** I permessi minimi per bloccare: Usage Access + overlay. */
export function shieldReady(perms: BlockerPermissions | null): boolean {
  return !!perms && perms.usageAccess && perms.overlay;
}

export interface StartShieldOptions {
  sessionId: string;
  blockedAppPackages?: string[];
  endsAt: number | null;
}

export interface StartShieldResult {
  started: boolean;
  reason?: 'not-android' | 'permissions' | 'error';
}

export async function startNativeShield(opts: StartShieldOptions): Promise<StartShieldResult> {
  if (!isAndroid()) return { started: false, reason: 'not-android' };

  const perms = await getShieldPermissions();
  if (!shieldReady(perms)) {
    // Disclosure-first (policy Play): non richiediamo i permessi in silenzio,
    // segnaliamo alla UI di mostrare la disclosure prima.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SHIELD_PERMISSION_EVENT));
    }
    return { started: false, reason: 'permissions' };
  }

  try {
    await ShadowAppBlocker.startBlocking({
      sessionId: opts.sessionId,
      packages: opts.blockedAppPackages,
      endsAtEpochMs: opts.endsAt,
      overlayTitle: 'Torna a Shadow',
      overlayBody: 'Sei in sessione focus. Quest\'app è in pausa.',
    });
    return { started: true };
  } catch {
    return { started: false, reason: 'error' };
  }
}

/** Ferma lo scudo e restituisce il numero di tentativi bloccati (null su web/iOS). */
export async function stopNativeShield(): Promise<number | null> {
  if (!isAndroid()) return null;
  try {
    const res = await ShadowAppBlocker.stopBlocking();
    return res?.blockedAttempts ?? 0;
  } catch {
    return null;
  }
}
