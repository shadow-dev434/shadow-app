/**
 * Seed/reset parametrico per la campagna E2E Slice 8c (riconoscimento re-entry).
 *
 * Riusato da: probe-8c-s2.ts (verifica precondizione emissione) e probe-8c.ts
 * (celle conversazionali R/G). Esporta seedReentry(opts) + CLI main.
 *
 * Cosa fa (reset DISTRUTTIVO dei ChatThread dell'account E2E — pre-reg §F7):
 *   1. AdaptiveProfile upsert (preferredPromptStyle per-cella, sensitivity=4).
 *   2. Settings upsert (finestra serale 00:00-23:59 — turni eseguibili a ogni ora).
 *   3. Delete Review/DailyPlan @today + @today+1 (planDate).
 *   4. Delete ALL ChatThread del user (cascade ChatMessage): azzera il fresco del
 *      run precedente, cosi' check-virgin-8c vede evening_review active/paused===0.
 *   5. Delete Task inbox + by-fingerprint, poi crea 8 inbox (check-virgin-8c: ===8).
 *   6. Se gapDays != null: crea UN thread pregresso evening_review (terminale:
 *      completed/archived) con lastTurnAt BACKDATATO -> e' l'unico thread non-fresco,
 *      quindi max(lastTurnAt) = il suo. Backdating esplicito + verifica + fallback
 *      raw UPDATE (mirror seed-e2e-s1 per createdAt).
 *
 * Virginita': il pregresso e' terminale (completed/archived) -> NON viola
 * check-virgin-8c (evening_review active/paused===0). gapDays=null = utente nuovo.
 *
 * Lancio CLI:
 *   bun run dotenv -e .env.local -- bun run scripts/seed-8c-reentry.ts <userId> <gapDays|none> [state] [style]
 *   state in {completed, archived} (default completed); style in {direct, challenge, gentle} (default direct).
 *
 * SOLA MUTAZIONE sul user target.
 */

import { db } from '../src/lib/db';
import { formatTodayInRome, addDaysIso } from '../src/lib/evening-review/dates';

const DAY_MS = 24 * 60 * 60 * 1000;
const INBOX_COUNT = 8;
const FINGERPRINT = '[E2E-8C]';

export type SeedReentryOpts = {
  userId: string;
  /** null = utente nuovo (nessun thread pregresso). >0 = giorni di backdating. */
  gapDays: number | null;
  state?: 'completed' | 'archived';
  style?: 'direct' | 'challenge' | 'gentle';
};

export type SeedReentryResult = {
  priorThreadId: string | null;
  priorLastTurnAt: string | null;
  inbox: number;
};

