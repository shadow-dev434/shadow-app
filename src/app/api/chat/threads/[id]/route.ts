/**
 * GET /api/chat/threads/[id]
 *
 * Task 53 — messaggi di un thread archiviato (sidebar storica, read-only).
 *
 * Ritorna i messaggi user|assistant di un thread in ordine cronologico
 * ascendente, piu' i metadati del thread per l'header read-only della vista
 * storica ("chat del GG/MM/AAAA"). I messaggi system/tool (context LLM interno)
 * sono filtrati server-side, come in active-thread.
 *
 * Read-only by design: questo endpoint NON riapre il thread per scriverci
 * (preserva l'invariante "un solo thread attivo", Guard C2). La UI mostra i
 * messaggi senza composer.
 *
 * Auth: requireSession + ownership (thread.userId === userId, altrimenti 404 —
 * stesso pattern di /api/tasks/[id]).
 *
 * Response shape:
 *   200 OK, body =
 *     { thread: { id, mode, state, label, isActive, startedAt, lastTurnAt },
 *       messages: Array<{ id, role: 'user'|'assistant', content, createdAt }> }
 *   404 se il thread non esiste o non appartiene all'utente.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { threadSidebarLabel } from '@/lib/chat/day-rollover';

const MESSAGE_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;

    const thread = await db.chatThread.findFirst({
      where: { id, userId },
      select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true },
    });
    if (!thread) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db.chatMessage.findMany({
      where: { threadId: thread.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      take: MESSAGE_LIMIT,
      select: { id: true, role: true, content: true, createdAt: true },
    });

    const messages = rows.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

    return NextResponse.json({
      thread: {
        id: thread.id,
        mode: thread.mode,
        state: thread.state,
        label: threadSidebarLabel(thread),
        isActive: thread.state === 'active',
        startedAt: thread.startedAt.toISOString(),
        lastTurnAt: thread.lastTurnAt.toISOString(),
      },
      messages,
    });
  } catch (err) {
    console.error('[/api/chat/threads/[id]] error:', err);
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 });
  }
}
