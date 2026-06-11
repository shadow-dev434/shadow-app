// Shadow Beta — Status del feedback (Task 23 Fase 3)
// GET ?clientDate=YYYY-MM-DD&clientTime=HH:mm → cosa è dovuto oggi
// (pulse serale, weekly, questionari T0/T1). Unico endpoint che guida
// le card beta in ChatView.

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { formatDateInRome } from '@/lib/evening-review/dates';
import { computeBetaStatus } from '@/lib/beta/feedback-status';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Fallback se l'utente non ha Settings: finestra serale ampia, per non
// perdere giorni di raccolta dati in beta.
const DEFAULT_WINDOW = { eveningWindowStart: '18:00', eveningWindowEnd: '23:59' };

const PRE_INSTRUMENTS = ['asrs', 'adexi'] as const;
const POST_INSTRUMENTS = ['asrs', 'adexi', 'sus', 'pgic'] as const;

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const clientDate = req.nextUrl.searchParams.get('clientDate');
    const clientTime = req.nextUrl.searchParams.get('clientTime');

    if (!clientDate || !DATE_PATTERN.test(clientDate) || !clientTime || !TIME_PATTERN.test(clientTime)) {
      return NextResponse.json({ error: 'invalid clientDate/clientTime' }, { status: 400 });
    }

    const [settings, pulseToday, weekly, assessments, firstPulse, user] = await Promise.all([
      db.settings.findFirst({
        where: { userId },
        select: { eveningWindowStart: true, eveningWindowEnd: true },
      }),
      db.betaFeedback.findUnique({
        where: { userId_kind_day: { userId, kind: 'daily_pulse', day: clientDate } },
        select: { id: true },
      }),
      db.betaFeedback.findFirst({
        where: { userId, kind: 'weekly' },
        select: { id: true },
      }),
      db.assessmentResponse.findMany({
        where: { userId },
        select: { instrument: true, wave: true, completedAt: true, administeredAt: true },
      }),
      db.betaFeedback.findFirst({
        where: { userId, kind: 'daily_pulse' },
        orderBy: { day: 'asc' },
        select: { day: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);

    const inEveningWindow = isInsideEveningWindow(clientTime, settings ?? DEFAULT_WINDOW);

    const completed = (instrument: string, wave: string) =>
      assessments.some(
        (a) => a.instrument === instrument && a.wave === wave && a.completedAt !== null
      );
    const preCompleted = PRE_INSTRUMENTS.every((i) => completed(i, 'pre'));
    const postCompleted = POST_INSTRUMENTS.every((i) => completed(i, 'post'));

    // Anchor della timeline beta: T0 completato → primo pulse → creazione utente.
    const completedPre = assessments
      .filter((a) => a.wave === 'pre' && a.completedAt !== null)
      .sort((a, b) => a.administeredAt.getTime() - b.administeredAt.getTime())[0];
    const anchorYMD = completedPre
      ? formatDateInRome(completedPre.administeredAt)
      : firstPulse
        ? firstPulse.day
        : user
          ? formatDateInRome(user.createdAt)
          : null;

    const status = computeBetaStatus({
      clientDate,
      inEveningWindow,
      pulseDoneToday: pulseToday !== null,
      weeklyDone: weekly !== null,
      anchorYMD,
      preCompleted,
      postCompleted,
    });

    return NextResponse.json(status);
  } catch (err) {
    console.error('GET /api/beta/feedback/status error:', err);
    return NextResponse.json({ error: 'Failed to compute status' }, { status: 500 });
  }
}
