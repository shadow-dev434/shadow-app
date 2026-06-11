// Shadow Beta — Feedback API (Task 23 Fase 3, spec §B2-B4)
// POST: salva daily_pulse / weekly / final. Idempotente sulla unique
// (userId, kind, day): un retry offline o un double-tap non duplicano.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

const KINDS = new Set(['daily_pulse', 'weekly', 'final', 'baseline']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ANSWERS_CHARS = 16_000;

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { kind, day, answers, version } = body ?? {};

    if (typeof kind !== 'string' || !KINDS.has(kind)) {
      return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
    }
    if (typeof day !== 'string' || !DATE_PATTERN.test(day)) {
      return NextResponse.json({ error: 'invalid day' }, { status: 400 });
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return NextResponse.json({ error: 'answers object is required' }, { status: 400 });
    }

    const answersJson = JSON.stringify(answers);
    if (answersJson.length > MAX_ANSWERS_CHARS) {
      return NextResponse.json({ error: 'answers too large' }, { status: 400 });
    }

    try {
      const feedback = await db.betaFeedback.create({
        data: {
          userId,
          kind,
          day,
          version: typeof version === 'string' ? version.slice(0, 10) : 'v1',
          answers: answersJson,
        },
      });
      return NextResponse.json({ feedback: { id: feedback.id, kind, day } });
    } catch (err) {
      // P2002 = unique violata: risposta già registrata per (kind, day).
      // Idempotente by design: 200 senza riscrivere (la prima risposta vince).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ feedback: null, duplicate: true });
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/beta/feedback error:', err);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}
