/**
 * Collaudo 68 — Fase 0.3: inventario del DB dev (SOLA LETTURA).
 * Censisce utenti di test (@probe.local), finestre serali residue anomale,
 * Notification/AiUsage accumulate. Stampa email SOLO dei @probe.local;
 * per gli utenti reali solo conteggi aggregati.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/inventory-db.ts
 */
import { preflightDb, db, saveEvidence } from './lib';

await preflightDb();

const testUsers = await db.user.findMany({
  where: { email: { endsWith: '@probe.local' } },
  select: { id: true, email: true, createdAt: true },
  orderBy: { email: 'asc' },
});
const ids = testUsers.map((u) => u.id);

const [tasks, threads, notifications, plans, reviews, settings] = await Promise.all([
  db.task.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  db.chatThread.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  db.notification.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  db.dailyPlan.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  db.review.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  db.settings.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, eveningWindowStart: true, eveningWindowEnd: true, notificationsEnabled: true },
  }),
]);
const usage = await db.aiUsage.groupBy({
  by: ['userId'],
  where: { userId: { in: ids } },
  _sum: { costUsd: true },
});

const byId = <T extends { userId: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.userId, r]));
const t = byId(tasks); const th = byId(threads); const n = byId(notifications);
const p = byId(plans); const rv = byId(reviews); const st = byId(settings); const us = byId(usage);

const lines: string[] = [];
lines.push(`# Inventario DB dev — ${testUsers.length} utenti @probe.local`);
lines.push('');
lines.push('| email | creato | task | thread | notif | piani | review | costUsd | finestra | notifEnabled |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const u of testUsers) {
  const s = st[u.id];
  const window = s ? `${s.eveningWindowStart}-${s.eveningWindowEnd}` : '(no settings)';
  lines.push(
    `| ${u.email} | ${u.createdAt.toISOString().slice(0, 10)} | ${t[u.id]?._count._all ?? 0} | ${th[u.id]?._count._all ?? 0} | ${n[u.id]?._count._all ?? 0} | ${p[u.id]?._count._all ?? 0} | ${rv[u.id]?._count._all ?? 0} | ${(us[u.id]?._sum.costUsd ?? 0).toFixed(3)} | ${window} | ${s?.notificationsEnabled ?? '-'} |`,
  );
}

// finestre residue anomale (lezione §2.12: openEveningWindow 67 non ripristinava)
const weird = settings.filter((s) => {
  const [sh] = (s.eveningWindowStart ?? '').split(':').map(Number);
  const [eh] = (s.eveningWindowEnd ?? '').split(':').map(Number);
  return Number.isFinite(sh) && Number.isFinite(eh) && (sh < 16 || eh - sh > 6 || eh < sh);
});
lines.push('');
lines.push(`Finestre serali anomale tra i test user: ${weird.length}`);

// utenti reali: SOLO aggregati, nessuna email
const realCount = await db.user.count({ where: { NOT: { email: { endsWith: '@probe.local' } } } });
const realWeirdWindows = await db.settings.count({
  where: {
    user: { NOT: { email: { endsWith: '@probe.local' } } },
    OR: [{ eveningWindowStart: { lt: '16:00' } }, { eveningWindowEnd: { lt: '18:00' } }],
  },
});
const realNotifOff = await db.settings.count({
  where: { user: { NOT: { email: { endsWith: '@probe.local' } } }, notificationsEnabled: false },
});
lines.push(`Utenti NON probe.local: ${realCount} (finestre anomale: ${realWeirdWindows}, notifiche disattivate: ${realNotifOff})`);

const out = lines.join('\n');
console.log(out);
saveEvidence('fase0', 'inventario-db.md', out + '\n');
console.log('\n[inventario] salvato in docs/tasks/68-evidenze/fase0/inventario-db.md');
