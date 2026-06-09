/**
 * Seed con-residuo per S1 (spina raggiungibilita', pre-reg §S1).
 *
 * A differenza di seed-8c-reentry (pregresso TERMINALE), qui i thread sono
 * ATTIVI/paused (il residuo da archiviare). NON usa check-virgin-8c (precondizione
 * opposta: residuo presente). Settings.eveningWindow seedata PER SCENARIO; il
 * clientTime lo passa il verifier (deterministico, non dal clock reale).
 *
 * Scenari:
 *  - main:                general active 5gg + evening_review paused 7gg, finestra 00:00-23:59
 *  - out-of-window:       general active 5gg, finestra NARROW 20:00-23:00 (verifier passa clientTime fuori)
 *  - gap-lt-3:            general active 1gg, finestra 00:00-23:59
 *  - most-recent-evening: evening_review active 0gg (recente) + general active 5gg, finestra 00:00-23:59
 *
 * Lancio CLI (debug):
 *   bun run dotenv -e .env.local -- bun run scripts/seed-8c-s1.ts <userId> <scenario>
 */

import { db } from '../src/lib/db';
import { formatTodayInRome, addDaysIso } from '../src/lib/evening-review/dates';

const DAY_MS = 86_400_000;
const FINGERPRINT = '[E2E-8C-S1]';
const INBOX = 8;

export type S1Scenario = 'main' | 'out-of-window' | 'gap-lt-3' | 'most-recent-evening';

type ThreadSpec = { mode: string; state: string; daysAgo: number };
type ScenarioSpec = { window: { start: string; end: string }; threads: ThreadSpec[] };

export const S1_SCENARIOS: Record<S1Scenario, ScenarioSpec> = {
  main: {
    window: { start: '00:00', end: '23:59' },
    threads: [
      { mode: 'general', state: 'active', daysAgo: 5 },
      { mode: 'evening_review', state: 'paused', daysAgo: 7 },
    ],
  },
  'out-of-window': {
    window: { start: '20:00', end: '23:00' },
    threads: [{ mode: 'general', state: 'active', daysAgo: 5 }],
  },
  'gap-lt-3': {
    window: { start: '00:00', end: '23:59' },
    threads: [{ mode: 'general', state: 'active', daysAgo: 1 }],
  },
  'most-recent-evening': {
    window: { start: '00:00', end: '23:59' },
    threads: [
      { mode: 'evening_review', state: 'active', daysAgo: 0 },
      { mode: 'general', state: 'active', daysAgo: 5 },
    ],
  },
};

export type S1SeededThread = { id: string; mode: string; state: string; daysAgo: number };
export type SeedS1Result = { threads: S1SeededThread[]; window: { start: string; end: string } };

async function createBackdatedThread(
  userId: string,
  mode: string,
  state: string,
  daysAgo: number,
): Promise<string> {
  const ts = new Date(Date.now() - daysAgo * DAY_MS);
  const t = await db.chatThread.create({
    data: { userId, mode, state, startedAt: ts, lastTurnAt: ts },
    select: { id: true, lastTurnAt: true },
  });
  if (Math.abs(t.lastTurnAt.getTime() - ts.getTime()) > 60_000) {
    await db.$executeRawUnsafe(
      `UPDATE "ChatThread" SET "lastTurnAt" = $1, "startedAt" = $1 WHERE "id" = $2`,
      ts,
      t.id,
    );
    const re = await db.chatThread.findUnique({ where: { id: t.id }, select: { lastTurnAt: true } });
    if (!re || Math.abs(re.lastTurnAt.getTime() - ts.getTime()) > 60_000) {
      throw new Error(`[seed-8c-s1] backdating lastTurnAt fallito per ${mode}/${state}`);
    }
  }
  return t.id;
}

export async function seedS1(userId: string, scenario: S1Scenario): Promise<SeedS1Result> {
  const spec = S1_SCENARIOS[scenario];
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);

  await db.$transaction(
    async (tx) => {
      const settingsData = {
        wakeTime: '07:00',
        sleepTime: '23:00',
        eveningWindowStart: spec.window.start,
        eveningWindowEnd: spec.window.end,
      };
      const ex = await tx.settings.findFirst({ where: { userId }, select: { id: true } });
      if (ex) await tx.settings.update({ where: { id: ex.id }, data: settingsData });
      else await tx.settings.create({ data: { userId, ...settingsData } });

      await tx.adaptiveProfile.upsert({
        where: { userId },
        create: { userId, preferredPromptStyle: 'direct', shameFrustrationSensitivity: 4 },
        update: { preferredPromptStyle: 'direct' },
      });

      await tx.review.deleteMany({ where: { userId, date: { in: [today, tomorrow] } } });
      await tx.dailyPlan.deleteMany({ where: { userId, date: { in: [today, tomorrow] } } });
      await tx.chatThread.deleteMany({ where: { userId } });
      await tx.task.deleteMany({
        where: { userId, OR: [{ status: 'inbox' }, { title: { contains: FINGERPRINT } }] },
      });
      for (let i = 1; i <= INBOX; i++) {
        await tx.task.create({
          data: {
            userId,
            title: `S1 ${i} ${FINGERPRINT}`,
            size: 3,
            source: 'manual',
            status: 'inbox',
            importance: 3,
            urgency: 3,
            priorityScore: 9,
          },
        });
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const threads: S1SeededThread[] = [];
  for (const t of spec.threads) {
    const id = await createBackdatedThread(userId, t.mode, t.state, t.daysAgo);
    threads.push({ id, mode: t.mode, state: t.state, daysAgo: t.daysAgo });
  }
  return { threads, window: spec.window };
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  const scenario = process.argv[3] as S1Scenario | undefined;
  if (!userId || !scenario || !(scenario in S1_SCENARIOS)) {
    console.error(`[FATAL] Usage: seed-8c-s1.ts <userId> <${Object.keys(S1_SCENARIOS).join('|')}>`);
    process.exitCode = 1;
    return;
  }
  const r = await seedS1(userId, scenario);
  console.log(`[seed-8c-s1] scenario=${scenario} window=${r.window.start}-${r.window.end}`);
  for (const t of r.threads) console.log(`[seed-8c-s1]   thread ${t.id} mode=${t.mode} state=${t.state} (-${t.daysAgo}gg)`);
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error('[FATAL] seed-8c-s1 failed:', err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
