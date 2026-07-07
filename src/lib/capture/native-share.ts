/**
 * Task 72 (Slice C) — share nativo Android → contratto share PWA.
 *
 * Il nativo (ShadowCapturePlugin) trasporta il payload; qui si replica 1:1 la
 * semantica del service worker (public/sw.js, share target v12):
 *  - POST /api/tasks { title, status:'inbox', source:'share', sourceRef }
 *    dove l'URL esce dal titolo e va in sourceRef;
 *  - successo  → naviga su /?action=share&saved=1  (banner esistente);
 *  - fallimento → naviga su /?action=share&text=…  (il testo non si perde:
 *    middleware, landing di login e stash sessionStorage esistenti fanno il
 *    round-trip — probe task67).
 * Zero UI nuova: il flusso nativo riusa per intero il reader ?action=share.
 */
import type { NativeShare } from '@/lib/native/capture';

export interface SharePayload {
  /** Titolo del task: testo senza URL, cap 500 (o l'URL se non c'è testo). */
  taskTitle: string;
  /** URL condiviso, o testo integrale (cap 2000) se il titolo è troncato. */
  sourceRef: string;
  /** Testo tutto-unito per il fallback ?text= (stessa forma del SW). */
  fallbackText: string;
}

/** Parte pura, testabile: da EXTRA_SUBJECT/EXTRA_TEXT al payload di ingest. */
export function buildSharePayload(rawTitle?: string | null, rawText?: string | null): SharePayload | null {
  const subject = (rawTitle ?? '').trim();
  const text = (rawText ?? '').trim();
  if (!subject && !text) return null;

  // Android non separa testo e URL (WhatsApp/Chrome li fondono in EXTRA_TEXT):
  // il primo URL diventa sourceRef, il resto resta testo.
  const url = text.match(/https?:\/\/\S+/i)?.[0] ?? '';
  const textWithoutUrl = url ? text.replace(url, '').replace(/\s+/g, ' ').trim() : text;

  const fullText = [subject, textWithoutUrl].filter(Boolean).join(' — ');
  const taskTitle = (fullText || url).slice(0, 500);
  let sourceRef = url;
  if (!sourceRef && fullText.length > 500) sourceRef = fullText.slice(0, 2000);

  const fallbackText = [subject, text].filter(Boolean).join(' — ');
  return { taskTitle, sourceRef, fallbackText };
}

// Dedupe: lo stesso share può arrivare sia come pending (cold start) sia come
// evento retained — un solo POST.
const processedShareIds = new Set<string>();

export async function handleNativeShare(share: NativeShare): Promise<void> {
  if (processedShareIds.has(share.id)) return;
  processedShareIds.add(share.id);

  if (share.type !== 'text') {
    // image/* → OCR (Slice D): instradato da handleNativeImageShare.
    return;
  }

  const payload = buildSharePayload(share.title, share.text);
  if (!payload) return;

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.taskTitle,
        status: 'inbox',
        source: 'share',
        sourceRef: payload.sourceRef,
      }),
    });
    if (res.ok) {
      window.location.assign('/?action=share&saved=1');
      return;
    }
    console.error('[native-share] /api/tasks rispose', res.status);
  } catch (err) {
    console.error('[native-share] errore:', err);
  }
  // Fallimento (401 sessione scaduta, 5xx, rete): stesso contratto del SW —
  // il testo viaggia nell'URL, il middleware lo preserva fino a dopo il login.
  const truncated = payload.fallbackText.length > 500 ? '&truncated=1' : '';
  window.location.assign(
    `/?action=share&text=${encodeURIComponent(payload.fallbackText.slice(0, 500))}${truncated}`,
  );
}
