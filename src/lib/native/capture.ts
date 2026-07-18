import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// Interfaccia del plugin nativo `ShadowCapture` (Android — Task 72).
// Trasporta le catture native (share sheet; poi OCR e voce) verso il layer
// web, che riusa il contratto dello share PWA. Su web i metodi non vengono
// mai chiamati (guard isNative() nel bootstrap).

export interface NativeShare {
  /** Id per il dedupe: lo stesso share può arrivare come pending E come evento. */
  id: string;
  type: 'text' | 'image';
  /** ACTION_SEND text/plain: EXTRA_SUBJECT (spesso assente). */
  title?: string | null;
  /** ACTION_SEND text/plain: EXTRA_TEXT (testo e/o URL, WhatsApp li fonde qui). */
  text?: string | null;
  /** ACTION_SEND image/* (Slice D): path assoluto della copia in cache. */
  imagePath?: string | null;
}

// Task 75: azione da widget/App Shortcuts (QUICK_INBOX/QUICK_VOICE).
export interface NativeQuickActionPayload {
  /** Id per il dedupe: la stessa azione può arrivare come pending E come evento. */
  id: string;
  action: 'inbox' | 'voice';
}

export interface ShadowCapturePlugin {
  /** Share arrivato a freddo (cold start): consume-once, poi torna vuoto. */
  getPendingShare(): Promise<{ share?: NativeShare }>;
  /** Task 75: quick action arrivata a freddo (widget/shortcut): consume-once. */
  getPendingQuickAction(): Promise<{ quickAction?: NativeQuickActionPayload }>;
  /**
   * Slice D — foto → OCR on-device. capturePhoto delega all'app fotocamera
   * (ACTION_IMAGE_CAPTURE, zero permesso CAMERA); pickImage usa il Photo
   * Picker. recognizeText (ML Kit) CANCELLA il file appena estratto il testo:
   * l'immagine non è mai persistita né caricata. Reject 'capture_cancelled'
   * se l'utente annulla.
   */
  capturePhoto(): Promise<{ path: string }>;
  pickImage(): Promise<{ path: string }>;
  recognizeText(options: { path: string }): Promise<{ text: string }>;
  /**
   * Slice E — voce nativa: dialog di sistema (RecognizerIntent, it-IT).
   * Reject 'capture_cancelled' su annullo, 'speech_unavailable' se il device
   * non ha un riconoscitore.
   */
  startSpeech(): Promise<{ text: string }>;
  addListener(
    eventName: 'shareReceived',
    listener: (share: NativeShare) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'quickAction',
    listener: (quickAction: NativeQuickActionPayload) => void,
  ): Promise<PluginListenerHandle>;
}

export const ShadowCapture = registerPlugin<ShadowCapturePlugin>('ShadowCapture');
