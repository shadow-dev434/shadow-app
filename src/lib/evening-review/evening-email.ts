/**
 * Task 58 — Promemoria review serale via email (ponte beta).
 *
 * Invio del sollecito "è ora della review serale" quando l'utente non ha l'app
 * aperta. Riusa il pattern di src/lib/beta/alert.ts e src/lib/password-reset.ts:
 * Resend via REST puro (nessun SDK, regola CLAUDE.md #3), timeout 5s, MAI throw.
 *
 * A differenza di quei due, ritorna l'esito ({ ok, detail }): il cron lo usa
 * per contare i fallimenti, scrivere il marcatore anti-duplicato SOLO sugli
 * invii andati a buon fine (un invio fallito non segna "inviato oggi" → niente
 * falso skip) e tracciare il motivo del fallimento per l'admin (Task 66 C1).
 *
 * ⚠️ Resend sandbox: senza dominio verificato consegna solo all'email del
 * titolare dell'account e solo da onboarding@resend.dev (cfr. nota in
 * password-reset.ts). Per i tester serve un dominio verificato + EVENING_EMAIL_FROM.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** Email mascherata per i log (mai l'indirizzo in chiaro). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain ?? '?'}`;
}

export interface EveningEmailResult {
  ok: boolean;
  /** Motivo sintetico del fallimento: config mancante, status HTTP + estratto risposta, o errore di rete. */
  detail?: string;
}

/**
 * Invia il promemoria della review serale. Ritorna { ok: true } se Resend ha
 * accettato l'invio, { ok: false, detail } altrimenti (config mancante, errore
 * HTTP, timeout). Mai throw.
 */
export async function sendEveningReviewEmail(email: string): Promise<EveningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EVENING_EMAIL_FROM ??
    process.env.BETA_ALERT_EMAIL_FROM ??
    'Shadow <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[evening-email] RESEND_API_KEY assente: email non inviata');
    return { ok: false, detail: 'RESEND_API_KEY assente' };
  }

  const base = (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const url = `${base}/`;
  const subject = 'Shadow — è ora della review serale';
  // Opt-out (B4): l'utente disattiva il promemoria dal toggle notifiche nelle
  // impostazioni dell'app (PATCH /api/settings notificationsEnabled=false).
  const unsubText = 'Per non ricevere più questi promemoria, disattiva le notifiche nelle impostazioni di Shadow.';
  const text = [
    'Ciao,',
    '',
    'è la tua finestra serale: 10 minuti per chiudere la giornata e preparare domani con la review.',
    'Apri Shadow quando vuoi:',
    '',
    url,
    '',
    'Se stasera non te la senti, va bene così — la ritrovi domani.',
    '',
    unsubText,
    '',
    'Shadow — il tuo executive function esterno',
  ].join('\n');
  const html = [
    '<p>Ciao,</p>',
    '<p>è la tua finestra serale: 10 minuti per chiudere la giornata e preparare domani con la <strong>review</strong>.</p>',
    `<p><a href="${url}">Apri Shadow</a></p>`,
    '<p>Se stasera non te la senti, va bene così — la ritrovi domani.</p>',
    `<p style="color:#888;font-size:12px">${unsubText}</p>`,
    '<p style="color:#888;font-size:12px">Shadow — il tuo executive function esterno</p>',
  ].join('');
  // List-Unsubscribe: in assenza di un endpoint one-click, puntiamo all'email
  // del titolare beta (se configurata) come canale di disiscrizione richiesto.
  const unsubTo = process.env.BETA_ALERT_EMAIL_TO?.split(',')[0]?.trim();

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text,
        html,
        ...(unsubTo ? { headers: { 'List-Unsubscribe': `<mailto:${unsubTo}?subject=unsubscribe>` } } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        `[evening-email] invio a ${maskEmail(email)} fallito:`,
        res.status,
        detail.slice(0, 300),
      );
      return { ok: false, detail: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    console.log(`[evening-email] promemoria inviato a ${maskEmail(email)}`);
    return { ok: true };
  } catch (err) {
    console.error(`[evening-email] invio a ${maskEmail(email)} fallito:`, err);
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
