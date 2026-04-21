import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/contacts — List contacts
export async function GET() {
  try {
    const contacts = await db.contact.findMany({
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
  try {
    const { name, email, phone, role, notes, userId } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 });
    }

    const contact = await db.contact.create({
      data: {
        name,
        email: email || '',
        phone: phone || '',
        role: role || '',
        notes: notes || '',
        userId: userId || null,
      },
    });

    return NextResponse.json({ contact });
  } catch (error) {
    console.error('Create contact error:', error);
    return NextResponse.json({ error: 'Errore nella creazione contatto' }, { status: 500 });
  }
}
