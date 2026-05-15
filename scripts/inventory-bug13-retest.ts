/**
 * Inventory read-only pre-cleanup per retest E2E Bug #1 + Bug #3 (2026-05-15).
 *
 * Scope: account virgin alberto@esempio (userId cmp1flw1g005oibvckzsenuqm).
 * Stampa tabelle sintetiche per 4 categorie:
 *   1. ChatThread mode='evening_review' in TUTTI gli stati.
 *   2. Review (tutte, cronologia completa).
 *   3. DailyPlan (tutti, cronologia completa).
 *   4. Task source in ('gmail','review_carryover') in tutti gli stati.
 *
 * Nessuna mutazione. Solo SELECT.
 *
 * Lancio:
 *   bun scripts/inventory-bug13-retest.ts
 */

import { db } from '../src/lib/db';

const TARGET_USER_ID = 'cmp1flw1g005oibvckzsenuqm';

function romeDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : '(null)';
}

async function main(): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: TARGET_USER_ID },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TARGET_USER_ID}`);
    process.exitCode = 1;
    return;
  }

  const today = romeDate(new Date());
  const tomorrow = romeDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const yesterday = romeDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  console.log(`=== INVENTORY alberto: ${user.email} (id=${user.id}) ===`);
  console.log(`Date chiave (Europe/Rome): ieri=${yesterday}  oggi=${today}  domani=${tomorrow}`);
  console.log('');

  // --- 1. ChatThread evening_review, tutti gli stati ---
  const erThreads = await db.chatThread.findMany({
    where: { userId: user.id, mode: 'evening_review' },
    select: {
      id: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });
  const otherThreads = await db.chatThread.groupBy({
    by: ['mode', 'state'],
    where: { userId: user.id, mode: { not: 'evening_review' } },
    _count: { _all: true },
  });

  console.log(`--- 1. ChatThread evening_review (count=${erThreads.length}) ---`);
  if (erThreads.length === 0) {
    console.log('  (nessuno)');
  } else {
    for (const t of erThreads) {
      console.log(
        `  id=${t.id}  state=${t.state.padEnd(9)}  startedAt=${iso(t.startedAt)}  ` +
        `lastTurnAt=${iso(t.lastTurnAt)}  endedAt=${iso(t.endedAt)}`,
      );
    }
  }
  const stateCounts = erThreads.reduce<Record<string, number>>((acc, t) => {
    acc[t.state] = (acc[t.state] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  conteggio per stato: ${JSON.stringify(stateCounts)}`);
  console.log(`  thread non-evening_review: ${otherThreads.map((o) => `${o.mode}/${o.state}=${o._count._all}`).join(', ') || '(nessuno)'}`);
  console.log('');

  // --- 2. Review, cronologia completa ---
  const reviews = await db.review.findMany({
    where: { userId: user.id },
    select: { id: true, date: true, threadId: true, mood: true, energyEnd: true, createdAt: true },
    orderBy: { date: 'asc' },
  });
  console.log(`--- 2. Review (count=${reviews.length}) ---`);
  if (reviews.length === 0) {
    console.log('  (nessuna)');
  } else {
    for (const r of reviews) {
      const flag = r.date === today ? '  <-- COLLIDE oggi' : '';
      console.log(
        `  id=${r.id}  date=${r.date}  mood=${r.mood}  energyEnd=${r.energyEnd}  ` +
        `threadId=${r.threadId ?? '(null)'}  createdAt=${iso(r.createdAt)}${flag}`,
      );
    }
  }
  console.log('');

  // --- 3. DailyPlan, cronologia completa ---
  const plans = await db.dailyPlan.findMany({
    where: { userId: user.id },
    select: { id: true, date: true, threadId: true, createdAt: true },
    orderBy: { date: 'asc' },
  });
  console.log(`--- 3. DailyPlan (count=${plans.length}) ---`);
  if (plans.length === 0) {
    console.log('  (nessuno)');
  } else {
    for (const p of plans) {
      const flag =
        p.date === today ? '  <-- COLLIDE oggi'
        : p.date === tomorrow ? '  <-- COLLIDE domani (planDate review odierna)'
        : '';
      console.log(
        `  id=${p.id}  date=${p.date}  threadId=${p.threadId ?? '(null)'}  ` +
        `createdAt=${iso(p.createdAt)}${flag}`,
      );
    }
  }
  console.log('');

  // --- 4. Task source gmail / review_carryover ---
  const tasks = await db.task.findMany({
    where: { userId: user.id, source: { in: ['gmail', 'review_carryover'] } },
    select: {
      id: true, title: true, source: true, status: true, deadline: true,
      avoidanceCount: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`--- 4. Task source=gmail|review_carryover (count=${tasks.length}) ---`);
  if (tasks.length === 0) {
    console.log('  (nessuno)');
  } else {
    for (const t of tasks) {
      const dl = t.deadline ? `${iso(t.deadline)} (rome=${romeDate(t.deadline)})` : '(null)';
      console.log(
        `  id=${t.id}  source=${t.source.padEnd(16)}  status=${t.status.padEnd(10)}  ` +
        `avoidance=${t.avoidanceCount}  deadline=${dl}  title="${t.title}"`,
      );
    }
  }
  const bySource = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.source] = (acc[t.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  conteggio per source: ${JSON.stringify(bySource)}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] inventory-bug13-retest failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
