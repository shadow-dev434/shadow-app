/**
 * Task 65 (A3/D71) — campi Settings: i morti sono ignorati dal PATCH, i vivi
 * persistono, gli orari invalidi danno 400 (regressione 64-B2).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-settings-fields.ts
 * Richiede dev server su :3000 + DB royal-feather.
 */
import { preflightDb, api, assert, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';

await preflightDb();
const user = await createEphemeralUser('settings');

try {
  // I campi morti non passano piu' dalla whitelist.
  const dead = await api('PATCH', '/api/settings', {
    cookie: user.cookie,
    body: { defaultEnergy: 5, theme: 'dark', productiveSlots: '["evening"]', defaultDuration: 99 },
  });
  assert(dead.status === 200, 'PATCH campi morti: 200 (ignorati, non errore)', dead.status);
  const row1 = await db.settings.findFirst({ where: { userId: user.id } });
  assert(row1?.defaultEnergy === 3, 'defaultEnergy NON scritto (default 3)', row1?.defaultEnergy);
  assert(row1?.theme === 'system', 'theme NON scritto (default system)', row1?.theme);
  assert(row1?.defaultDuration === 25, 'defaultDuration NON scritto (default 25)', row1?.defaultDuration);

  // I campi vivi persistono.
  const alive = await api('PATCH', '/api/settings', {
    cookie: user.cookie,
    body: { wakeTime: '06:30', sleepTime: '22:45', eveningWindowStart: '19:00', notificationsEnabled: false },
  });
  assert(alive.status === 200, 'PATCH campi vivi: 200', alive.status);
  const row2 = await db.settings.findFirst({ where: { userId: user.id } });
  assert(row2?.wakeTime === '06:30', 'wakeTime persistito', row2?.wakeTime);
  assert(row2?.sleepTime === '22:45', 'sleepTime persistito', row2?.sleepTime);
  assert(row2?.eveningWindowStart === '19:00', 'eveningWindowStart persistito', row2?.eveningWindowStart);
  assert(row2?.notificationsEnabled === false, 'notificationsEnabled persistito', row2?.notificationsEnabled);

  // Orario invalido -> 400 (64-B2, non deve regredire con la nuova whitelist).
  const bad = await api('PATCH', '/api/settings', { cookie: user.cookie, body: { wakeTime: '25:99' } });
  assert(bad.status === 400, 'PATCH wakeTime invalido: 400', bad.status);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task65-settings-fields');
