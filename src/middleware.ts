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
  const tourCompleted = Boolean(token?.tourCompleted);
  const onboardingComplete = Boolean(token?.onboardingComplete);

  // Distinguiamo "nessun cookie" (visitatore fresco) da "cookie presente
  // ma non decodabile" (sessione scaduta). Il primo caso deve vedere la
  // landing, il secondo deve essere redirectato al login con il cookie
  // scaduto ripulito.
  const hasSessionCookie = Boolean(
    req.cookies.get('next-auth.session-token') ||
    req.cookies.get('__Secure-next-auth.session-token')
  );
  const hasStaleSession = hasSessionCookie && !userId;

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
