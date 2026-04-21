import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/calendar/oauth/callback — Exchange OAuth code for tokens
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/?action=settings&calendar=error&msg=${encodeURIComponent(error)}`, req.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/?action=settings&calendar=error&msg=no_code', req.url));
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
      return NextResponse.redirect(new URL('/?action=settings&calendar=error&msg=token_exchange_failed', req.url));
    }

    const tokenData = await tokenRes.json();

    // For now, save with a default userId. In production, extract from session.
    const userId = 'default';

    // Upsert calendar token
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

    return NextResponse.redirect(new URL('/?action=settings&calendar=connected', req.url));
  } catch (error) {
    console.error('Calendar OAuth callback error:', error);
    return NextResponse.redirect(new URL('/?action=settings&calendar=error&msg=unknown', req.url));
  }
}
