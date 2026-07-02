/**
 * Task 65 (B3/D49) — API /api/recurring: lista con descrizione IT, pausa
 * ferma la materializzazione, delete lascia vive le istanze (FK SetNull),
 * ownership 404.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-recurring-api.ts
 * Richiede dev server su :3000 + DB royal-feather.
 */
import { preflightDb, api, assert, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

await preflightDb();
const user = await createEphemeralUser('recurring-api');
const intruder = await createEphemeralUser('recurring-intruder');
const today = formatTodayInRome();

try {
  const daily = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 meditazione', frequency: 'daily', weekdays: '[]', startDate: addDaysIso(today, -1) },
  });
  const weekly = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 palestra', frequency: 'weekly', weekdays: '[1,4]', startDate: addDaysIso(today, -1) },
  });

  // GET lista con descrizione italiana pronta per la UI.
  const list = await api('GET', '/api/recurring', { cookie: user.cookie });
  assert(list.status === 200, 'GET /api/recurring: 200', list.status);
  const rows = (list.json as { recurring: { id: string; title: string; description: string; active: boolean }[] }).recurring;
  assert(rows.length === 2, 'lista: 2 template', rows.length);
  assert(rows.find(r => r.id === daily.id)?.description === 'tutti i giorni', 'descrizione IT daily', rows.find(r => r.id === daily.id)?.description);
  assert((rows.find(r => r.id === weekly.id)?.description ?? '').includes('luned'), 'descrizione IT weekly coi giorni', rows.find(r => r.id === weekly.id)?.description);

  // PATCH pausa: active=false e la materializzazione lo salta.
  const pause = await api('PATCH', `/api/recurring/${daily.id}`, { cookie: user.cookie, body: { active: false } });
  assert(pause.status === 200, 'PATCH pausa: 200', pause.status);
  await api('GET', '/api/tasks', { cookie: user.cookie }); // trigger materializzazione
  const pausedInst = await db.task.count({ where: { recurringTemplateId: daily.id } });
  assert(pausedInst === 0, 'template in pausa: la GET tasks non materializza', pausedInst);

  // PATCH input invalido -> 400; riattiva -> 200.
  const bad = await api('PATCH', `/api/recurring/${daily.id}`, { cookie: user.cookie, body: { active: 'si' } });
  assert(bad.status === 400, 'PATCH active non-boolean: 400', bad.status);
  const resume = await api('PATCH', `/api/recurring/${daily.id}`, { cookie: user.cookie, body: { active: true } });
  assert(resume.status === 200, 'PATCH riattiva: 200', resume.status);

  // Ownership: il template di A non e' visibile/modificabile da B.
  const foreign = await api('PATCH', `/api/recurring/${daily.id}`, { cookie: intruder.cookie, body: { active: false } });
  assert(foreign.status === 404, 'PATCH da altro utente: 404', foreign.status);

  // DELETE: template via, istanze superstiti con FK null (stelle salve).
  await api('GET', '/api/tasks', { cookie: user.cookie }); // materializza l'istanza di oggi del daily riattivato
  const beforeDel = await db.task.findFirst({ where: { recurringTemplateId: daily.id } });
  assert(beforeDel !== null, 'istanza presente prima del delete');
  const del = await api('DELETE', `/api/recurring/${daily.id}`, { cookie: user.cookie });
  assert(del.status === 200, 'DELETE: 200', del.status);
  assert((await db.recurringTask.findFirst({ where: { id: daily.id } })) === null, 'template eliminato');
  const orphan = await db.task.findFirst({ where: { id: beforeDel!.id } });
  assert(orphan !== null && orphan.recurringTemplateId === null && orphan.source === 'recurring',
    'istanza superstite: FK null, source recurring (stella salva)', { tpl: orphan?.recurringTemplateId, source: orphan?.source });

  const delAgain = await api('DELETE', `/api/recurring/${daily.id}`, { cookie: user.cookie });
  assert(delAgain.status === 404, 'DELETE ripetuto: 404', delAgain.status);
} finally {
  await deleteEphemeralUser(user.email);
  await deleteEphemeralUser(intruder.email);
}

finish('task65-recurring-api');
