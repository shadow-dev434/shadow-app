import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// DELETE /api/contacts/[id] — Delete a contact
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;

    const existing = await db.contact.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Un-delegate tasks (filtra per userId anche qui per coerenza — evita di
    // toccare delegation di altri utenti se un id fosse condiviso)
    await db.task.updateMany({
      where: { delegatedToId: id, userId },
      data: {
        delegatedToId: null,
        delegationStatus: '',
        delegationNote: '',
      },
    });

    await db.contact.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete contact error:', error);
    return NextResponse.json({ error: 'Errore nell\'eliminazione contatto' }, { status: 500 });
  }
}

// PATCH /api/contacts/[id] — Update a contact
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;
    const data = await req.json();

    const existing = await db.contact.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const contact = await db.contact.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });

    return NextResponse.json({ contact });
  } catch (error) {
    console.error('Update contact error:', error);
    return NextResponse.json({ error: 'Errore nell\'aggiornamento contatto' }, { status: 500 });
  }
}
