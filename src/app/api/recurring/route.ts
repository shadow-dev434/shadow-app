import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { ruleFromTemplate } from '@/lib/recurring/materialize';
import { describeRuleIt } from '@/lib/recurring/recurrence';

// GET /api/recurring — Task 65 (B3/D49): elenco dei template ricorrenti per la
// card "Ricorrenti" in Settings. La descrizione in italiano e' calcolata qui
// (describeRuleIt) cosi' il client non deve conoscere il modello della regola.
// Creazione/modifica restano in chat (set_task_recurrence).
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const templates = await db.recurringTask.findMany({
      where: { userId },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });

    const recurring = templates.map((t) => ({
      id: t.id,
      title: t.title,
      description: describeRuleIt(ruleFromTemplate(t)),
      active: t.active,
      frequency: t.frequency,
      endDate: t.endDate,
      createdAt: t.createdAt.toISOString(),
    }));

    return NextResponse.json({ recurring });
  } catch (error) {
    captureApiError(error, 'GET /api/recurring');
    return NextResponse.json({ error: 'Errore nel caricamento dei ricorrenti' }, { status: 500 });
  }
}
