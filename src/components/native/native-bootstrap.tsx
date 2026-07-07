'use client';

import { useEffect } from 'react';
import { isNative } from '@/lib/native/platform';
import { ShieldPermissionGate } from './shield-permission-gate';
import { OcrCaptureSheet } from '@/features/capture/OcrCaptureSheet';

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

      // Task 72 (Slice C): share nativo — pending a freddo + evento a caldo.
      // Il dedupe per id vive in handleNativeShare (stesso share da entrambi
      // i canali = un solo POST).
      const { ShadowCapture } = await import('@/lib/native/capture');
      const { handleNativeShare } = await import('@/lib/capture/native-share');
      const shareHandle = await ShadowCapture.addListener('shareReceived', (share) => {
        void handleNativeShare(share);
      });
      const pending = await ShadowCapture.getPendingShare();
      if (pending.share) void handleNativeShare(pending.share);

      cleanup = () => {
        void handle.remove();
        void shareHandle.remove();
      };
    })();
    return () => cleanup?.();
  }, []);

  return (
    <>
      <ShieldPermissionGate />
      {/* Task 72 (Slice D): sheet OCR globale — si apre via 'shadow:ocr-open'
          (bottone camera dell'inbox, share nativo di immagini). */}
      <OcrCaptureSheet />
    </>
  );
}
