/**
 * POST /api/chat/bootstrap
 *
 * Called by the ChatView on mount. Decides whether to trigger a
 * scheduled conversation (e.g. morning_checkin) or return null to
 * let the user start in general mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { orchestrate } from '@/lib/chat/orchestrator';

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    // Guard C2: se esiste gia' un ChatThread con state='active' per
    // l'utente (tipicamente un thread di planning lasciato aperto
    // ieri sera), non avviare un nuovo morning check-in: il client
    // riapre quel thread via GET /api/chat/active-thread al mount.
    // Senza questo guard avremmo due thread active simultanei per
    // lo stesso utente (race tra bootstrap e active-thread rehydration).
    //
    // NOTA: la transizione active->completed/archived non e' ancora
    // automatica (prevista in Task 5 - review serale). Finche' non e'
    // implementata, il primo thread dell'utente resta 'active'
    // indefinitamente: il morning check-in si triggera solo al primo
    // accesso di sempre, poi viene skippato dal guard. Trade-off
    // accettato consapevolmente per la beta.
    const activeThread = await db.chatThread.findFirst({
      where: { userId, state: 'active' },
      select: { id: true },
    });

    if (activeThread) {
      console.log('[bootstrap] skip: active thread exists', {
        userId,
        threadId: activeThread.id,
      });
      return NextResponse.json({
        triggered: false,
        reason: 'active_thread_exists',
      });
    }

    const shouldTrigger = await shouldTriggerMorningCheckin(userId);

    if (!shouldTrigger) {
      return NextResponse.json({ triggered: false });
    }

    const result = await orchestrate({
      userId,
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
    });

    return NextResponse.json({
      triggered: true,
      ...result,
    });
  } catch (err) {
    console.error('[bootstrap] ERROR:', err);
    return NextResponse.json({ triggered: false });
  }
}

async function shouldTriggerMorningCheckin(userId: string): Promise<boolean> {
  const now = new Date();

  if (now.getHours() < 5) {
    return false;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const existingCheckin = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'morning_checkin',
      startedAt: { gte: startOfDay },
    },
    select: { id: true, startedAt: true },
  });

  if (existingCheckin) {
    return false;
  }

  return true;
}
