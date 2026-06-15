/**
 * Probe e2e Task 46 — task ricorrenti contro il DB reale (post-migration).
 *
 * Verifica DETERMINISTICA (tutti HARD) della meccanica DB che gli unit test puri
 * (occursOn) non coprono: setTaskRecurrence crea il template e lega il task;
 * materializeRecurringForDate genera l'istanza del giorno, è idempotente (guardia
 * unique template+giorno), rispetta la regola (weekly), non ricrea istanze
 * completate; stopTaskRecurrence disattiva; il filtro "istanze future nascoste"
 * di get_today_tasks esclude domani ma tiene oggi.
 *
 * Strategia: utente probe usa-e-getta (pattern probe-chat-task-tools) + chiamate
 * DIRETTE agli helper (no dev server, no LLM, no costi). Cleanup in finally
 * (db.user.delete cascade).
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/probe-recurring.ts
 *
 * Exit 0 = nessun FAIL.
 */

import { db } from '../../src/lib/db';
import {
  setTaskRecurrence,
  stopTaskRecurrence,
  materializeRecurringForDate,
} from '../../src/lib/recurring/materialize';
import { formatTodayInRome, addDaysIso } from '../../src/lib/evening-review/dates';
import { weekdayOf } from '../../src/lib/recurring/recurrence';
import { terminalTaskStatuses } from '../../src/lib/types/shadow';

