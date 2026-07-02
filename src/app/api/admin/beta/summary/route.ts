// Shadow Beta — Admin: riepilogo per la triage giornaliera (Task 23 Fase 2)
// GET: conteggi segnalazioni per stato, engagement, pulse aggregato per
// giorno (ultimi 14), testi frizioni/suggerimenti, questionari completati.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/beta/admin-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { EVENING_EMAIL_FAILED_TYPE } from '@/lib/notifications/internal-types';

const PULSE_NUMERIC_KEYS = ['useful', 'focus', 'control', 'procrastination'] as const;
type PulseKey = (typeof PULSE_NUMERIC_KEYS)[number];

function avg(s: { sum: number; n: number } | undefined): number | null {
  if (!s || s.n === 0) return null;
  return Math.round((s.sum / s.n) * 100) / 100;
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdminSession(req);
  if (error) return error;

  try {
    const now = Date.now();
    const d1 = new Date(now - 24 * 3600 * 1000);
    const d7 = new Date(now - 7 * 24 * 3600 * 1000);
    const d14 = new Date(now - 14 * 24 * 3600 * 1000);

    const [
      totalUsers,
      reportGroups,
      signals1d,
      signals7d,
      threads1d,
      threads7d,
      pulses,
      assessments,
      emailFailures,
    ] = await Promise.all([
      db.user.count(),
      db.bugReport.groupBy({ by: ['status'], _count: { _all: true } }),
      db.learningSignal.findMany({
        where: { createdAt: { gte: d1 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      db.learningSignal.findMany({
        where: { createdAt: { gte: d7 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      db.chatThread.findMany({
        where: { lastTurnAt: { gte: d1 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      db.chatThread.findMany({
        where: { lastTurnAt: { gte: d7 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      db.betaFeedback.findMany({
        where: { kind: 'daily_pulse', createdAt: { gte: d14 } },
        orderBy: { day: 'asc' },
      }),
      db.assessmentResponse.findMany({
        orderBy: { administeredAt: 'desc' },
        take: 200,
        include: { user: { select: { email: true } } },
      }),
      // Task 66 (C1): tracce dei fallimenti email serale (una/utente/giorno,
      // scritte dal cron) — rispondono a "chi non sta ricevendo le email?".
      db.notification.findMany({
        where: { type: EVENING_EMAIL_FAILED_TYPE, createdAt: { gte: d7 } },
        orderBy: { createdAt: 'desc' },
        select: {
          userId: true,
          body: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    const active1d = new Set([
      ...signals1d.map((s) => s.userId),
      ...threads1d.map((t) => t.userId),
    ]).size;
    const active7d = new Set([
      ...signals7d.map((s) => s.userId),
      ...threads7d.map((t) => t.userId),
    ]).size;

    const reports: Record<string, number> = {};
    for (const g of reportGroups) reports[g.status] = g._count._all;

    // Aggregazione pulse per giorno + raccolta testi liberi.
    const byDay = new Map<
      string,
      { count: number; sums: Partial<Record<PulseKey, { sum: number; n: number }>> }
    >();
    const texts: { day: string; friction?: string; suggestion?: string }[] = [];

    for (const p of pulses) {
      let a: Record<string, unknown> = {};
      try {
        a = JSON.parse(p.answers) as Record<string, unknown>;
      } catch {
        // answers corrotto: si conta comunque la risposta
      }
      const entry = byDay.get(p.day) ?? { count: 0, sums: {} };
      entry.count++;
      for (const k of PULSE_NUMERIC_KEYS) {
        const v = Number(a[k]);
        if (Number.isFinite(v) && v >= 1 && v <= 5) {
          const s = entry.sums[k] ?? { sum: 0, n: 0 };
          s.sum += v;
          s.n++;
          entry.sums[k] = s;
        }
      }
      byDay.set(p.day, entry);

      const friction =
        typeof a.friction === 'string' && a.friction.trim() ? a.friction.trim() : undefined;
      const suggestion =
        typeof a.suggestion === 'string' && a.suggestion.trim() ? a.suggestion.trim() : undefined;
      if (friction || suggestion) texts.push({ day: p.day, friction, suggestion });
    }

    const pulseDays = [...byDay.entries()]
      .map(([day, e]) => ({
        day,
        count: e.count,
        avgUseful: avg(e.sums.useful),
        avgFocus: avg(e.sums.focus),
        avgControl: avg(e.sums.control),
        avgProcrastination: avg(e.sums.procrastination),
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // Aggregazione fallimenti email per utente (findMany è createdAt desc:
    // la prima riga vista per utente è la più recente → lastFailedAt/lastDetail).
    const failuresByUser = new Map<
      string,
      { email: string; failCount: number; lastFailedAt: Date; lastDetail: string }
    >();
    for (const f of emailFailures) {
      const cur = failuresByUser.get(f.userId);
      if (cur) {
        cur.failCount++;
      } else {
        failuresByUser.set(f.userId, {
          email: f.user.email,
          failCount: 1,
          lastFailedAt: f.createdAt,
          lastDetail: f.body,
        });
      }
    }

    return NextResponse.json({
      reports,
      engagement: { totalUsers, active1d, active7d },
      eveningEmail: {
        failed7d: emailFailures.length,
        failedUsers: [...failuresByUser.values()].sort(
          (a, b) => b.lastFailedAt.getTime() - a.lastFailedAt.getTime(),
        ),
      },
      pulse: { days: pulseDays, texts: texts.slice(-50) },
      assessments: assessments.map((a) => ({
        id: a.id,
        userEmail: a.user.email,
        instrument: a.instrument,
        wave: a.wave,
        totalScore: a.totalScore,
        completedAt: a.completedAt,
        administeredAt: a.administeredAt,
      })),
    });
  } catch (err) {
    captureApiError(err, 'GET /api/admin/beta/summary');
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
