/**
 * Cleanup script: archives orphan ChatThread rows.
 *
 * An orphan is a ChatThread with state='active' that has zero
 * messages with role='user'. These were produced by the pre-fix
 * ChatView remount bug (Task 3, Step 1 diagnosis): every mount
 * without rehydration created a fresh thread, even if the previous
 * one was still active. After commits e459893 + 4cbe8fe + a6bb316
 * the system no longer produces them; this script cleans up the
 * accumulated ones from the beta database.
 *
 * Action: UPDATE state='active' -> state='archived', set endedAt=now().
 * No DELETE. Reversible: archived threads can be reset to active by
 * flipping the state back. ChatMessage rows are untouched.
 *
 * Safety contract:
 * - Default mode is dry-run (no write). Pass --execute to write.
 * - In execute mode, an explicit "yes" confirmation is required.
 * - If more than 10000 orphans are found, the script aborts with an
 *   error on the assumption that something is wrong (wrong DB,
 *   undiagnosed bug). Investigate manually before re-running.
 * - The archive UPDATE re-filters by "messages: none user" inside
 *   the transaction so a thread that received its first user msg
 *   between findOrphans() and the write is not archived (race-safe).
 *
 * Usage:
 *   bun run scripts/cleanup-orphan-threads.ts             (dry-run)
 *   bun run scripts/cleanup-orphan-threads.ts --execute   (actual write)
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../src/lib/db';

const SAFETY_CAP = 10_000;
const SAMPLE_SIZE = 10;
const BREAKDOWN_TOP = 5;

interface OrphanThread {
  id: string;
  userId: string;
  startedAt: Date;
  lastTurnAt: Date;
  _count: { messages: number };
}

function parseArgs(): { execute: boolean } {
  const args = process.argv.slice(2);
  return { execute: args.includes('--execute') };
}

async function countAllActive(): Promise<number> {
  return db.chatThread.count({ where: { state: 'active' } });
}

async function findOrphans(): Promise<OrphanThread[]> {
  return db.chatThread.findMany({
    where: {
      state: 'active',
      messages: { none: { role: 'user' } },
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      lastTurnAt: true,
      _count: {
        select: {
          messages: { where: { role: 'assistant' } },
        },
      },
    },
    orderBy: { lastTurnAt: 'asc' },
  });
}

function printSample(orphans: OrphanThread[]): void {
  const sample = orphans.slice(0, SAMPLE_SIZE);
  console.log(`\nSample (first ${sample.length}):`);
  console.log('threadId | userId | startedAt | lastTurnAt | assistantMessageCount');
  for (const t of sample) {
    console.log(
      `${t.id} | ${t.userId} | ${t.startedAt.toISOString()} | ${t.lastTurnAt.toISOString()} | ${t._count.messages}`,
    );
  }
}

function printUserBreakdown(orphans: OrphanThread[]): void {
  const byUser = new Map<string, number>();
  for (const t of orphans) {
    byUser.set(t.userId, (byUser.get(t.userId) ?? 0) + 1);
  }
  const sorted = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, BREAKDOWN_TOP);
  const rest = sorted.slice(BREAKDOWN_TOP);

  console.log(`\nBreakdown per utente (top ${top.length}):`);
  for (const [userId, n] of top) {
    console.log(`  ${userId} -> ${n} orfani`);
  }
  if (rest.length > 0) {
    const maxRest = rest[0][1];
    console.log(`(e altri ${rest.length} utenti con <= ${maxRest} orfani ciascuno)`);
  }
}

async function confirmExecute(count: number): Promise<boolean> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `\nAbout to archive ${count} threads. Type "yes" to confirm: `,
  );
  rl.close();
  return answer.trim() === 'yes';
}

async function executeArchive(ids: string[]): Promise<number> {
  return db.$transaction(async (tx) => {
    const result = await tx.chatThread.updateMany({
      where: {
        id: { in: ids },
        state: 'active',
        messages: { none: { role: 'user' } },
      },
      data: {
        state: 'archived',
        endedAt: new Date(),
      },
    });
    return result.count;
  });
}

async function main(): Promise<void> {
  const { execute } = parseArgs();
  const mode = execute ? 'EXECUTE' : 'DRY-RUN';
  console.log(`[cleanup-orphan-threads] mode=${mode}`);

  const totalActive = await countAllActive();
  console.log(`Total active threads: ${totalActive}`);

  const orphans = await findOrphans();
  console.log(`Orphan threads identified: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('Nothing to do. Exiting.');
    return;
  }

  if (orphans.length > SAFETY_CAP) {
    console.error(
      `\nERROR: Found ${orphans.length} orphan threads (> ${SAFETY_CAP} safety cap).\n` +
        `This exceeds the expected beta-scale cleanup.\n` +
        `Aborting. Investigate manually before proceeding.`,
    );
    process.exit(1);
  }

  printSample(orphans);
  printUserBreakdown(orphans);

  if (!execute) {
    console.log(
      `\n${orphans.length} threads would be archived (dry-run, no changes written).`,
    );
    return;
  }

  const ok = await confirmExecute(orphans.length);
  if (!ok) {
    console.log('Aborted by user. No changes written.');
    return;
  }

  const ids = orphans.map(t => t.id);
  const candidates = ids.length;
  const archived = await executeArchive(ids);
  const skipped = candidates - archived;

  console.log(`\nCandidates identified: ${candidates}`);
  if (skipped === 0) {
    console.log(`Archived: ${archived} (all candidates)`);
  } else {
    console.log(`Archived: ${archived}`);
    console.log(
      `Skipped: ${skipped} (candidate became non-orphan during execution -- user wrote first message)`,
    );
  }
}

main()
  .catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
