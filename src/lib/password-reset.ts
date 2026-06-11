/**
 * Flusso self-service "password dimenticata" (Task 28,
 * docs/tasks/28-password-reset-self-service.md).
 *
 * Design:
 * - Riusa il modello `VerificationToken` (schema NextAuth già presente):
 *   nessuna migration. `identifier = "password-reset:<email>"` isola questo
 *   flusso da eventuali usi futuri della tabella (es. magic link).
 * - In DB salviamo SOLO lo sha256 del token: un leak del DB non permette di
 *   costruire link di reset validi. Il token in chiaro viaggia solo nell'email.
 * - TTL 60 minuti. Rate limit: max 3 token non scaduti per email — la TTL fa
 *   da finestra, quindi equivale a "max 3 richieste/ora". Oltre il tetto la
 *   richiesta viene ignorata in silenzio: la risposta HTTP resta identica
 *   (anti user-enumeration, vedi route).
 * - Invio email: pattern di src/lib/beta/alert.ts — Resend via REST puro,
 *   nessun SDK, mai throw. Un fallimento di invio non deve cambiare la
 *   risposta dell'endpoint.
 *
 * ⚠️ Resend sandbox: senza dominio verificato consegna solo all'email del
 * titolare dell'account e solo da onboarding@resend.dev. Prima della beta
 * pubblica va verificato un dominio (cfr. spec §Resend).
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

const RESEND_URL = 'https://api.resend.com/emails';
const IDENTIFIER_PREFIX = 'password-reset:';

export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 ora
export const MAX_ACTIVE_RESET_TOKENS = 3; // = max 3 richieste/ora per email

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** sha256 hex del token in chiaro: è ciò che persistiamo in VerificationToken.token. */
export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Link assoluto alla pagina di reset, basato su NEXTAUTH_URL. */
export function buildResetUrl(rawToken: string): string {
  const base = (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function identifierFor(email: string): string {
  return `${IDENTIFIER_PREFIX}${email}`;
}

/**
 * Crea un token di reset per l'email (già normalizzata lowercase+trim).
 * Ritorna il token in chiaro da spedire via email, oppure null se l'email ha
 * già raggiunto il tetto di token attivi (rate limit silenzioso).
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const identifier = identifierFor(email);
  const now = new Date();

  // Igiene: i token scaduti di questa email non servono più a nulla.
  await db.verificationToken.deleteMany({
    where: { identifier, expires: { lt: now } },
  });

  const active = await db.verificationToken.count({
    where: { identifier, expires: { gte: now } },
  });
  if (active >= MAX_ACTIVE_RESET_TOKENS) return null;

  const rawToken = randomBytes(32).toString('base64url');
  await db.verificationToken.create({
    data: {
      identifier,
      token: hashResetToken(rawToken),
      expires: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

/**
 * Valida un token in chiaro. Se valido ritorna l'email associata, altrimenti
 * null. I token scaduti incontrati vengono eliminati.
 * NON consuma il token: il consumo (deleteResetTokensFor) va fatto nella
 * stessa transazione dell'update password, lato route.
 */
export async function validateResetToken(rawToken: string): Promise<string | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const row = await db.verificationToken.findUnique({
    where: { token: hashResetToken(rawToken) },
  });
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  if (row.expires < new Date()) {
    await db.verificationToken.delete({ where: { token: row.token } }).catch(() => {});
    return null;
  }
  return row.identifier.slice(IDENTIFIER_PREFIX.length);
}

/**
 * Brucia tutti i token di reset dell'email. Ritorna la PrismaPromise senza
 * await, così la route può comporla in una $transaction con l'update utente.
 */
export function deleteResetTokensFor(email: string) {
  return db.verificationToken.deleteMany({ where: { identifier: identifierFor(email) } });
}

/** Email mascherata per i log (mai l'indirizzo in chiaro). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain ?? '?'}`;
}

/**
 * Invia l'email col link di reset. Mai throw: errori solo a log (mascherati).
 * Il link/token NON viene mai loggato.
 */
export async function sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.PASSWORD_RESET_EMAIL_FROM ??
    process.env.BETA_ALERT_EMAIL_FROM ??
    'Shadow <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[password-reset] RESEND_API_KEY assente: email non inviata');
    return;
  }

  const url = buildResetUrl(rawToken);
  const subject = 'Shadow — reimposta la tua password';
  const text = [
    'Ciao,',
    '',
    'hai chiesto di reimpostare la password del tuo account Shadow.',
    'Apri questo link per impostarne una nuova (valido per 1 ora):',
    '',
    url,
    '',
    'Se non hai richiesto tu il reset, ignora questa email: la tua password resta invariata.',
    '',
    'Shadow — il tuo executive function esterno',
  ].join('\n');
  const html = [
    '<p>Ciao,</p>',
    '<p>hai chiesto di reimpostare la password del tuo account <strong>Shadow</strong>.</p>',
    `<p><a href="${url}">Imposta una nuova password</a> (il link vale per 1 ora).</p>`,
    '<p>Se non hai richiesto tu il reset, ignora questa email: la tua password resta invariata.</p>',
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
        `[password-reset] invio a ${maskEmail(email)} fallito:`,
        res.status,
        detail.slice(0, 300)
      );
    } else {
      console.log(`[password-reset] email di reset inviata a ${maskEmail(email)}`);
    }
  } catch (err) {
    console.error(`[password-reset] invio a ${maskEmail(email)} fallito:`, err);
  }
}
