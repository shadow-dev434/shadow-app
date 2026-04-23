import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

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
    console.error('Fetch contacts error:', error);
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
    console.error('Create contact error:', error);
    return NextResponse.json({ error: 'Errore nella creazione contatto' }, { status: 500 });
  }
}
