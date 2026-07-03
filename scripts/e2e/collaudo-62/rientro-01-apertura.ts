/**
 * Collaudo 62 — J4 passi 1-3: snapshot PRIMA, apertura app (GET active-thread),
 * snapshot DOPO + diff, POST bootstrap.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-01-apertura.ts
 */
import { api, cohortUser, mintCookie, saveEvidence, db } from './lib';
import { snapshotRientro, diffThreads } from './rientro-00-util';

const J = 'J4';

function nowRome(): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { hhmm: `${hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

async function main(): Promise<void> {
  const user = await cohortUser('rientro');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
  const { hhmm, date } = nowRome();
  console.log(`[J4] utente=${user.id} clientTime=${hhmm} clientDate=${date}`);

  // ── Passo 1: snapshot PRIMA ────────────────────────────────────────────
  const before = await snapshotRientro(user.id, user.email);
  saveEvidence(J, '01-db-before.json', JSON.stringify(before, null, 2));
  console.log(`[J4] PRIMA: ${before.threads.length} thread, ${before.tasks.length} task, ${before.dailyPlans.length} piani, ${before.reviews.length} review`);
  for (const t of before.threads) console.log(`  thread ${t.id} mode=${t.mode} state=${t.state} startedAt=${t.startedAt} lastTurnAt=${t.lastTurnAt} msgs=${t.messageCount}`);
  for (const t of before.tasks) console.log(`  task "${t.title}" status=${t.status} deadline=${t.deadline}`);

  // ── Passo 2: apertura app = GET /api/chat/active-thread ───────────────
  const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(hhmm)}&clientDate=${date}`, { cookie });
  console.log(`[J4] GET active-thread -> ${at.status}`);
  saveEvidence(J, '02-active-thread-response.json', JSON.stringify({ clientTime: hhmm, clientDate: date, status: at.status, body: at.json }, null, 2));
  console.log(JSON.stringify(at.json, null, 2));

  const after = await snapshotRientro(user.id, user.email);
  saveEvidence(J, '02-db-after-active-thread.json', JSON.stringify(after, null, 2));
  const diff = diffThreads(before, after);
  saveEvidence(J, '02-diff-thread.txt', diff.join('\n'));
  console.log('[J4] DIFF thread dopo active-thread:');
  for (const d of diff) console.log(`  ${d}`);

  // ── Passo 3 (parte meccanica): POST /api/chat/bootstrap ───────────────
  const boot = await api('POST', '/api/chat/bootstrap', { cookie, body: {} });
  console.log(`[J4] POST bootstrap -> ${boot.status}`);
  saveEvidence(J, '03-bootstrap-response.json', JSON.stringify({ atRomeTime: hhmm, status: boot.status, body: boot.json }, null, 2));
  console.log(JSON.stringify(boot.json, null, 2));

  const after3 = await snapshotRientro(user.id, user.email);
  saveEvidence(J, '03-db-after-bootstrap.json', JSON.stringify(after3, null, 2));
  const diff3 = diffThreads(after, after3);
  console.log('[J4] DIFF thread dopo bootstrap:');
  for (const d of diff3) console.log(`  ${d}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-01-apertura:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
