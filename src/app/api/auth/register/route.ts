import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { getAuthSecret } from '@/lib/auth-secret';
import { isBetaTesterEmail } from '@/lib/beta/admin-guard';
import { sessionCookieConfig } from '@/lib/auth-cookie';

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  try {
    const { name, email: rawEmail, password, inviteCode } = await req.json();

    if (!rawEmail || !password) {
      return NextResponse.json({ error: 'Email e password sono obbligatori' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'La password deve essere di almeno 8 caratteri' }, { status: 400 });
    }

    // Task 73 (A): gate opzionale sul signup. Con SIGNUP_INVITE_CODE in env la
    // registrazione richiede il codice distribuito con l'invito; env assente o
    // vuota → flusso aperto come prima (dev/preview/test invariati). Confronto
    // case-insensitive su trim. 403 distinto dal 400 dei campi mancanti.
    const requiredInvite = process.env.SIGNUP_INVITE_CODE?.trim();
    if (requiredInvite) {
      const provided = typeof inviteCode === 'string' ? inviteCode.trim() : '';
      if (provided.toLowerCase() !== requiredInvite.toLowerCase()) {
        return NextResponse.json({ error: 'Codice invito non valido' }, { status: 403 });
      }
    }

    // Normalizza l'email (lowercase + trim) PRIMA del controllo di unicità:
    // l'indice unique di Postgres è case-sensitive, quindi senza questo due
    // varianti di maiuscole (bob@x / Bob@x) coesisterebbero. Oltre all'igiene
    // generale, chiude un'escalation: l'allowlist admin confronta in
    // lowercase, quindi un attaccante non può registrare una variante-case
    // dell'email di un admin. Il login (auth.ts authorize) normalizza uguale.
    const email = String(rawEmail).trim().toLowerCase();

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Email già registrata' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: {
        name: name || email.split('@')[0],
        email,
        password: hashedPassword,
      },
    });

    await db.settings.create({ data: { userId: user.id } });
    await db.userPattern.create({ data: { userId: user.id } });
    await db.userProfile.create({
      data: {
        userId: user.id,
        onboardingComplete: false,
        onboardingStep: 0,
        tourCompleted: false,
        tourStep: 0,
      },
    });

    // ── Create NextAuth-compatible JWT and set cookie (auto-login) ──
    // Flag sempre false al register: il middleware redirige subito a /tour.
    // isBetaTester invece si risolve subito (Task 63, D4): un invitato che si
    // registra deve vedere la strumentazione beta senza rifare login.
    const secret = getAuthSecret();
    const token = await encode({
      token: {
        id: user.id,
        sub: user.id,
        email: user.email,
        name: user.name,
        tourCompleted: false,
        onboardingComplete: false,
        consentGiven: false,
        isBetaTester: isBetaTesterEmail(email),
      },
      secret,
      maxAge: SESSION_MAX_AGE_SEC,
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      isFirstAccess: true,
    });

    // Nome + secure allineati a getToken (prefisso __Secure- su https): senza,
    // su prod il cookie sarebbe invisibile al server → 401 ovunque.
    const cookie = sessionCookieConfig();
    response.cookies.set({
      name: cookie.name,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      secure: cookie.secure,
    });

    return response;
  } catch (error) {
    captureApiError(error, 'POST /api/auth/register');
    return NextResponse.json({ error: 'Errore durante la registrazione' }, { status: 500 });
  }
}