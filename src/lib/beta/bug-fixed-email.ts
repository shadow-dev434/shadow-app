/**
 * Task 66 (C2) — email al tester quando la sua segnalazione passa a "fixed".
 *
 * Chiude il feedback loop beta anche ad app chiusa: il toast client di
 * BugReportDialog ("Segnalazione risolta 🎉") copre solo la riapertura
 * dell'app ed è per-device. Stesso pattern REST di evening-email.ts /
 * alert.ts: Resend via fetch puro (nessun SDK), timeout 5s, MAI throw.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** Email mascherata per i log (mai l'indirizzo in chiaro). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain ?? '?'}`;
}

/** La description è testo libero del tester: va neutralizzata nell'HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Invia al tester la notizia che la sua segnalazione è stata sistemata.
 * Ritorna true se Resend ha accettato l'invio, false altrimenti. Mai throw.
 */
export async function sendBugFixedEmail(
  email: string,
  bug: { description: string },
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EVENING_EMAIL_FROM ??
    process.env.BETA_ALERT_EMAIL_FROM ??
    'Shadow <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[bug-fixed-email] RESEND_API_KEY assente: email non inviata');
    return false;
  }

  const base = (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const url = `${base}/`;
  const excerpt =
    bug.description.length > 120 ? `${bug.description.slice(0, 120)}…` : bug.description;
  const subject = 'Shadow — la tua segnalazione è stata sistemata 🎉';
  const text = [
    'Ciao,',
    '',
    'il bug che avevi segnalato è stato sistemato:',
    '',
    `«${excerpt}»`,
    '',
    `La correzione è già attiva (o arriva col prossimo aggiornamento): ${url}`,
    '',
    'Grazie: ogni segnalazione rende Shadow migliore per tutti.',
    '',
    'Shadow — il tuo executive function esterno',
  ].join('\n');
  const html = [
    '<p>Ciao,</p>',
    '<p>il bug che avevi segnalato è stato <strong>sistemato</strong>:</p>',
    `<blockquote style="color:#555;border-left:3px solid #d97706;padding-left:8px">${escapeHtml(excerpt)}</blockquote>`,
    `<p>La correzione è già attiva (o arriva col prossimo aggiornamento): <a href="${url}">apri Shadow</a>.</p>`,
    '<p>Grazie: ogni segnalazione rende Shadow migliore per tutti.</p>',
    '<p style="color:#888;font-size:12px">Shadow — il tuo executive function esterno</p>',
  ].join('');

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        `[bug-fixed-email] invio a ${maskEmail(email)} fallito:`,
        res.status,
        detail.slice(0, 300),
      );
      return false;
    }
    console.log(`[bug-fixed-email] notifica fixed inviata a ${maskEmail(email)}`);
    return true;
  } catch (err) {
    console.error(`[bug-fixed-email] invio a ${maskEmail(email)} fallito:`, err);
    return false;
  }
}
