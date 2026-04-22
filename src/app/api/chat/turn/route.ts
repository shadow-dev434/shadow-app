/**
 * POST /api/chat/turn
 *
 * Body: { threadId?: string, mode: ChatMode, userMessage: string, relatedTaskId?: string }
 * Response: { threadId, assistantMessage, toolsExecuted, costUsd, ... }
 *
 * Auth: requires NextAuth session cookie. Set by /api/auth/login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { orchestrate, type ChatMode } from '@/lib/chat/orchestrator';

const VALID_MODES: ChatMode[] = [
  'morning_checkin',
  'planning',
  'focus_companion',
  'unblock',
  'evening_review',
  'general',
];

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { threadId, mode, userMessage, relatedTaskId } = body as {
      threadId?: string;
      mode?: string;
      userMessage?: string;
      relatedTaskId?: string;
    };

    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });
    }
    if (userMessage.length > 4000) {
      return NextResponse.json({ error: 'userMessage too long' }, { status: 400 });
    }

    const chatMode: ChatMode = VALID_MODES.includes(mode as ChatMode)
      ? (mode as ChatMode)
      : 'general';

    const result = await orchestrate({
      userId,
      threadId: threadId ?? null,
      mode: chatMode,
      userMessage: userMessage.trim(),
      relatedTaskId: relatedTaskId ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/chat/turn] error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}