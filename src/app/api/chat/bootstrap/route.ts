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
  console.log('[bootstrap] === START ===');

  const { error, userId } = await requireSession(req);
  if (error) {
    console.log('[bootstrap] AUTH FAILED');
    return error;
  }

  console.log('[bootstrap] userId:', userId);

  try {
    const shouldTrigger = await shouldTriggerMorningCheckin(userId);

    console.log('[bootstrap] shouldTrigger:', shouldTrigger);

    if (!shouldTrigger) {
      console.log('[bootstrap] returning triggered: false');
      return NextResponse.json({ triggered: false });
    }

    console.log('[bootstrap] calling orchestrate...');

    const result = await orchestrate({
      userId,
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
    });

    console.log('[bootstrap] orchestrate done, threadId:', result.threadId);
    console.log('[bootstrap] assistantMessage:', result.assistantMessage);
    console.log('[bootstrap] quickReplies count:', result.quickReplies?.length ?? 0);

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

  console.log('[bootstrap] now:', now.toISOString(), 'local hour:', now.getHours());

  if (now.getHours() < 5) {
    console.log('[bootstrap] REJECTED: before 5 AM local');
    return false;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  console.log('[bootstrap] startOfDay:', startOfDay.toISOString());

  const existingCheckin = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'morning_checkin',
      startedAt: { gte: startOfDay },
    },
    select: { id: true, startedAt: true },
  });

  console.log('[bootstrap] existingCheckin:', existingCheckin);

  if (existingCheckin) {
    console.log('[bootstrap] REJECTED: checkin thread exists for today');
    return false;
  }

  console.log('[bootstrap] APPROVED: will trigger morning_checkin');
  return true;
}
