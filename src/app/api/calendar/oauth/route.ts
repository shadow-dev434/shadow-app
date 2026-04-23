import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';

// GET /api/calendar/oauth — Redirect to Google OAuth consent screen
export async function GET(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) {
    // Navigazione top-level: rimanda al login invece di restituire JSON 401
    return NextResponse.redirect(new URL('/?auth=login', req.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const redirectUri = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/api/calendar/oauth/callback`
    : 'http://localhost:3000/api/calendar/oauth/callback';

  if (!clientId) {
    return NextResponse.json(
      { error: 'Google Client ID non configurato. Imposta GOOGLE_CLIENT_ID nelle variabili ambiente.' },
      { status: 500 }
    );
  }

  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
