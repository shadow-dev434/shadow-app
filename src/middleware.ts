import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip auth routes and static files
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

  // Extract user ID from JWT if available
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production' });
    const userId = token?.id as string | undefined;

    if (userId) {
      // Add userId to request headers so API routes can use it
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-user-id', userId);
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }
  } catch {
    // No valid token, continue without userId
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
