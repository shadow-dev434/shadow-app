'use client';

import { useEffect } from 'react';
import { isNative } from '@/lib/native/platform';
import { ShieldPermissionGate } from './shield-permission-gate';

/**
 * Inizializzazioni che hanno senso solo dentro il guscio nativo (Task 59).
 * Per ora: il tasto Indietro hardware di Android mappa su history.back(),
 * e chiude l'app solo quando non c'è più storia (comportamento atteso vs
 * uscita immediata della WebView). No-op sul web.
 */
export function NativeBootstrap() {
  useEffect(() => {
    if (!isNative()) return;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) {
          window.history.back();
        } else {
          void App.exitApp();
        }
      });
      cleanup = () => void handle.remove();
    })();
    return () => cleanup?.();
  }, []);

  return <ShieldPermissionGate />;
}
