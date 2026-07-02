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
  // allowWithoutConsent: diritto di cancellazione (art. 17), esercitabile
  // anche dopo la revoca del consenso.
  const { error, userId } = await requireSession(req, { allowWithoutConsent: true });
  if (error) return error;

  // Task 63 (S2-PRIV2a): la conferma "ELIMINA" era solo client-side — una
  // chiamata diretta cancellava tutto senza attrito. Ora e' un contratto API.
  let confirm: unknown;
  try {
    ({ confirm } = (await req.json()) as { confirm?: unknown });
  } catch {
    confirm = undefined;
  }
  if (confirm !== 'ELIMINA') {
    return NextResponse.json({ error: 'confirmation_required' }, { status: 400 });
  }

  try {
    await db.$transaction([
      db.rcWebhookEvent.deleteMany({ where: { appUserId: userId } }),
      db.user.delete({ where: { id: userId } }),
    ]);
    // L'utente non esiste piu': il cookie di sessione non deve sopravvivergli
    // (sessione fantasma, Task 62 ADV-delete).
    const res = NextResponse.json({ ok: true });
    res.cookies.delete('next-auth.session-token');
    res.cookies.delete('__Secure-next-auth.session-token');
    return res;
  } catch (err) {
    captureApiError(err, 'DELETE /api/account');
    return NextResponse.json({ error: 'Eliminazione account fallita' }, { status: 500 });
  }
}
