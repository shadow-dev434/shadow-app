import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { CALENDAR_OAUTH_STATE_COOKIE } from '@/lib/calendar/oauth-state';

// GET /api/calendar/oauth/callback — Exchange OAuth code for tokens
export async function GET(req: NextRequest) {
  // La session NextAuth deve già esistere (l'utente ha cliccato "Connetti
  // Calendar" essendo loggato). Se non c'è, NON creiamo un utente nuovo:
  // redirect a login e segnalazione.
  const { error, userId } = await requireSession(req);
  if (error) {
    return NextResponse.redirect(new URL('/?auth=login&calendar=error&msg=no_session', req.url));
  }

  // Task 71 (L/N60): il cookie state è one-shot — qualunque esito della
  // callback lo consuma (maxAge 0), così un redirect riusato non rigioca.
  const redirectClearingState = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.set(CALENDAR_OAUTH_STATE_COOKIE, '', { path: '/api/calendar/oauth', maxAge: 0 });
    return res;
  };

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error');

    // Task 71 (L/N60): verifica anti-CSRF PRIMA di ogni altra cosa — senza
    // state un attaccante può far agganciare all'account della vittima un
    // calendar token proprio. Il confronto è col cookie httpOnly settato dal
    // redirect di partenza (/api/calendar/oauth).
    const stateParam = url.searchParams.get('state');
    const stateCookie = req.cookies.get(CALENDAR_OAUTH_STATE_COOKIE)?.value;
    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return redirectClearingState('/?action=settings&calendar=error&msg=state_mismatch');
    }

    if (oauthError) {
      return redirectClearingState(`/?action=settings&calendar=error&msg=${encodeURIComponent(oauthError)}`);
    }

    if (!code) {
      return redirectClearingState('/?action=settings&calendar=error&msg=no_code');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/calendar/oauth/callback`
      : 'http://localhost:3000/api/calendar/oauth/callback';

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errData = await tokenRes.text();
      console.error('Token exchange failed:', errData);
      return redirectClearingState('/?action=settings&calendar=error&msg=token_exchange_failed');
    }

    const tokenData = await tokenRes.json();

    // Upsert calendar token associato all'utente reale (non più 'default')
    const existing = await db.calendarToken.findFirst({ where: { userId } });

    if (existing) {
      await db.calendarToken.update({
        where: { id: existing.id },
        data: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || existing.refreshToken,
          expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
          scope: tokenData.scope || existing.scope,
        },
      });
    } else {
      await db.calendarToken.create({
        data: {
          userId,
          provider: 'google',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || '',
          expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
          scope: tokenData.scope || '',
        },
      });
    }

    return redirectClearingState('/?action=settings&calendar=connected');
  } catch (error) {
    captureApiError(error, 'GET /api/calendar/oauth/callback');
    return redirectClearingState('/?action=settings&calendar=error&msg=unknown');
  }
}
