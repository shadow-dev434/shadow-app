import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { getAuthSecret } from '@/lib/auth-secret';
import { isLoginLocked, recordLoginFailure, clearLoginFailures } from '@/lib/login-throttle';

const SESSION_COOKIE_NAME = 'next-auth.session-token';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const secret = getAuthSecret();
  try {
    const { email: rawEmail, password } = await req.json();
    if (!rawEmail || !password) {
      return NextResponse.json({ error: 'Email e password sono obbligatori' }, { status: 400 });
    }
    const email = String(rawEmail).trim().toLowerCase();

    // Throttle brute-force (audit pre-beta). Fail-open sulla lettura: un errore
    // DB non deve impedire il login legittimo.
    try {
      if (await isLoginLocked(email)) {
        return NextResponse.json(
          { error: 'Troppi tentativi falliti. Riprova tra qualche minuto.' },
          { status: 429 },
        );
      }
    } catch (err) {
      console.error('[login] isLoginLocked failed, fail-open:', err);
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      // Stesso messaggio generico per utente inesistente e account senza password
      // (anti-enumeration); entrambi contano come tentativo fallito.
      await recordLoginFailure(email).catch(() => {});
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await recordLoginFailure(email).catch(() => {});
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    // Login riuscito: azzera i tentativi falliti.
    await clearLoginFailures(email).catch(() => {});

    const profile = await db.userProfile.findUnique({
      where: { userId: user.id },
    });
    const isFirstAccess = !profile || (!profile.tourCompleted && !profile.onboardingComplete);

    // ── Create NextAuth-compatible JWT and set it as cookie ──
    // NB: questo endpoint custom bypassa la callback jwt di NextAuth, quindi
    // i flag onboarding devono essere iniettati qui nei claim, altrimenti
    // il middleware li leggerebbe come undefined → utente redirect a /tour
    // anche se ha già completato tutto.
    const token = await encode({
      token: {
        id: user.id,
        sub: user.id,
        email: user.email,
        name: user.name,
        tourCompleted: profile?.tourCompleted ?? false,
        onboardingComplete: profile?.onboardingComplete ?? false,
      },
      secret,
      maxAge: SESSION_MAX_AGE_SEC,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      isFirstAccess,
      profile: profile ? {
        onboardingComplete: profile.onboardingComplete,
        tourCompleted: profile.tourCompleted,
      } : null,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    captureApiError(error, 'POST /api/auth/login');
    return NextResponse.json({ error: 'Errore durante il login' }, { status: 500 });
  }
}