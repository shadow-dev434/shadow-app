import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

export const maxDuration = 60;

// GET /api/export?format=csv|json
export async function GET(req: NextRequest) {
  // allowWithoutConsent: diritto di portabilita' (art. 20), esercitabile
  // anche dopo la revoca del consenso.
  const { error, userId } = await requireSession(req, { allowWithoutConsent: true });
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
        // GDPR completeness (Task 60 §5): i template ricorrenti (Task 46) sono
        // dati dell'utente e vanno inclusi nell'export.
        recurringTasks: true,
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
        // Beta (Task 23). bugReports con select esplicito: adminNotes e
        // priority sono note INTERNE di triage, non vanno nell'export utente.
        bugReports: {
          select: {
            id: true, area: true, description: true, expected: true,
            severityUser: true, reproducibility: true, context: true,
            appVersion: true, status: true, createdAt: true, resolvedAt: true,
          },
        },
        betaFeedbacks: true,
        assessmentResponses: true,
        // Shadow v3 — W1 (doc 31)
        subscription: true,
        aiUsages: true,
        pushDevices: {
          select: {
            id: true, platform: true, locale: true, appVersion: true,
            lastSeenAt: true, createdAt: true,
          },
        },
        // Esclusi di proposito: accounts, sessions, pushSubscription (segreti/infra),
        // token/chiavi di PushDevice (infra), RcWebhookEvent (log di sistema, non dati utente:
        // purgato per appUserId alla cancellazione account).
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
    captureApiError(error, 'GET /api/export');
    return NextResponse.json({ error: 'Errore nell\'esportazione dati' }, { status: 500 });
  }
}
