// Alert email ad Antonio per gli eventi beta critici (spec Task 23 §A3).
// Resend via REST puro: nessun SDK (regola "REST via fetch, zero SDK vendor").
// Non lancia mai: un fallimento di invio non deve toccare la risposta utente.

const RESEND_URL = 'https://api.resend.com/emails';

export async function sendBetaAlert(subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.BETA_ALERT_EMAIL_TO;
  const from = process.env.BETA_ALERT_EMAIL_FROM ?? 'Shadow Beta <onboarding@resend.dev>';

  if (!apiKey || !to) {
    console.warn('[beta-alert] RESEND_API_KEY/BETA_ALERT_EMAIL_TO assenti: alert non inviato');
    return;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[beta-alert] invio fallito:', res.status, detail.slice(0, 300));
    }
  } catch (err) {
    console.error('[beta-alert] invio fallito:', err);
  }
}
