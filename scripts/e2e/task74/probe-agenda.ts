/**
 * Task 74 — probe: GET /api/calendar in modalità agenda (?from&to).
 *
 * Seed diretto a DB (utente effimero): piano di oggi con fascia morning (un
 * task normale + un'istanza ricorrente materializzata), una scadenza oggi, un
 * template ricorrente daily. Verifica: shape days, fasce, orario Rome della
 * deadline, proiezione ricorrente SENZA doppione dove l'istanza è già in
 * piano, retro-compatibilità della shape legacy senza parametri, 400 sui
 * range invalidi.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task74/probe-agenda.ts
 */
import {
  api,
  assert,
  createEphemeralUser,
  deleteEphemeralUser,
  finish,
  preflightDb,
  db,
} from '../collaudo-68/lib';
import { addDaysIso, formatTodayInRome, hhmmInRome } from '../../../src/lib/evening-review/dates';

await preflightDb();
const u = await createEphemeralUser('t74-agenda');

try {
  const today = formatTodayInRome();
  const to = addDaysIso(today, 6);

  // ── seed ──────────────────────────────────────────────────────────────────
  const plain = await db.task.create({
    data: { userId: u.id, title: 'Probe74 piano', status: 'planned' },
  });
  const template = await db.recurringTask.create({
    data: {
      userId: u.id,
      title: 'Probe74 ricorrente',
      frequency: 'daily',
      weekdays: '[]',
      startDate: addDaysIso(today, -10),
    },
  });
  const instance = await db.task.create({
    data: {
      userId: u.id,
      title: 'Probe74 ricorrente',
      status: 'planned',
      recurringTemplateId: template.id,
      occurrenceDate: today,
      source: 'recurring',
    },
  });
  await db.dailyPlan.create({
    data: {
      userId: u.id,
      date: today,
      tasks: {
        create: [
          { taskId: plain.id, slot: 'morning' },
          { taskId: instance.id, slot: 'morning' },
        ],
      },
    },
  });
  const deadlineAt = new Date(`${today}T13:00:00Z`);
  const withDeadline = await db.task.create({
    data: { userId: u.id, title: 'Probe74 scadenza', status: 'inbox', deadline: deadlineAt },
  });

  // ── agenda ────────────────────────────────────────────────────────────────
  const res = await api('GET', `/api/calendar?from=${today}&to=${to}`, { cookie: u.cookie });
  assert(res.status === 200, 'agenda → 200', res.status);
  const days = (res.json as { days?: Array<Record<string, unknown>> }).days ?? [];
  assert(days.length === 7, '7 giorni nel range', days.length);

  const day0 = days[0] as {
    date: string;
    plan: { source: string; slots: { morning: Array<{ id: string; title: string; isRecurring: boolean }> } | null } | null;
    deadlines: Array<{ id: string; title: string; time: string }>;
    recurring: Array<{ templateId: string; title: string; rule: string }>;
  };
  assert(day0.date === today, 'day0 = oggi', day0.date);
  assert(day0.plan?.source === 'review', 'piano con fasce → source review', day0.plan?.source);
  const morningTitles = (day0.plan?.slots?.morning ?? []).map((t) => t.title).sort();
  assert(
    JSON.stringify(morningTitles) === JSON.stringify(['Probe74 piano', 'Probe74 ricorrente']),
    'fascia morning con i 2 task del piano',
    morningTitles,
  );
  const instItem = day0.plan?.slots?.morning.find((t) => t.id === instance.id);
  assert(instItem?.isRecurring === true, 'istanza marcata isRecurring', instItem);

  const dl = day0.deadlines.find((d) => d.id === withDeadline.id);
  assert(dl !== undefined, 'scadenza di oggi presente', day0.deadlines);
  assert(dl?.time === hhmmInRome(deadlineAt), 'orario deadline in Europe/Rome', dl?.time);

  assert(
    !day0.recurring.some((r) => r.templateId === template.id),
    'niente chip fantasma oggi (istanza già in piano)',
    day0.recurring,
  );
  const day1 = days[1] as typeof day0;
  const ghost = day1.recurring.find((r) => r.templateId === template.id);
  assert(ghost !== undefined, 'proiezione ricorrente su domani', day1.recurring);
  assert(ghost?.rule === 'tutti i giorni', 'regola descritta in italiano', ghost?.rule);

  // ── legacy senza parametri ────────────────────────────────────────────────
  const legacy = await api('GET', '/api/calendar', { cookie: u.cookie });
  assert(legacy.status === 200, 'legacy → 200', legacy.status);
  const events = (legacy.json as { events?: Array<{ id: string }> }).events ?? [];
  assert(events.some((e) => e.id === withDeadline.id), 'legacy events contiene la scadenza', events.length);

  // ── validazioni ───────────────────────────────────────────────────────────
  const badFmt = await api('GET', '/api/calendar?from=2026-7-1&to=2026-07-10', { cookie: u.cookie });
  assert(badFmt.status === 400, 'formato non YMD → 400', badFmt.status);
  const inverted = await api('GET', `/api/calendar?from=${to}&to=${today}`, { cookie: u.cookie });
  assert(inverted.status === 400, 'to < from → 400', inverted.status);
  const tooWide = await api('GET', `/api/calendar?from=${today}&to=${addDaysIso(today, 40)}`, {
    cookie: u.cookie,
  });
  assert(tooWide.status === 400, 'range > 31 giorni → 400', tooWide.status);
  const noAuth = await api('GET', `/api/calendar?from=${today}&to=${to}`);
  assert(noAuth.status === 401, 'senza sessione → 401', noAuth.status);
} finally {
  await deleteEphemeralUser(u.email);
  await db.$disconnect();
}
finish('probe-agenda');