const PROBE_EMAIL = 'probe-recurring46@example.com';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) await db.user.delete({ where: { id: existing.id } });
  const user = await db.user.create({
    data: { email: PROBE_EMAIL, name: 'Probe Recurring46', password: 'not-a-real-login-46!' },
  });
  const userId = user.id;

  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const dayAfter = addDaysIso(today, 2);

  try {
    // ── 1. setTaskRecurrence daily su un task esistente ──────────────────────
    const daily = await db.task.create({
      data: { userId, title: 'Rispondere ai pazienti su WhatsApp (30 min)', status: 'inbox', urgency: 4, importance: 4, category: 'work' },
    });
    const setRes = await setTaskRecurrence(userId, daily.id, { frequency: 'daily' });
    check('1 setTaskRecurrence ok', setRes.ok === true, JSON.stringify(setRes));
    const dailyAfter = await db.task.findUnique({ where: { id: daily.id } });
    check('1 task legato al template', dailyAfter?.recurringTemplateId != null && dailyAfter.occurrenceDate === today,
      `tmpl=${dailyAfter?.recurringTemplateId} occ=${dailyAfter?.occurrenceDate}`);
    check('1 source=recurring sull’istanza', dailyAfter?.source === 'recurring', `source=${dailyAfter?.source}`);
    const tmplId = dailyAfter?.recurringTemplateId ?? '';
    const tmpl = await db.recurringTask.findUnique({ where: { id: tmplId } });
    check('1 template creato attivo, daily, eredita contenuto', tmpl?.active === true && tmpl?.frequency === 'daily' && tmpl?.urgency === 4 && tmpl?.title === daily.title,
      `active=${tmpl?.active} freq=${tmpl?.frequency} urg=${tmpl?.urgency}`);

    // ── 2. materializza DOMANI: crea una nuova istanza ───────────────────────
    const created1 = await materializeRecurringForDate(userId, tomorrow);
    check('2 materialize(domani) crea 1 istanza', created1.length === 1, `created=${created1.length}`);
    const tomorrowInst = await db.task.findFirst({ where: { userId, recurringTemplateId: tmplId, occurrenceDate: tomorrow } });
    check('2 istanza di domani eredita titolo/urgency/source', tomorrowInst?.title === daily.title && tomorrowInst?.urgency === 4 && tomorrowInst?.source === 'recurring' && tomorrowInst?.status === 'inbox',
      `title=${tomorrowInst?.title} status=${tomorrowInst?.status}`);

    // ── 3. idempotenza: seconda materializzazione non duplica ────────────────
    const created2 = await materializeRecurringForDate(userId, tomorrow);
    const tomorrowCount = await db.task.count({ where: { userId, recurringTemplateId: tmplId, occurrenceDate: tomorrow } });
    check('3 seconda materialize non crea nulla', created2.length === 0, `created=${created2.length}`);
    check('3 una sola istanza per (template, domani)', tomorrowCount === 1, `count=${tomorrowCount}`);

    // ── 4. filtro get_today_tasks: domani escluso, oggi incluso ──────────────
    const visibleToday = await db.task.findMany({
      where: {
        userId,
        status: { notIn: terminalTaskStatuses() },
        OR: [{ recurringTemplateId: null }, { occurrenceDate: { lte: today } }],
      },
      select: { id: true, occurrenceDate: true },
    });
    const ids = new Set(visibleToday.map((t) => t.id));
    check('4 istanza di oggi visibile in get_today_tasks', ids.has(daily.id));
    check('4 istanza di domani NON visibile oggi', tomorrowInst != null && !ids.has(tomorrowInst.id));

    // ── 5. completata: non ricreata nello stesso giorno ──────────────────────
    await db.task.update({ where: { id: daily.id }, data: { status: 'completed', completedAt: new Date() } });
    const createdAfterComplete = await materializeRecurringForDate(userId, today);
    const todayCount = await db.task.count({ where: { userId, recurringTemplateId: tmplId, occurrenceDate: today } });
    check('5 istanza completata non ricreata oggi', createdAfterComplete.length === 0 && todayCount === 1,
      `created=${createdAfterComplete.length} count=${todayCount}`);

    // ── 6. weekly: scatta solo nel giorno scelto ─────────────────────────────
    const weeklyTask = await db.task.create({
      data: { userId, title: 'Palestra', status: 'inbox', urgency: 3, importance: 3, category: 'health' },
    });
    const targetDay = addDaysIso(today, 4);
    const otherDay = addDaysIso(today, 5); // weekday diverso da targetDay
    const wRes = await setTaskRecurrence(userId, weeklyTask.id, { frequency: 'weekly', weekdays: [weekdayOf(targetDay)] });
    check('6 setTaskRecurrence weekly ok', wRes.ok === true, JSON.stringify(wRes));
    const onTarget = await materializeRecurringForDate(userId, targetDay);
    const onOther = await materializeRecurringForDate(userId, otherDay);
    // onTarget può includere anche l'istanza daily di targetDay: filtriamo per il template weekly.
    const weeklyTmplId = (await db.task.findUnique({ where: { id: weeklyTask.id } }))?.recurringTemplateId ?? '';
    const weeklyOnTarget = await db.task.count({ where: { userId, recurringTemplateId: weeklyTmplId, occurrenceDate: targetDay } });
    const weeklyOnOther = await db.task.count({ where: { userId, recurringTemplateId: weeklyTmplId, occurrenceDate: otherDay } });
    check('6 weekly scatta nel giorno scelto', weeklyOnTarget === 1, `count=${weeklyOnTarget} (created batch=${onTarget.length})`);
    check('6 weekly NON scatta in un altro giorno', weeklyOnOther === 0, `count=${weeklyOnOther} (created batch=${onOther.length})`);

    // ── 7. stopTaskRecurrence: niente nuove istanze ──────────────────────────
    const stopRes = await stopTaskRecurrence(userId, weeklyTask.id);
    check('7 stopTaskRecurrence ok', stopRes.ok === true, JSON.stringify(stopRes));
    const weeklyTmplAfter = await db.recurringTask.findUnique({ where: { id: weeklyTmplId } });
    check('7 template disattivato', weeklyTmplAfter?.active === false, `active=${weeklyTmplAfter?.active}`);
    // Un giorno-target futuro ulteriore che prima avrebbe matchato: ora niente.
    const futureTarget = addDaysIso(targetDay, 7); // stesso weekday di targetDay
    await materializeRecurringForDate(userId, futureTarget);
    const weeklyFuture = await db.task.count({ where: { userId, recurringTemplateId: weeklyTmplId, occurrenceDate: futureTarget } });
    check('7 nessuna istanza dopo lo stop', weeklyFuture === 0, `count=${weeklyFuture}`);
  } finally {
    await db.user.delete({ where: { id: userId } }).catch((err) => console.error('[cleanup] fallita:', err));
  }

  console.log(`\nEsito: ${failures} FAIL.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
