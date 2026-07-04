/**
 * Collaudo 68 — J4-bis passo 2 (pista N18 parziale): cosa mostrano Cielo e
 * streak a un utente fermo da 15 giorni?
 * GET /api/sky + GET /api/streaks (entrambe read-only a codice) sul fantasma.
 * Interesse: streak stantio/incoerente, dati che colpevolizzano o confondono.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-15-sky-streaks.ts
 */
import { preflightDb, api, cohortUser, mintCookie, saveEvidence, assert, warn, finish, db } from './lib';

const J = 'J4bis';

await preflightDb();
const user = await cohortUser('fantasma');
const cookie = await mintCookie({ userId: user.id, email: user.email });

const sky = await api('GET', '/api/sky', { cookie });
console.log(`[J4bis] GET /api/sky -> ${sky.status}\n${JSON.stringify(sky.json, null, 2)}`);
assert(sky.status === 200, 'GET /api/sky: 200', sky.status);

const st = await api('GET', '/api/streaks?days=30', { cookie });
console.log(`[J4bis] GET /api/streaks -> ${st.status}`);
assert(st.status === 200, 'GET /api/streaks: 200', st.status);
const stBody = st.json as { currentStreak?: number; bestStreak?: number; totalCompleted?: number; totalAvoided?: number; streakData?: Array<{ date: string; completed: number; planned: number }> };
console.log(JSON.stringify({ ...stBody, streakData: `[${stBody.streakData?.length} giorni]` }, null, 2));
saveEvidence(J, '15-sky-streaks.json', JSON.stringify({ sky: { status: sky.status, body: sky.json }, streaks: { status: st.status, body: st.json } }, null, 2));

// N18: dopo 15gg di buio l'atteso onesto sarebbe streak 0 e serie piatta.
assert(stBody.currentStreak === 0, 'streak corrente = 0 (nessuna attivita\' recente)', stBody.currentStreak);
const nonZero = (stBody.streakData ?? []).filter((d) => d.completed > 0 || d.planned > 0);
if (nonZero.length > 0) warn('streakData con giorni non-zero inattesi', nonZero);
// bestStreak viene da UserPattern.streakDays (mai scritto nei flussi correnti — N18):
if ((stBody.bestStreak ?? 0) === 0 && (stBody.totalCompleted ?? 0) === 0) {
  console.log('[J4bis] N18: bestStreak/totalCompleted = 0 da UserPattern mai aggiornato — per il fantasma coerente, ma la fonte è stantia by-design');
}

await db.$disconnect();
finish('j4b-15-sky-streaks');
