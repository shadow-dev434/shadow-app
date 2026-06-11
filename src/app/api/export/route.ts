import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

export const maxDuration = 60;

// GET /api/export?format=csv|json
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';

    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        settings: true,
        tasks: true,
        contacts: true,
        streaks: true,
        notifications: true,
        patterns: true,
        adaptiveProfile: true,
        learningSignals: true,
        microFeedbacks: true,
        memories: true,
        strictModeSessions: true,
        chatThreads: { include: { messages: true } },
        reviews: { include: { tasks: true } },
        dailyPlans: { include: { tasks: true } },
        calendarTokens: {
          select: { id: true, provider: true, scope: true, expiresAt: true, createdAt: true },
        },
        // Beta (Task 23)
        bugReports: true,
        betaFeedbacks: true,
        assessmentResponses: true,
        // Esclusi di proposito: accounts, sessions, pushSubscription (segreti/infra).
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }

    const { password: _pw, ...userCore } = user;

    if (format === 'csv') {
      const headers = [
        'id', 'title', 'description', 'importance', 'urgency', 'resistance', 'size',
        'category', 'context', 'quadrant', 'decision', 'status', 'priorityScore',
        'avoidanceCount', 'deadline', 'completedAt', 'createdAt',
      ];

      const escapeCSV = (val: string | null | undefined | number) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvRows = [
        headers.join(','),
        ...user.tasks.map((t) =>
          headers.map((h) => escapeCSV((t as Record<string, unknown>)[h] as string | number | null)).join(',')
        ),
      ].join('\n');

      return new NextResponse(csvRows, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="shadow-tasks-export.csv"',
        },
      });
    }

    // JSON format
    const payload = {
      exportDate: new Date().toISOString(),
      exportVersion: '1.0',
      ...userCore,
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="shadow-export.json"',
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Errore nell\'esportazione dati' }, { status: 500 });
  }
}
