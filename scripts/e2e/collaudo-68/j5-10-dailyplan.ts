/**
 * Collaudo 68 — J5 "Il procrastinatore" — passo 1 (R12 / 65E2).
 * Il task_blocked fresco (≤36h, seminato dal seed) produce il micro-step di
 * rientro in GET /api/daily-plan? Shape della risposta {recovery}.
 * Caso A: piano di oggi VUOTO (top3Ids=[]) — comportamento as-is del seed.
 * Caso B (adversariale): task bloccato inserito in top3Ids → recovery atteso.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j5-10-dailyplan.ts
 */
import { preflightDb, cohortUser, mintCookie, api, assert, warn, finish, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J5';
await preflightDb();

const u = await cohortUser('procrastinatore');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 procrastinatore' });
const today = formatTodayInRome();

const sig = await db.learningSignal.findFirst({
  where: { userId: u.id, signalType: 'task_blocked' },
  orderBy: { createdAt: 'desc' },
});
assert(!!sig, 'seed: LearningSignal task_blocked presente', sig?.id);
const blockedTaskId = sig?.taskId ?? '';
const ageH = sig ? (Date.now() - sig.createdAt.getTime()) / 3600e3 : 999;
assert(ageH <= 36, `seed: segnale fresco (${ageH.toFixed(1)}h ≤ 36h)`);

const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
assert(!!plan, 'seed: DailyPlan di oggi presente', plan?.id);
const origTop3 = plan?.top3Ids ?? '[]';

// ── Caso A: piano vuoto (as-is) ──────────────────────────────────────────────
const a = await api('GET', '/api/daily-plan', { cookie });
assert(a.status === 200, 'GET /api/daily-plan (piano vuoto): 200', a.status);
const aJson = a.json as { recovery?: Record<string, { reason: string; microStep: string }>; plan?: unknown; source?: string };
const aRecovery = aJson.recovery ?? {};
console.log('caso A recovery keys:', Object.keys(aRecovery));
if (Object.keys(aRecovery).length === 0) {
  warn('caso A: piano di oggi vuoto -> recovery {} — il micro-step di rientro esiste SOLO se il task bloccato è dentro il piano (top3/doNow/...). Un procrastinatore senza piano non vede alcun rientro (L2/L3).');
} else {
  console.log('caso A: recovery presente anche con top3Ids=[]', aRecovery);
}
saveEvidence(J, 'j5-10-casoA-piano-vuoto.json', JSON.stringify({ status: a.status, body: a.json }, null, 2));

// ── Caso B: task bloccato nel piano ─────────────────────────────────────────
await db.dailyPlan.update({ where: { id: plan!.id }, data: { top3Ids: JSON.stringify([blockedTaskId]) } });
const b = await api('GET', '/api/daily-plan', { cookie });
assert(b.status === 200, 'GET /api/daily-plan (task nel piano): 200', b.status);
const bJson = b.json as { recovery?: Record<string, { reason: string; microStep: string }>; source?: string };
const rec = (bJson.recovery ?? {})[blockedTaskId];
assert(rec !== undefined, 'caso B: recovery[taskBloccato] presente', Object.keys(bJson.recovery ?? {}));
assert(rec?.reason === 'non so da dove iniziare', 'caso B: reason = whatBlocked verbatim', rec?.reason);
assert((rec?.microStep ?? '').length > 0, 'caso B: microStep generato dall\'engine', rec?.microStep);
console.log('caso B recovery:', JSON.stringify(rec));
console.log('source:', bJson.source);
saveEvidence(J, 'j5-10-casoB-task-in-piano.json', JSON.stringify({ status: b.status, recovery: bJson.recovery, source: bJson.source }, null, 2));

// riproduzione x2 (regola finding riprodotti)
const b2 = await api('GET', '/api/daily-plan', { cookie });
const rec2 = ((b2.json as typeof bJson).recovery ?? {})[blockedTaskId];
assert(rec2?.microStep === rec?.microStep, 'caso B riprodotto (2a GET identica)', rec2);

// ripristino stato seed
await db.dailyPlan.update({ where: { id: plan!.id }, data: { top3Ids: origTop3 } });
console.log('ripristinato top3Ids =', origTop3);

finish('j5-10-dailyplan');
