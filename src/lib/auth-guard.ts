/**
 * Auth guard helper for API routes.
 *
 * Reads the NextAuth JWT directly from cookies — more reliable than
 * getServerSession() in App Router routes.
 *
 * Task 63 (S2-PRIV1): oltre alla sessione, il guard applica il consenso.
 * La revoca (art. 7(3) GDPR) scrive solo il DB mentre il cookie JWT resta
 * valido 30 giorni: la fonte di verità è quindi il DB a ogni request.
 * Default: consenso obbligatorio → 403 `consent_required` (+ header
 * `x-consent-required: 1` così il client discrimina senza leggere il body).
 * `allowWithoutConsent` è riservato a: diritti GDPR (consent, delete account,
 * export) e flusso pre-consenso (PATCH profile dal tour). Fail-closed:
 * profilo assente ⇒ consenso assente.
 *
 * Task 65 (C2/§6.8, ADV-delete): il guard verifica anche che l'utente ESISTA
 * ancora. Dopo il delete account il JWT resta valido fino a scadenza (30gg)
 * su altri device/tab: senza questo check la "sessione fantasma" passava (o
 * prendeva un 403 consenso fuorviante). Utente assente ⇒ 401 `session_invalid`
 * — apiFetch lato client re-logga su qualunque 401. Stessa query del consenso
 * (User + profile innestato): costo netto zero per le route consent-gated,
 * +1 query leggera per le poche `allowWithoutConsent`.
 *
 * Task 66 (D): stessa query, un campo in più — un token con iat precedente a
 * User.passwordChangedAt è revocato (401 `session_invalid`): il reset password
 * chiude le sessioni aperte su altri device invece di lasciarle vive 30gg.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAuthSecret } from '@/lib/auth-secret';
import { db } from '@/lib/db';

export type AuthGuardResult =
  | { error: NextResponse; userId: null; consentGiven?: undefined }
  | { error: null; userId: string; consentGiven: boolean };

export interface RequireSessionOptions {
  /**
   * Salta il 403 per consenso mancante. Il chiamante riceve comunque
   * `consentGiven` per decisioni fini (es. campo-limit del PATCH profile).
   */
  allowWithoutConsent?: boolean;
}

/**
 * Task 66 (D) / Task 69 (H, N21): un token con iat precedente all'ultimo
 * cambio password è revocato. iat è in secondi (floor): il confronto in
 * secondi fa sopravvivere un token emesso nello stesso secondo del cambio —
 * il flusso legittimo (reset da non autenticato → login subito dopo) non può
 * produrne uno più vecchio. iat assente su un token firmato da noi non
 * accade: in quel caso non si revoca. Condivisa con admin-guard (il collaudo
 * 68 ha mostrato che le guard admin/beta non revocavano le sessioni pre-reset).
 */
export function isTokenIssuedBeforePasswordChange(
  iat: number | null,
  passwordChangedAt: Date | null,
): boolean {
  return (
    passwordChangedAt != null &&
    iat != null &&
    iat < Math.floor(passwordChangedAt.getTime() / 1000)
  );
}

export async function requireSession(
  req?: NextRequest,
  options: RequireSessionOptions = {},
): Promise<AuthGuardResult> {
  // getToken() reads the JWT from the session cookie directly.
  // It needs the request object, so we pass it when available.
  const token = req
    ? await getToken({ req, secret: getAuthSecret() })
    : null;

  const userId =
    token && typeof token.id === 'string'
      ? token.id
      : token && typeof token.sub === 'string'
        ? token.sub
        : null;

  if (!userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
    };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      passwordChangedAt: true,
      profile: { select: { consentGivenAt: true } },
    },
  });

  if (!user) {
    return {
      error: NextResponse.json({ error: 'session_invalid' }, { status: 401 }),
      userId: null,
    };
  }

  // Task 66 (D): token emesso prima dell'ultimo cambio password ⇒ revocato.
  const iat = token && typeof token.iat === 'number' ? token.iat : null;
  if (isTokenIssuedBeforePasswordChange(iat, user.passwordChangedAt)) {
    return {
      error: NextResponse.json({ error: 'session_invalid' }, { status: 401 }),
      userId: null,
    };
  }

  // Fail-closed come hasGivenConsent: profilo assente ⇒ consenso assente.
  const consentGiven = user.profile?.consentGivenAt != null;
  if (!consentGiven && !options.allowWithoutConsent) {
    const res = NextResponse.json({ error: 'consent_required' }, { status: 403 });
    res.headers.set('x-consent-required', '1');
    return { error: res, userId: null };
  }

  return { error: null, userId, consentGiven };
}
