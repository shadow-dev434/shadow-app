import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAuthSecret } from '@/lib/auth-secret';

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
  const secret = getAuthSecret();
  let token: Awaited<ReturnType<typeof getToken>> = null;
  try {
    token = await getToken({ req, secret });
  } catch {
    token = null;
  }

  const userId = typeof token?.id === 'string' ? token.id : undefined;
  let tourCompleted = Boolean(token?.tourCompleted);
  let onboardingComplete = Boolean(token?.onboardingComplete);
  let consentGiven = Boolean(token?.consentGiven);

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
  // Hotfix #8.4: il JWT può essere stale perché update() di NextAuth
  // non aggiorna sempre il cookie in presenza di service worker. Il DB
  // è la fonte di verità.
  //
  // Storia dei tentativi falliti (vedi docs/tasks/02-onboarding-flow-map.md):
  // 1. #7:    await update() + router.replace('/').        Fallito.
  // 2. #8.1:  window.location.href full reload.            Fallito.
  // 3. #8.2:  DB re-read con `@/lib/db` (Prisma standard). Fallito:
  //           middleware Vercel gira Edge runtime, Prisma standard
  //           crasha silenziosamente catturato dal try/catch.
  // 4. #8.4:  DB re-read con `@/lib/db-edge` (Neon Serverless Driver
  //           via adapter-neon). Prisma client Edge-compatible: fa le
  //           query via HTTP senza query-engine nativo. ✓ Funzionante.
  //
  // Costo: 1 query HTTP a Neon per page request autenticata
  // (~50-150ms su Hobby tier, serverless senza pool persistente).
  // Task 10 può ottimizzare con Vercel KV cache o signed flag cookie
  // custom non intercettato dal service worker di NextAuth.
  //
  // NON applicato alle API routes: la policy lì è "401 se serve
  // sessione", non redirect basato su flag.
  if (userId && !pathname.startsWith('/api/')) {
    try {
      const { dbEdge } = await import('@/lib/db-edge');
      const profile = await dbEdge.userProfile.findUnique({
        where: { userId },
        select: { tourCompleted: true, onboardingComplete: true, consentGivenAt: true },
      });
      tourCompleted = profile?.tourCompleted ?? false;
      onboardingComplete = profile?.onboardingComplete ?? false;
      consentGiven = profile?.consentGivenAt != null;
    } catch (err) {
      // DB unreachable o crash imprevisto dell'adapter: log esplicito
      // per visibilità nei Vercel logs (nel #8.2 l'errore veniva
      // silenziato, mascherando la root cause per ore). Fallback sui
      // valori del token: meglio che bloccare l'utente fuori dall'app.
      console.error('[middleware] DB re-read failed, falling back to JWT:', err);
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
  const isConsentPage = pathname === '/consent';
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

  // JWT presente. Pagine di flow che l'utente deve poter raggiungere per
  // completarle: tour e consenso sono sempre accessibili quando ci si è
  // sopra; /onboarding solo DOPO il consenso, perché la raccolta dei dati
  // di categoria particolare (art. 9) avviene dentro l'onboarding → il
  // gate consenso non dev'essere saltabile via deep-link a /onboarding.
  if (isTourPage || isConsentPage) return NextResponse.next();
  if (isOnboardingPage && consentGiven) return NextResponse.next();

  // Gate sequenziale: tour → consenso → onboarding. Ordine obbligato: il
  // register manda al tour; il consenso deve precedere ogni raccolta di
  // dati sensibili (onboarding) e la prima conversazione (gated a valle).
  if (!tourCompleted) {
    const url = req.nextUrl.clone();
    url.pathname = '/tour';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (!consentGiven) {
    const url = req.nextUrl.clone();
    url.pathname = '/consent';
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
    '/consent',
    '/onboarding',
    '/chat/:path*',
    // Beta (Task 23): admin e questionari passano dal gate auth completo
    // (tour → consenso → onboarding) come ogni page route autenticata.
    '/admin/:path*',
    '/beta/:path*',
    // v3 W7: sessione body doubling (deep-link /focus?taskId=…), stessa
    // policy delle page route autenticate.
    '/focus/:path*',
    // Pubbliche by-design, FUORI dal matcher (stesso pattern di /privacy e
    // /terms): '/reset-password' (Task 28) — ci si arriva dal link email,
    // per definizione senza sessione. NON aggiungerle qui.
  ],
};
