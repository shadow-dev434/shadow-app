import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// GET /api/contacts — List contacts
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const contacts = await db.contact.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ contacts });
  } catch (error) {
    captureApiError(error, 'GET /api/contacts');
    return NextResponse.json({ error: 'Errore nel caricamento contatti' }, { status: 500 });
  }
}

// POST /api/contacts — Create contact
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { name, email, phone, role, notes } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 });
    }

    const contact = await db.contact.create({
      data: {
        userId,
        name,
        email: email || '',
        phone: phone || '',
        role: role || '',
        notes: notes || '',
      },
    });

    return NextResponse.json({ contact });
  } catch (error) {
    captureApiError(error, 'POST /api/contacts');
    return NextResponse.json({ error: 'Errore nella creazione contatto' }, { status: 500 });
  }
}
