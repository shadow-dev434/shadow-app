/**
 * Task 66 (C2) — probe: PATCH admin → fixed notifica il tester giusto.
 *
 * Verifica: alla PRIMA transizione a fixed nasce una Notification `bug_fixed`
 * per il tester (visibile nella sua GET /api/notifications, unread); un
 * secondo PATCH fixed non duplica. L'email è best-effort (in dev senza
 * RESEND_API_KEY è un no-op loggato server-side: qui si verifica la traccia).
 *
 * Richiede ADMIN_EMAILS in .env.local (requireAdminSession valida solo il
 * JWT: il cookie admin è mintato, nessun utente admin creato).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task66/probe-c2.ts
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

async function main() {
  await preflightDb();

  const adminCookie = await mintAdminCookie();
  if (!adminCookie) {
    warn('ADMIN_EMAILS assente in .env.local: probe non eseguibile (coperto dai vitest della route)');
    finish('probe-c2');
  }

  const tester = await createEphemeralUser('c2-tester');
  const report = await db.bugReport.create({
    data: {
      userId: tester.id,
      area: 'today_plan',
      description: 'Probe C2: il piano di oggi non si aggiorna dopo il commit',
      severityUser: 'annoying',
      reproducibility: 'always',
    },
  });

  try {
    // Transizione new → fixed: notifica.
    const patch1 = await api('PATCH', '/api/admin/beta/bug-reports', {
      cookie: adminCookie!,
      body: { id: report.id, status: 'fixed' },
    });
    assert(patch1.status === 200, 'PATCH fixed 200', { status: patch1.status, json: patch1.json });

    const after1 = await db.notification.findMany({
      where: { userId: tester.id, type: 'bug_fixed' },
    });
    assert(after1.length === 1, 'una Notification bug_fixed per il tester', after1.length);
    assert(after1[0]?.read === false, 'la notifica è unread (è PER il tester)');
    assert(
      (after1[0]?.body ?? '').includes('piano di oggi'),
      'il body cita la segnalazione',
      after1[0]?.body,
    );

    // Il tester la vede nella sua GET (non è un type interno).
    const list = await api('GET', '/api/notifications', { cookie: tester.cookie });
    const notif = list.json as { notifications: { type: string }[]; unreadCount: number };
    assert(
      notif.notifications.some((n) => n.type === 'bug_fixed'),
      'bug_fixed presente nella lista del tester',
    );
    assert(notif.unreadCount >= 1, 'unreadCount la conta', notif.unreadCount);

    // Secondo PATCH fixed (save ripetuto della card): nessun duplicato.
    const patch2 = await api('PATCH', '/api/admin/beta/bug-reports', {
      cookie: adminCookie!,
      body: { id: report.id, status: 'fixed', adminNotes: 'probe re-save' },
    });
    assert(patch2.status === 200, 'secondo PATCH 200', patch2.status);
    const after2 = await db.notification.count({
      where: { userId: tester.id, type: 'bug_fixed' },
    });
    assert(after2 === 1, 'nessuna seconda notifica su fixed ripetuto', after2);

    // Un non-admin non vede la route (404) e non genera notifiche.
    const asTester = await api('PATCH', '/api/admin/beta/bug-reports', {
      cookie: tester.cookie,
      body: { id: report.id, status: 'new' },
    });
    assert(asTester.status === 404, 'route inesistente per il non-admin', asTester.status);
  } finally {
    await deleteEphemeralUser(tester.email); // cascade: bugReport + notification
  }

  finish('probe-c2');
}

main().catch((err) => {
  console.error('[probe-c2] errore fatale:', err);
  process.exit(1);
});