export async function seedReentry(opts: SeedReentryOpts): Promise<SeedReentryResult> {
  const { userId } = opts;
  const state = opts.state ?? 'completed';
  const style = opts.style ?? 'direct';
  const now = new Date();
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);

  await db.$transaction(
    async (tx) => {
      // 1. AdaptiveProfile
      const profileData = {
        optimalSessionLength: 25,
        shameFrustrationSensitivity: 4,
        preferredPromptStyle: style,
        bestTimeWindows: JSON.stringify(['morning']),
      };
      await tx.adaptiveProfile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: profileData,
      });

      // 2. Settings (userId NON @unique -> findFirst + update/create). Finestra larga.
      const settingsData = {
        wakeTime: '07:00',
        sleepTime: '23:00',
        eveningWindowStart: '00:00',
        eveningWindowEnd: '23:59',
      };
      const existing = await tx.settings.findFirst({ where: { userId }, select: { id: true } });
      if (existing) await tx.settings.update({ where: { id: existing.id }, data: settingsData });
      else await tx.settings.create({ data: { userId, ...settingsData } });

      // 3. Review/DailyPlan @today + @today+1 (threadId FK SetNull, ok cancellare prima).
      await tx.review.deleteMany({ where: { userId, date: { in: [today, tomorrow] } } });
      await tx.dailyPlan.deleteMany({ where: { userId, date: { in: [today, tomorrow] } } });

      // 4. Cancella TUTTI i ChatThread (cascade ChatMessage). Reset distruttivo (§F7).
      await tx.chatThread.deleteMany({ where: { userId } });

      // 5. Cancella inbox + by-fingerprint, poi crea 8 inbox.
      await tx.task.deleteMany({
        where: { userId, OR: [{ status: 'inbox' }, { title: { contains: FINGERPRINT } }] },
      });
      for (let i = 1; i <= INBOX_COUNT; i++) {
        await tx.task.create({
          data: {
            userId,
            title: `Compito ${i} ${FINGERPRINT}`,
            size: 3,
            source: 'manual',
            status: 'inbox',
            importance: 3,
            urgency: 3,
            priorityScore: 9,
            postponedCount: 0,
          },
        });
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  // 6. Thread pregresso backdatato (FUORI transazione, per il fallback raw UPDATE).
  let priorThreadId: string | null = null;
  let priorLastTurnAt: string | null = null;
  if (opts.gapDays !== null) {
    const backdated = new Date(now.getTime() - opts.gapDays * DAY_MS);
    const prior = await db.chatThread.create({
      data: {
        userId,
        mode: 'evening_review',
        state,
        startedAt: backdated,
        lastTurnAt: backdated,
        endedAt: backdated,
      },
      select: { id: true, lastTurnAt: true },
    });
    priorThreadId = prior.id;

    // Verifica backdating + fallback raw UPDATE (mirror seed-e2e-s1 createdAt).
    let effective = prior.lastTurnAt;
    if (Math.abs(effective.getTime() - backdated.getTime()) > 60_000) {
      console.warn(
        `[seed-8c] lastTurnAt non backdatato dal create (${effective.toISOString()} vs ${backdated.toISOString()}). Raw UPDATE fallback.`,
      );
      await db.$executeRawUnsafe(
        `UPDATE "ChatThread" SET "lastTurnAt" = $1 WHERE "id" = $2`,
        backdated,
        prior.id,
      );
      const recheck = await db.chatThread.findUnique({ where: { id: prior.id }, select: { lastTurnAt: true } });
      if (!recheck || Math.abs(recheck.lastTurnAt.getTime() - backdated.getTime()) > 60_000) {
        throw new Error(`[seed-8c] backdating lastTurnAt fallito: got ${recheck?.lastTurnAt.toISOString() ?? 'null'}`);
      }
      effective = recheck.lastTurnAt;
    }
    priorLastTurnAt = effective.toISOString();
  }

  return { priorThreadId, priorLastTurnAt, inbox: INBOX_COUNT };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const userId = process.argv[2];
  const gapArg = process.argv[3];
  const state = (process.argv[4] as 'completed' | 'archived' | undefined) ?? 'completed';
  const style = (process.argv[5] as 'direct' | 'challenge' | 'gentle' | undefined) ?? 'direct';
  if (!userId || !gapArg) {
    console.error('[FATAL] Usage: seed-8c-reentry.ts <userId> <gapDays|none> [completed|archived] [direct|challenge|gentle]');
    process.exitCode = 1;
    return;
  }
  const gapDays = gapArg === 'none' ? null : Number(gapArg);
  if (gapDays !== null && (!Number.isFinite(gapDays) || gapDays < 0)) {
    console.error(`[FATAL] gapDays invalido: ${gapArg}`);
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) {
    console.error(`[FATAL] User not found: ${userId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[seed-8c] target=${user.email ?? '(no email)'} gapDays=${gapDays ?? 'none'} state=${state} style=${style}`);

  const r = await seedReentry({ userId, gapDays, state, style });
  console.log(
    `[seed-8c] OK. inbox=${r.inbox} priorThread=${r.priorThreadId ?? '(nessuno: utente nuovo)'} ` +
      `priorLastTurnAt=${r.priorLastTurnAt ?? '(n/a)'}`,
  );
}

// Esegui main solo se invocato come script (non quando importato da probe-8c-s2/probe-8c).
if (import.meta.main) {
  main()
    .catch((err) => {
      console.error('[FATAL] seed-8c-reentry failed:', err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
