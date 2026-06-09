import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// DELETE /api/account — cancellazione irreversibile account + tutti i dati utente.
// Si appoggia a onDelete: Cascade su tutte le relazioni di User (24 Cascade, 0 Restrict):
// db.user.delete cancella l'intero sottografo. Un utente cancella solo se stesso (id dal JWT).
export async function DELETE(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    await db.user.delete({ where: { id: userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/account error:', err);
    return NextResponse.json({ error: 'Eliminazione account fallita' }, { status: 500 });
  }
}
