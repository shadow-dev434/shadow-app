import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/streaks — Get streak data for visualization
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId') || undefined;
    const days = parseInt(url.searchParams.get('days') || '30');

    const streaks = await db.streak.findMany({
      where: userId ? { userId } : {},
      orderBy: { date: 'desc' },
      take: days,
    });

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date().toISOString().split('T')[0];
    const sortedStreaks = [...streaks].sort((a, b) => b.date.localeCompare(a.date));

    for (const s of sortedStreaks) {
      if (s.tasksCompleted > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Generate date-based map for the chart
    const streakMap: Record<string, { completed: number; planned: number; rate: number }> = {};
    for (const s of streaks) {
      streakMap[s.date] = {
        completed: s.tasksCompleted,
        planned: s.tasksPlanned,
        rate: s.completionRate,
      };
    }

    // Fill in missing dates with zeros
    const result: Array<{ date: string; completed: number; planned: number; rate: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        ...(streakMap[dateStr] || { completed: 0, planned: 0, rate: 0 }),
      });
    }

    // Get patterns for overall streak
    const patterns = await db.userPattern.findFirst({
      where: userId ? { userId } : {},
    });

    return NextResponse.json({
      currentStreak,
      bestStreak: patterns?.streakDays || currentStreak,
      streakData: result,
      totalCompleted: patterns?.totalTasksCompleted || 0,
      totalAvoided: patterns?.totalTasksAvoided || 0,
    });
  } catch (error) {
    console.error('Streaks fetch error:', error);
    return NextResponse.json({ error: 'Errore nel caricamento streak' }, { status: 500 });
  }
}

// POST /api/streaks — Record daily streak data (called by review save)
export async function POST(req: NextRequest) {
  try {
    const { userId, date, tasksCompleted, tasksPlanned } = await req.json();

    if (!date) {
      return NextResponse.json({ error: 'Data obbligatoria' }, { status: 400 });
    }

    const completionRate = tasksPlanned > 0 ? tasksCompleted / tasksPlanned : 0;

    const streak = await db.streak.upsert({
      where: {
        userId_date: { userId: userId || 'default', date },
      },
      update: {
        tasksCompleted,
        tasksPlanned,
        completionRate,
      },
      create: {
        userId: userId || 'default',
        date,
        tasksCompleted,
        tasksPlanned,
        completionRate,
      },
    });

    // Update user pattern streak
    // Check if yesterday had activity to continue streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const yesterdayStreak = await db.streak.findUnique({
      where: { userId_date: { userId: userId || 'default', date: yesterdayStr } },
    });

    const patterns = await db.userPattern.findFirst({
      where: userId ? { userId } : {},
    });

    if (patterns) {
      const newStreak = tasksCompleted > 0
        ? (yesterdayStreak && yesterdayStreak.tasksCompleted > 0 ? patterns.streakDays + 1 : 1)
        : 0;

      await db.userPattern.update({
        where: { id: patterns.id },
        data: {
          streakDays: Math.max(newStreak, patterns.streakDays),
          lastActiveDate: date,
          totalTasksCompleted: patterns.totalTasksCompleted + tasksCompleted,
        },
      });
    }

    return NextResponse.json({ streak });
  } catch (error) {
    console.error('Streak save error:', error);
    return NextResponse.json({ error: 'Errore nel salvataggio streak' }, { status: 500 });
  }
}
