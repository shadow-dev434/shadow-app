import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ─── Skip list assoluta ──────────────────────────────────────────────
  // NextAuth, OAuth calendar, asset statici: passano sempre senza controllo.
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/calendar/oauth') ||
    pathname === '/api/route.ts' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.woff2') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // ─── Lettura JWT ─────────────────────────────────────────────────────
  // Se il token è assente o scaduto, getToken ritorna null e non lancia.
  let token: Awaited<ReturnType<typeof getToken>> = null;
  try {
    token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production',
    });
  } catch {
    token = null;
  }

  const userId = typeof token?.id === 'string' ? token.id : undefined;
  let tourCompleted = Boolean(token?.tourCompleted);
  let onboardingComplete = Boolean(token?.onboardingComplete);

  // Distinguiamo "nessun cookie" (visitatore fresco) da "cookie presente
  // ma non decodabile" (sessione scaduta). Il primo caso deve vedere la
  // landing, il secondo deve essere redirectato al login con il cookie
  // scaduto ripulito.
  const hasSessionCookie = Boolean(
    req.cookies.get('next-auth.session-token') ||
    req.cookies.get('__Secure-next-auth.session-token')
  );
  const hasStaleSession = hasSessionCookie && !userId;

  // ─── DB re-read dei flag onboarding per page routes autenticate ──────
  // Hotfix #8.2: in produzione update() di NextAuth non aggiorna sempre
  // il cookie JWT quando un service worker (/sw.js) è attivo —
  // probabilmente intercetta la request a /api/auth/session. Verifica
  // binary-diff del cookie pre/post update() mostra 0 bytes di
  // differenza. Risultato: il JWT resta stale anche dopo PATCH riuscito
  // al DB, il middleware redirige in loop al flow step già completato.
  //
  // Fix: ignoriamo i flag del token per le page routes e li rileggiamo
  // dal DB, che è la fonte di verità. Costo: 1 query Neon extra per
  // page request autenticata (~100-300ms su Hobby plan, accettabile per
  // beta 20-100 utenti). Task 10 sostituirà con cache in-memory o
  // signed flag cookie gestito da noi invece che da NextAuth.
  //
  // NON applicato alle API routes: la policy lì è "401 se serve
  // sessione", non redirect basato su flag.
  if (userId && !pathname.startsWith('/api/')) {
    try {
      const { db } = await import('@/lib/db');
      const profile = await db.userProfile.findUnique({
        where: { userId },
        select: { tourCompleted: true, onboardingComplete: true },
      });
      tourCompleted = profile?.tourCompleted ?? false;
      onboardingComplete = profile?.onboardingComplete ?? false;
    } catch {
      // DB unreachable: fallback sui valori del token, meglio che
      // bloccare l'utente fuori dall'app per un glitch transiente.
    }
  }

  // ─── API routes ──────────────────────────────────────────────────────
  // Comportamento preservato: forward di x-user-id se autenticato,
  // nessun redirect (le API rispondono 401 se serve sessione).
  if (pathname.startsWith('/api/')) {
    if (userId) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-user-id', userId);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return NextResponse.next();
  }

  // ─── Page routes ─────────────────────────────────────────────────────
  // '/' è semi-pubblica: senza JWT mostra la landing (login/register),
  // con JWT mostra la chat. Le altre page route sono tutte autenticate.
  // Questa distinzione è l'unica particolarità del matcher: documentata
  // in docs/tasks/02-onboarding-flow-map.md (decisione D8).
  const isHome = pathname === '/';
  const isTourPage = pathname === '/tour';
  const isOnboardingPage = pathname === '/onboarding';

  if (!userId) {
    // Sessione scaduta: redirigi al login e pulisci il cookie stale anche
    // se la request era su '/', per evitare che il client continui a
    // presentare un token morto ad ogni navigazione.
    if (hasStaleSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      url.searchParams.set('auth', 'login');
      const response = NextResponse.redirect(url);
      response.cookies.delete('next-auth.session-token');
      response.cookies.delete('__Secure-next-auth.session-token');
      return response;
    }
    // No cookie: landing '/' è aperta, tutto il resto redirige al login.
    if (isHome) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    url.searchParams.set('auth', 'login');
    return NextResponse.redirect(url);
  }

  // JWT presente. Se l'utente è già sulla pagina del flow di cui ha
  // bisogno, passa (evita loop redirect durante tour/onboarding).
  if (isTourPage || isOnboardingPage) return NextResponse.next();

  // Gate: prima il tour, poi l'onboarding. Ordine obbligato perché il
  // register manda sempre al tour, poi all'onboarding.
  if (!tourCompleted) {
    const url = req.nextUrl.clone();
    url.pathname = '/tour';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (!onboardingComplete) {
    const url = req.nextUrl.clone();
    url.pathname = '/onboarding';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Utente completamente configurato: passa.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/',
    '/tasks/:path*',
    '/tour',
    '/onboarding',
    '/chat/:path*',
  ],
};
