/**
 * Collaudo 62 — J4 (rientro dopo assenza): util di snapshot condiviso.
 * Fotografa lo stato DB dell'utente collaudo-rientro (thread, task, piani,
 * review, settings) per i diff prima/dopo dei passi del journey.
 */
import { db } from './lib';

export interface RientroSnapshot {
  takenAt: string;
  user: { id: string; email: string };
  threads: Array<{
    id: string;
    mode: string;
    state: string;
    startedAt: string;
    lastTurnAt: string;
    endedAt: string | null;
    messageCount: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    createdAt: string;
    importance: number | null;
    urgency: number | null;
    postponedCount: number;
  }>;
  dailyPlans: Array<{ id: string; date: string; top3Ids: string | null; energyLevel: number | null; createdAt: string; threadId: string | null }>;
  reviews: Array<{ id: string; date: string; mood: number | null; whatDone: string | null; createdAt: string }>;
  settings: { eveningWindowStart: string; eveningWindowEnd: string } | null;
}

export async function snapshotRientro(userId: string, email: string): Promise<RientroSnapshot> {
  const [threads, tasks, dailyPlans, reviews, settings] = await Promise.all([
    db.chatThread.findMany({
      where: { userId },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true,
        _count: { select: { messages: true } },
      },
    }),
    db.task.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, status: true, deadline: true, createdAt: true, importance: true, urgency: true, postponedCount: true },
    }),
    db.dailyPlan.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, top3Ids: true, energyLevel: true, createdAt: true, threadId: true },
    }),
    db.review.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, mood: true, whatDone: true, createdAt: true },
    }),
    db.settings.findFirst({
      where: { userId },
      select: { eveningWindowStart: true, eveningWindowEnd: true },
    }),
  ]);
  return {
    takenAt: new Date().toISOString(),
    user: { id: userId, email },
    threads: threads.map((t) => ({
      id: t.id, mode: t.mode, state: t.state,
      startedAt: t.startedAt.toISOString(),
      lastTurnAt: t.lastTurnAt.toISOString(),
      endedAt: t.endedAt ? t.endedAt.toISOString() : null,
      messageCount: t._count.messages,
    })),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status,
      deadline: t.deadline ? t.deadline.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      importance: t.importance, urgency: t.urgency, postponedCount: t.postponedCount,
    })),
    dailyPlans: dailyPlans.map((p) => ({
      id: p.id, date: p.date, top3Ids: p.top3Ids, energyLevel: p.energyLevel,
      createdAt: p.createdAt.toISOString(), threadId: p.threadId,
    })),
    reviews: reviews.map((r) => ({
      id: r.id, date: r.date, mood: r.mood, whatDone: r.whatDone, createdAt: r.createdAt.toISOString(),
    })),
    settings,
  };
}

/** Diff leggibile thread-per-thread tra due snapshot (stati e date). */
export function diffThreads(before: RientroSnapshot, after: RientroSnapshot): string[] {
  const out: string[] = [];
  const byId = new Map(before.threads.map((t) => [t.id, t]));
  for (const t of after.threads) {
    const prev = byId.get(t.id);
    if (!prev) {
      out.push(`NUOVO thread ${t.id} mode=${t.mode} state=${t.state} startedAt=${t.startedAt} msgs=${t.messageCount}`);
      continue;
    }
    const changes: string[] = [];
    if (prev.state !== t.state) changes.push(`state ${prev.state}->${t.state}`);
    if (prev.lastTurnAt !== t.lastTurnAt) changes.push(`lastTurnAt ${prev.lastTurnAt}->${t.lastTurnAt}`);
    if (prev.endedAt !== t.endedAt) changes.push(`endedAt ${prev.endedAt}->${t.endedAt}`);
    if (prev.messageCount !== t.messageCount) changes.push(`msgs ${prev.messageCount}->${t.messageCount}`);
    if (changes.length) out.push(`thread ${t.id} (${t.mode}): ${changes.join(', ')}`);
  }
  for (const t of before.threads) {
    if (!after.threads.some((a) => a.id === t.id)) out.push(`SPARITO thread ${t.id} (${t.mode})`);
  }
  if (out.length === 0) out.push('(nessuna differenza sui thread)');
  return out;
}
