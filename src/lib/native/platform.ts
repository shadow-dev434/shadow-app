// Unico punto d'import di Capacitor lato web (regola spec 35).
// In browser `isNative()` è false e i plugin restano no-op; dentro la WebView
// nativa Capacitor è iniettato e `isNative()` è true.
import { Capacitor } from '@capacitor/core';

/** true se siamo dentro il guscio nativo (Android/iOS), false nel browser web. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** 'android' | 'ios' | 'web' */
export function nativePlatform(): string {
  return Capacitor.getPlatform();
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}
