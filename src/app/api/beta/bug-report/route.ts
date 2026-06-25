// Shadow Beta — Bug report API (Task 23 §A2-A3)
// POST: crea una segnalazione (+ alert email immediato se bloccante)
// GET: le segnalazioni dell'utente ("Le mie segnalazioni")

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { sendBetaAlert } from '@/lib/beta/alert';
import { captureApiError } from '@/lib/observability';

const AREAS = new Set([
  'chat',
  'evening_review',
  'inbox_task',
  'today_plan',
  'focus_strict',
  'notifications',
  'onboarding',
  'auth',
  'settings',
  'other',
]);
const SEVERITIES = new Set(['blocking', 'annoying', 'cosmetic']);
const REPRODUCIBILITIES = new Set(['always', 'sometimes', 'once']);

const MAX_TEXT = 4000;
const MAX_CONTEXT_CHARS = 16_000;

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const reports = await db.bugReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        area: true,
        description: true,
        severityUser: true,
        status: true,
        priority: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    return NextResponse.json({ reports });
  } catch (err) {
    captureApiError(err, 'GET /api/beta/bug-report');
    return NextResponse.json({ error: 'Failed to fetch bug reports' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { area, description, expected, severityUser, reproducibility, context, appVersion } =
      body ?? {};

    if (typeof description !== 'string' || !description.trim()) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }
    if (typeof area !== 'string' || !AREAS.has(area)) {
      return NextResponse.json({ error: 'invalid area' }, { status: 400 });
    }
    if (typeof severityUser !== 'string' || !SEVERITIES.has(severityUser)) {
      return NextResponse.json({ error: 'invalid severityUser' }, { status: 400 });
    }
    if (typeof reproducibility !== 'string' || !REPRODUCIBILITIES.has(reproducibility)) {
      return NextResponse.json({ error: 'invalid reproducibility' }, { status: 400 });
    }

    let contextJson = '{}';
    if (context && typeof context === 'object') {
      contextJson = JSON.stringify(context);
      if (contextJson.length > MAX_CONTEXT_CHARS) {
        contextJson = JSON.stringify({ truncated: true });
      }
    }

    const report = await db.bugReport.create({
      data: {
        userId,
        area,
        description: description.trim().slice(0, MAX_TEXT),
        expected:
          typeof expected === 'string' && expected.trim()
            ? expected.trim().slice(0, MAX_TEXT)
            : null,
        severityUser,
        reproducibility,
        context: contextJson,
        appVersion: typeof appVersion === 'string' ? appVersion.slice(0, 40) : null,
      },
    });

    // Alert immediato solo per le segnalazioni bloccanti (spec §A3).
    // sendBetaAlert non lancia mai: un fallimento email non tocca la risposta.
    if (severityUser === 'blocking') {
      await sendBetaAlert(
        `🐞 Bug bloccante [${area}] — Shadow beta`,
        [
          `Severità: bloccante | Riproducibilità: ${reproducibility}`,
          `Area: ${area}`,
          `Utente: ${userId.slice(0, 8)}… | Versione app: ${typeof appVersion === 'string' ? appVersion : 'n/d'}`,
          '',
          description.trim().slice(0, 1000),
          '',
          `Admin: /admin/beta — report ${report.id}`,
        ].join('\n')
      );
    }

    return NextResponse.json({
      report: { id: report.id, status: report.status, createdAt: report.createdAt },
    });
  } catch (err) {
    captureApiError(err, 'POST /api/beta/bug-report');
    return NextResponse.json({ error: 'Failed to save bug report' }, { status: 500 });
  }
}
