/**
 * Collaudo 68 — J5 passo 4: "ti svegli domattina" (pattern collaudo-62/j2-50).
 * Retrodatazione -24h SOLO su collaudo68-procrastinatore:
 *  - DailyPlan(oggi, seed) -> ieri; DailyPlan(domani, review) -> OGGI
 *  - Review(oggi) -> ieri; ChatThread -24h; LearningSignal task_blocked nuovi -24h
 * Poi GET /api/daily-plan: il micro-step di rientro dal blocco di "ieri sera"
 * (65E2/R12) appare sul task bloccato?
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j5-40-retrodate.ts
 */
import { preflightDb, cohortUser, mintCookie, api, saveEvidence, assert, warn, finish, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J5';
const DAY_MS = 24 * 60 * 60 * 1000;
await preflightDb();

const u = await cohortUser('procrastinatore');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 procrastinatore' });
const today = formatTodayInRome();
const yesterday = addDaysIso(today, -1);
const tomorrow = addDaysIso(today, 1);
const actions: string[] = [];

// 1. piano seed di oggi -> ieri (libera la data)
const planToday = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
if (planToday) {
  await db.dailyPlan.deleteMany({ where: { userId: u.id, date: yesterday } });
  await db.dailyPlan.update({ where: { id: planToday.id }, data: { date: yesterday } });
  actions.push(`DailyPlan seed ${today} -> ${yesterday}`);
}
// 2. piano della review (domani) -> oggi
const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } } });
if (!planTomorrow) throw new Error('DailyPlan(domani) assente: lanciare prima j5-20');
await db.dailyPlan.update({ where: { id: planTomorrow.id }, data: { date: today, createdAt: new Date(planTomorrow.createdAt.getTime() - DAY_MS) } });
actions.push(`DailyPlan review ${tomorrow} -> ${today}`);
// 3. review di oggi -> ieri
const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
if (review) {
  await db.review.deleteMany({ where: { userId: u.id, date: yesterday } });
  await db.review.update({ where: { id: review.id }, data: { date: yesterday, createdAt: new Date(review.createdAt.getTime() - DAY_MS) } });
  actions.push(`Review ${today} -> ${yesterday}`);
}
// 4. thread -24h
for (const th of await db.chatThread.findMany({ where: { userId: u.id } })) {
  await db.chatThread.update({ where: { id: th.id }, data: { startedAt: new Date(th.startedAt.getTime() - DAY_MS), lastTurnAt: th.lastTurnAt ? new Date(th.lastTurnAt.getTime() - DAY_MS) : undefined, endedAt: th.endedAt ? new Date(th.endedAt.getTime() - DAY_MS) : undefined } });
}
actions.push('ChatThread -24h');
// 5. segnali task_blocked di oggi -> -24h (il blocco e' successo "ieri sera")
const sigs = await db.learningSignal.findMany({ where: { userId: u.id, signalType: 'task_blocked' } });
for (const s of sigs) {
  if (Date.now() - s.createdAt.getTime() < 12 * 3600e3) {
    await db.learningSignal.update({ where: { id: s.id }, data: { createdAt: new Date(s.createdAt.getTime() - DAY_MS) } });
    actions.push(`LearningSignal ${s.id} -24h (eta' ora ${(((Date.now() - s.createdAt.getTime()) + DAY_MS) / 3600e3).toFixed(1)}h)`);
  }
}
console.log(actions.join('\n'));

// ── verifica: Today di "domattina" ───────────────────────────────────────────
const r = await api('GET', '/api/daily-plan', { cookie });
assert(r.status === 200, 'GET /api/daily-plan: 200', r.status);
const j = r.json as { recovery?: Record<string, { reason: string; microStep: string }>; source?: string; plan?: { doNowIds?: string[] } };
const rec = j.recovery ?? {};
console.log('source:', j.source, '| recovery keys:', Object.keys(rec));
const blocked = await db.task.findFirst({ where: { userId: u.id, title: { contains: 'dichiarazione' } }, select: { id: true, title: true } });
const hit = rec[blocked!.id];
assert(hit !== undefined, 'micro-step di rientro presente sul task bloccato ieri sera (65E2)', Object.keys(rec));
if (hit) {
  console.log(`recovery: reason="${hit.reason}" microStep="${hit.microStep}"`);
  if (!/non so da dove iniziare/i.test(hit.reason)) {
    warn(`reason mostrata all'utente = "${hit.reason}" — NON e' il blocco reale dichiarato in review ("non so da dove iniziare..."): la cattura whatBlocked ha preso la battuta successiva generica`);
  }
}
assert(j.source === 'review', 'source = review (piano scritto dalla review)', j.source);

// riproduzione x2
const r2 = await api('GET', '/api/daily-plan', { cookie });
const hit2 = ((r2.json as typeof j).recovery ?? {})[blocked!.id];
assert(hit2?.microStep === hit?.microStep, 'riprodotto (2a GET identica)');

saveEvidence(J, 'j5-40-retrodate.json', JSON.stringify({ actions, status: r.status, source: j.source, recovery: rec, body: r.json }, null, 2));
finish('j5-40-retrodate');
