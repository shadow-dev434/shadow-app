/**
 * Collaudo 68 — J4-bis passo 2 (pista N18 parziale): cosa mostrano Cielo e
 * streak a un utente fermo da 15 giorni?
 * GET /api/sky + GET /api/streaks (entrambe read-only a codice) sul fantasma.
 * Interesse: streak stantio/incoerente, dati che colpevolizzano o confondono.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-15-sky-streaks.ts
 */
import { preflightDb, api, cohortUser, mintCookie, saveEvidence, assert, finish, db } from './lib';

const J = 'J4bis';

await preflightDb();
const user = await cohortUser('fantasma');
const cookie = await mintCookie({ userId: user.id, email: user.email });

const sky = await api('GET', '/api/sky', { cookie });
console.log(`[J4bis] GET /api/sky -> ${sky.status}\n${JSON.stringify(sky.json, null, 2)}`);
assert(sky.status === 200, 'GET /api/sky: 200', sky.status);

// Task 71: /api/streaks rimossa (route orfana, zero consumer — la fonte
// stantia N18 non esiste più). Verifica di chiusura: 404, nessun dato
// colpevolizzante servito al fantasma da quella superficie.
const st = await api('GET', '/api/streaks?days=30', { cookie });
console.log(`[J4bis] GET /api/streaks -> ${st.status}`);
assert(st.status === 404, 'GET /api/streaks: 404 (route rimossa dal Task 71)', st.status);
saveEvidence(J, '15-sky-streaks.json', JSON.stringify({ sky: { status: sky.status, body: sky.json }, streaks: { status: st.status, note: 'route rimossa (Task 71)' } }, null, 2));

await db.$disconnect();
finish('j4b-15-sky-streaks');
