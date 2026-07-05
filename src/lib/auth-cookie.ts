/**
 * Config del cookie di sessione NextAuth per le route custom.
 *
 * Le route /api/auth/login e /api/auth/register firmano il JWT (next-auth/jwt
 * `encode`) ed emettono il cookie a mano, bypassando `signIn`. DEVONO usare lo
 * STESSO nome che `getToken` (e il resto di NextAuth) si aspetta, altrimenti su
 * https il cookie viene scritto come "next-auth.session-token" mentre getToken
 * cerca "__Secure-next-auth.session-token": il server non vede la sessione →
 * /api/auth/session vuoto, 401 su ogni route protetta, middleware che tratta il
 * cookie come stale e redirige a /?auth=login. In dev (http) i nomi coincidono,
 * quindi il bug è invisibile fino al deploy su https.
 *
 * La rilevazione replica ESATTAMENTE il default di getToken:
 *   secureCookie = NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL
 * così nome e flag `secure` restano allineati in ogni ambiente.
 */
export function sessionCookieConfig(): { name: string; secure: boolean } {
  const useSecureCookies =
    (process.env.NEXTAUTH_URL?.startsWith('https://') ?? !!process.env.VERCEL);
  return {
    name: useSecureCookies
      ? '__Secure-next-auth.session-token'
      : 'next-auth.session-token',
    secure: useSecureCookies,
  };
}
