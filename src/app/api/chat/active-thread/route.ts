/**
 * GET /api/chat/active-thread
 *
 * Ritorna il ChatThread piu' recente dell'utente corrente con
 * state='active', insieme agli ultimi 200 messaggi visibili all'utente
 * (role='user'|'assistant'), in ordine cronologico ascendente. Usato
 * da ChatView al mount per reidratare la conversazione in corso --
 * senza questo endpoint il client perdeva threadId+messaggi ad ogni
 * remount e ne creava uno nuovo ad ogni sendMessage (Task 3, Step 1
 * post-mortem).
 *
 * Auth: richiede NextAuth session cookie (requireSession).
 *
 * Response shape:
 *   200 OK, body =
 *     { activeThread: null }
 *   oppure
 *     { activeThread: {
 *         threadId: string,
 *         mode: string,
 *         messages: Array<{
 *           id: string,
 *           role: 'user' | 'assistant',
 *           content: string,
 *           createdAt: string  // ISO 8601
 *         }>,
 *         hasMore: boolean  // true se esistono messaggi piu' vecchi
 *                           //   dei 200 restituiti (paginazione in
 *                           //   task futuro)
 *       }
 *     }
 *
 * L'endpoint ritorna al massimo gli ultimi 200 messaggi ordinati
 * cronologicamente ascendente. hasMore: true indica che ne esistono
 * di piu' vecchi: la UI potra' mostrare un affordance "carica
 * messaggi precedenti" in Task futuri, ma la rehydration base del
 * turn corrente e' sempre coperta dagli ultimi 200.
 *
 * I messaggi con role='system' o 'tool' (context LLM interno) sono
 * filtrati server-side: non devono comparire nella UI.
 *
 * Campi ChatMessage fuori dalla shape in questa iterazione:
 * payloadJson (toolsExecuted/quickReplies), modelUsed, tokens*,
 * latencyMs -- non necessari alla rehydration base del thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

const MESSAGE_LIMIT = 200;

interface ActiveThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ActiveThreadPayload {
  threadId: string;
  mode: string;
  messages: ActiveThreadMessage[];
  hasMore: boolean;
}

interface ActiveThreadResponse {
  activeThread: ActiveThreadPayload | null;
}

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const thread = await db.chatThread.findFirst({
      where: { userId, state: 'active' },
      orderBy: { lastTurnAt: 'desc' },
      select: { id: true, mode: true },
    });

    if (!thread) {
      const body: ActiveThreadResponse = { activeThread: null };
      return NextResponse.json(body);
    }

    const rows = await db.chatMessage.findMany({
      where: {
        threadId: thread.id,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_LIMIT + 1,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > MESSAGE_LIMIT;
    const truncated = hasMore ? rows.slice(0, MESSAGE_LIMIT) : rows;

    const messages: ActiveThreadMessage[] = truncated
      .map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      }))
      .reverse();

    const body: ActiveThreadResponse = {
      activeThread: {
        threadId: thread.id,
        mode: thread.mode,
        messages,
        hasMore,
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[/api/chat/active-thread] error:', err);
    return NextResponse.json(
      { error: 'Failed to load active thread' },
      { status: 500 },
    );
  }
}
