/**
 * GET /api/chat/evening-signal
 *
 * Bug fix (recidiva "banner review serale non parte dopo le 20:00"): segnale
 * read-only per il polling client. ChatView lo interroga al mount, ogni ~60s e
 * su visibilitychange — così card/banner della review serale compaiono quando
 * l'orologio entra nella finestra serale ANCHE se l'app è rimasta aperta
 * (PWA/TWA o tab) da prima delle 20:00, senza un remount che rifaccia
 * GET /api/chat/active-thread.
 *
 * A differenza di /api/chat/active-thread NON tocca lo stato dei thread (niente
 * normalize/rollover/8c): puro computeEveningReviewSignal, sicuro da chiamare ad
 * alta frequenza.
 *
 * Auth: requireSession (stessa policy di active-thread/threads/turn).
 *
 * Nota matcher: coperto dal wildcard '/api/:path*' di middleware.ts — nessuna
 * modifica al matcher necessaria.
 *
 * Query params:
 *   ?clientTime=HH:MM       ora locale del client
 *   ?clientDate=YYYY-MM-DD   data locale del client
 *   (entrambi necessari; mancanti/malformati ⇒ shouldStart:false)
 *
 * Response: 200 OK, body = { shouldStart: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { computeEveningReviewSignal } from '@/lib/evening-review/compute-signal';

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const clientTime = req.nextUrl.searchParams.get('clientTime');
    const clientDate = req.nextUrl.searchParams.get('clientDate');
    const signal = await computeEveningReviewSignal(userId, clientTime, clientDate);
    return NextResponse.json(signal);
  } catch (err) {
    console.error('[/api/chat/evening-signal] error:', err);
    return NextResponse.json({ shouldStart: false }, { status: 500 });
  }
}
