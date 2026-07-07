/**
 * Task 71 — probe 4: il cron della review serale rispetta il focus (item M/N61).
 * Utente in finestra serale + sessione strict ATTIVA (endsAt nel futuro) →
 * il cron lo conta in skippedFocus e non scrive né il marcatore Notification
 * né la riga email. Richiede un server con CRON_SECRET nell'env (gotcha Task
 * 66: in dev lanciarlo inline, es. CRON_SECRET=probe-cron-71).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task71/probe-cron-focus.ts
 */
import {
  api,
  assert,
  createEphemeralUser,
  deleteEphemeralUser,
  finish,
  preflightDb,
  warn,
  db,
} from '../collaudo-68/lib';

const CRON_SECRET = process.env.PROBE_CRON_SECRET ?? 'probe-cron-71';

await preflightDb();
const u = await createEphemeralUser('t71-cronfocus');

try {
  // Candidato pieno: notifiche attive (default Settings), finestra aperta ora.
  await api('PATCH', '/api/settings', {
    cookie: u.cookie,
    body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' },
  });

  // Sessione strict attiva e NON scaduta (endsAt nel futuro).
  const created = await api('POST', '/api/strict-mode', {
    cookie: u.cookie,
    body: { mode: 'strict', triggerType: 'body_double', durationMinutes: 45 },
  });
  assert(created.status === 201, 'sessione focus attiva creata', created.status);

  const cron = await api('GET', '/api/cron/evening-review', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (cron.status === 404) {
    warn('CRON_SECRET non combacia col server (404): lanciare il dev server con CRON_SECRET=probe-cron-71');
    assert(false, 'cron raggiungibile con il secret di probe', cron.status);
  } else {
    assert(cron.status === 200, 'cron → 200', cron.status);
    const body = cron.json as { skippedFocus?: number };
    assert((body.skippedFocus ?? 0) >= 1, `cron skippedFocus ≥ 1 (utente in focus)`, body);

    const marker = await db.notification.findFirst({
      where: { userId: u.id, type: 'evening_review_prompt' },
    });
    assert(marker === null, 'nessun marcatore promemoria scritto per chi è in focus', marker?.id);
  }

  // Controprova: chiusa la sessione, il cron lo tratta da candidato normale
  // (sent o failed a seconda di Resend in dev — ci basta che NON sia più
  // skippedFocus a bloccarlo; con Resend assente finirà tra i failed).
  const sessionId = (created.json as { session?: { id?: string } })?.session?.id;
  await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId, status: 'exited', exitReason: 'user_exit' },
  });
  const cron2 = await api('GET', '/api/cron/evening-review', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (cron2.status === 200) {
    const b2 = cron2.json as { skippedFocus?: number; failed?: number; sent?: number; skipped?: number };
    // L'utente non è più in focus: se ricompare tra gli skippedFocus è un bug.
    // Non possiamo isolare il conteggio per-utente, quindi verifichiamo che
    // il totale non sia salito rispetto al giro precedente.
    const prev = (cron.json as { skippedFocus?: number }).skippedFocus ?? 0;
    assert((b2.skippedFocus ?? 0) <= prev, 'chiusa la sessione, skippedFocus non cresce', b2);
  }
} finally {
  await deleteEphemeralUser(u.email);
  await db.$disconnect();
}
finish('probe-cron-focus');
