/**
 * GET /api/chat/threads
 *
 * Task 53 — Archivio chat 24h + sidebar storica (decisione D3).
 *
 * Lista dei thread chat dell'utente per la sidebar storica: il thread attivo di
 * oggi (label "Oggi") + i giorni passati read-only (label "chat del GG/MM/AAAA").
 * Ordinati per startedAt desc, limitati ai THREAD_LIMIT piu' recenti. Vengono
 * mostrati solo i thread con almeno un messaggio user|assistant: gli orfani
 * (thread creato ma nessun turno andato a buon fine) non compaiono.
 *
 * Auth: requireSession (stessa policy di active-thread/bootstrap/turn).
 *
 * Nota matcher: /api/chat/threads* e' gia' coperto dal wildcard '/api/:path*'
 * di middleware.ts — nessuna modifica al matcher necessaria.
 *
 * Response shape:
 *   200 OK, body =
 *     { threads: Array<{
 *         id: string,
 *         mode: string,
 *         state: string,
 *         label: string,        // "Oggi" | "chat del GG/MM/AAAA"
 *         isActive: boolean,    // thread attivo di OGGI (state==='active' && startedAt===oggi-Roma)
 *         startedAt: string,    // ISO 8601
 *         lastTurnAt: string,   // ISO 8601
 *         messageCount: number  // solo user|assistant
 *       }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { threadSidebarLabel } from '@/lib/chat/day-rollover';
import { formatTodayInRome, formatDateInRome } from '@/lib/evening-review/dates';

const THREAD_LIMIT = 60;

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const rows = await db.chatThread.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: THREAD_LIMIT,
      select: {
        id: true,
        mode: true,
        state: true,
        startedAt: true,
        lastTurnAt: true,
        // Conteggio filtrato dei soli messaggi visibili in UI: i thread senza
        // turni reali (system/tool only o vuoti) vengono scartati sotto.
        _count: {
          select: { messages: { where: { role: { in: ['user', 'assistant'] } } } },
        },
      },
    });

    // todayRome calcolato UNA volta e usato per label E isActive, così i due
    // campi restano coerenti. Bug fix: prima isActive era `state === 'active'`
    // (ignora la data) mentre la label considera "Oggi" solo un thread attivo
    // di OGGI; un thread di un giorno precedente rimasto state='active' otteneva
    // label datata ma isActive=true → in ChatView il click cadeva su backToToday()
    // (no-op) invece di aprirlo read-only: "la chat vecchia si vede ma non si apre".
    const todayRome = formatTodayInRome();
    const threads = rows
      .filter((t) => t._count.messages > 0)
      .map((t) => ({
        id: t.id,
        mode: t.mode,
        state: t.state,
        label: threadSidebarLabel(t, todayRome),
        isActive: t.state === 'active' && formatDateInRome(t.startedAt) === todayRome,
        startedAt: t.startedAt.toISOString(),
        lastTurnAt: t.lastTurnAt.toISOString(),
        messageCount: t._count.messages,
      }));

    return NextResponse.json({ threads });
  } catch (err) {
    console.error('[/api/chat/threads] error:', err);
    return NextResponse.json({ error: 'Failed to load threads' }, { status: 500 });
  }
}
