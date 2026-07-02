import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// PATCH /api/recurring/[id] — Task 65 (B3/D49): pausa/riattiva un template
// (active=false equivale alla "pausa": stopTaskRecurrence usa lo stesso campo,
// la materializzazione filtra su active=true). Solo { active } e' scrivibile:
// la regola si modifica in chat.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();

    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active (boolean) obbligatorio' }, { status: 400 });
    }

    const existing = await db.recurringTask.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const template = await db.recurringTask.update({
      where: { id },
      data: { active: body.active },
    });

    return NextResponse.json({ recurring: { id: template.id, active: template.active } });
  } catch (error) {
    captureApiError(error, 'PATCH /api/recurring/[id]');
    return NextResponse.json({ error: 'Errore nell\'aggiornamento del ricorrente' }, { status: 500 });
  }
}

// DELETE /api/recurring/[id] — elimina il template. Le istanze gia' create
// restano come task normali (FK onDelete: SetNull): le stelle del Cielo,
// che contano le istanze completate, non si spengono.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;

    const existing = await db.recurringTask.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.recurringTask.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    captureApiError(error, 'DELETE /api/recurring/[id]');
    return NextResponse.json({ error: 'Errore nell\'eliminazione del ricorrente' }, { status: 500 });
  }
}
