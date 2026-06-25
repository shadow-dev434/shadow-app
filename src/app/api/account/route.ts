import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// DELETE /api/account — cancellazione irreversibile account + tutti i dati utente.
// Si appoggia a onDelete: Cascade su tutte le relazioni di User (27 Cascade, 0 Restrict):
// db.user.delete cancella l'intero sottografo. Un utente cancella solo se stesso (id dal JWT).
// Eccezione (v3 W1): RcWebhookEvent non ha relazione con User (log di sistema indicizzato
// per appUserId) → purge esplicito nella stessa transazione, prima della delete.
export async function DELETE(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    await db.$transaction([
      db.rcWebhookEvent.deleteMany({ where: { appUserId: userId } }),
      db.user.delete({ where: { id: userId } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError(err, 'DELETE /api/account');
    return NextResponse.json({ error: 'Eliminazione account fallita' }, { status: 500 });
  }
}
