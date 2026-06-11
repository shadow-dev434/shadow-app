// Alert email ad Antonio per gli eventi beta critici (spec Task 23 §A3).
// Resend via REST puro: nessun SDK (regola "REST via fetch, zero SDK vendor").
// Non lancia mai: un fallimento di invio non deve toccare la risposta utente.

const RESEND_URL = 'https://api.resend.com/emails';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tollerante a virgolette residue, spazi e più destinatari separati da virgola. */
function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export async function sendBetaAlert(subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = parseRecipients(process.env.BETA_ALERT_EMAIL_TO);
  const from = process.env.BETA_ALERT_EMAIL_FROM ?? 'Shadow Beta <onboarding@resend.dev>';

  if (!apiKey || to.length === 0) {
    console.warn('[beta-alert] RESEND_API_KEY/BETA_ALERT_EMAIL_TO assenti: alert non inviato');
    return;
  }
  const invalid = to.filter((t) => !EMAIL_PATTERN.test(t));
  if (invalid.length > 0) {
    // Errore di configurazione (es. placeholder rimasto): meglio un log
    // esplicito che un 422 muto da Resend.
    console.error(
      `[beta-alert] BETA_ALERT_EMAIL_TO contiene ${invalid.length} voce/i che non sono email valide: alert non inviato`
    );
    return;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, text }),
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
