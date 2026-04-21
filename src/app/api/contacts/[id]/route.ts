import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// DELETE /api/contacts/[id] — Delete a contact
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if any tasks are delegated to this contact
    const delegatedTasks = await db.task.count({
      where: { delegatedToId: id },
    });

    if (delegatedTasks > 0) {
      // Un-delegate tasks first
      await db.task.updateMany({
        where: { delegatedToId: id },
        data: {
          delegatedToId: null,
          delegationStatus: '',
          delegationNote: '',
        },
      });
    }

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
  try {
    const { id } = await params;
    const data = await req.json();

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
