/**
 * Task 66 (C1) — probe: email serale fallita → traccia persistente + admin.
 *
 * Forza un fallimento Resend DETERMINISTICO dando all'utente un'email dal
 * formato rotto ("...@@invalid"): con RESEND_API_KEY presente Resend risponde
 * 422, con la key assente l'invio fallisce ancora prima — in entrambi i casi
 * il cron deve tracciare `evening_email_failed` (una sola riga per giorno),
 * la GET /api/notifications dell'utente NON deve mostrarla e la summary admin
 * deve elencare chi non riceve le email.
 *
 * Il cron itera TUTTI gli utenti con notificationsEnabled: per non spammare
 * (né tracciare) gli altri utenti del DB dev, il probe li disattiva
 * temporaneamente e li ripristina in finally.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task66/probe-c1.ts
 */
import {
  api,
  assert,
  warn,
  finish,
  preflightDb,
  createEphemeralUser,
  deleteEphemeralUser,
  mintAdminCookie,
  db,
} from './lib';
import { nowHHMMInRome } from '../../../src/lib/evening-review/dates';

const PROBE_EMAIL = 'task66-c1@@invalid'; // formato rotto: Resend 422 sincrono

function hhmmShift(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function main() {
  await preflightDb();

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    warn('CRON_SECRET assente in .env.local: il cron risponde 404, probe non eseguibile');
    finish('probe-c1');
  }

  const user = await createEphemeralUser('c1', { emailOverride: PROBE_EMAIL });

  // Finestra serale aperta sull'ora corrente di Roma (start -1h, end +2h).
  const nowRome = nowHHMMInRome();
  await db.settings.updateMany({
    where: { userId: user.id },
    data: {
      notificationsEnabled: true,
      eveningWindowStart: hhmmShift(nowRome, -60),
      eveningWindowEnd: hhmmShift(nowRome, 120),
    },
  });

  // Metti in pausa gli altri utenti opt-in (ripristino in finally).
  const others = await db.settings.findMany({
    where: { notificationsEnabled: true, userId: { not: user.id } },
    select: { id: true },
  });
  const otherIds = others.map((s) => s.id);
  await db.settings.updateMany({
    where: { id: { in: otherIds } },
    data: { notificationsEnabled: false },
  });
  console.log(`[probe-c1] utenti opt-in messi in pausa: ${otherIds.length}`);

  try {
    // 1° giro del cron: l'invio fallisce → traccia.
    const run1 = await api('GET', '/api/cron/evening-review', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert(run1.status === 200, 'cron 200', run1.status);
    const body1 = run1.json as { candidates: number; sent: number; failed: number };
    assert(body1.candidates === 1, 'un solo candidato (gli altri sono in pausa)', body1);
    assert(body1.failed === 1 && body1.sent === 0, 'invio fallito conteggiato', body1);

    const traces1 = await db.notification.findMany({
      where: { userId: user.id, type: 'evening_email_failed' },
    });
    assert(traces1.length === 1, 'una riga evening_email_failed', traces1.length);
    assert(traces1[0]?.read === true, 'la traccia è read:true (non è per l\'utente)');
    assert((traces1[0]?.body ?? '').length > 0, 'la traccia ha il motivo nel body', traces1[0]?.body);

    // 2° giro: fallisce di nuovo (niente marcatore di successo) ma NON ritraccia.
    const run2 = await api('GET', '/api/cron/evening-review', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const body2 = run2.json as { failed: number };
    assert(body2.failed === 1, 'il retry resta attivo (failed anche al 2° giro)', body2);
    const traces2 = await db.notification.count({
      where: { userId: user.id, type: 'evening_email_failed' },
    });
    assert(traces2 === 1, 'dedup per giorno: ancora una sola traccia', traces2);

    // La GET utente non deve mostrare i type interni.
    const userList = await api('GET', '/api/notifications', { cookie: user.cookie });
    assert(userList.status === 200, 'GET /api/notifications 200', userList.status);
    const notif = userList.json as { notifications: { type: string }[]; unreadCount: number };
    assert(
      notif.notifications.every((n) => n.type !== 'evening_email_failed'),
      'traccia esclusa dalla lista utente',
      notif.notifications.map((n) => n.type),
    );
    assert(notif.unreadCount === 0, 'unreadCount non conta la traccia', notif.unreadCount);

    // Summary admin: chi non riceve le email.
    const adminCookie = await mintAdminCookie();
    if (!adminCookie) {
      warn('ADMIN_EMAILS assente: check summary admin saltato (coperto dai vitest)');
    } else {
      const summary = await api('GET', '/api/admin/beta/summary', { cookie: adminCookie });
      assert(summary.status === 200, 'summary admin 200', summary.status);
      const ee = (summary.json as {
        eveningEmail?: { failed7d: number; failedUsers: { email: string; failCount: number }[] };
      }).eveningEmail;
      assert(!!ee && ee.failed7d >= 1, 'eveningEmail.failed7d >= 1', ee);
      assert(
        !!ee && ee.failedUsers.some((u) => u.email === PROBE_EMAIL),
        'l\'utente probe è tra i failedUsers',
        ee?.failedUsers,
      );
    }
  } finally {
    if (otherIds.length > 0) {
      await db.settings.updateMany({
        where: { id: { in: otherIds } },
        data: { notificationsEnabled: true },
      });
      console.log(`[probe-c1] utenti opt-in ripristinati: ${otherIds.length}`);
    }
    await deleteEphemeralUser(PROBE_EMAIL);
  }

  finish('probe-c1');
}

main().catch((err) => {
  console.error('[probe-c1] errore fatale:', err);
  process.exit(1);
});
