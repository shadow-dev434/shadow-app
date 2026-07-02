/**
 * Collaudo Task 62 — seed della coorte utenti di test (spec §6.5).
 *
 * Crea (o ricrea da zero) gli utenti `collaudo-<ruolo>@probe.local` con i
 * seed previsti dai journey J1-J10. Idempotente: ogni run cancella e ricrea.
 *
 * Uso (dev server NON necessario, scrive direttamente sul DB dev):
 *   bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/seed-cohort.ts
 * Flag:
 *   --cleanup   cancella TUTTI gli utenti collaudo-*@probe.local ed esce
 *   --only=<ruolo>[,<ruolo>]  ricrea solo alcuni ruoli (es. --only=tipo,strict)
 *
 * SICUREZZA: tocca SOLO utenti @probe.local. Password unica di collaudo
 * (bcrypt cost 12, stessa pipeline del register) per i login reali di J1/J10.
 */
import bcrypt from 'bcryptjs';
import { db } from '../../../src/lib/db';
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import { wakePreflight } from '../run-walk';

export const COLLAUDO_PASSWORD = 'Collaudo62!pass';
const DOMAIN = '@probe.local';

const args = process.argv.slice(2);
const CLEANUP_ONLY = args.includes('--cleanup');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

const ROLES = [
  'vergine', 'tipo', 'caos', 'rientro', 'procrastinatore', 'review',
  'ricorrenti', 'strict', 'errori', 'beta', 'admin', 'nonbeta',
] as const;
type Role = (typeof ROLES)[number];

function email(role: Role): string {
  return `collaudo-${role}${DOMAIN}`;
}

async function deleteRole(role: Role): Promise<void> {
  const u = await db.user.findUnique({ where: { email: email(role) } });
  if (u) await db.user.delete({ where: { id: u.id } });
}

/** Utente base: profilo completo (gate middleware passati) + settings + pattern. */
async function createBase(role: Role, hashed: string, profileExtra: Record<string, unknown> = {}) {
  const u = await db.user.create({
    data: {
      email: email(role),
      name: `Collaudo ${role[0].toUpperCase()}${role.slice(1)}`,
      password: hashed,
      profile: {
        create: {
          onboardingComplete: true,
          tourCompleted: true,
          consentGivenAt: new Date(),
          consentVersion: 'collaudo-62',
          role: 'worker',
          occupation: 'impiegato amministrativo',
          age: 34,
          mainResponsibilities: JSON.stringify(['lavoro', 'casa']),
          difficultAreas: JSON.stringify(['bureaucracy', 'admin']),
          ...profileExtra,
        },
      },
    },
  });
  await db.settings.create({ data: { userId: u.id } });
  await db.userPattern.create({ data: { userId: u.id } });
  return u;
}

const today = formatTodayInRome();

const seeders: Record<Role, (hashed: string) => Promise<string>> = {
  // J1: parte dal register REALE → deve NON esistere.
  vergine: async () => {
    return '(assente: riservato al register reale di J1)';
  },

  // J2: profilo completo + 7 task misti + DailyPlan di oggi.
  tipo: async (hashed) => {
    const u = await createBase('tipo', hashed);
    const mk = (data: Record<string, unknown>) =>
      db.task.create({ data: { userId: u.id, ...data } as never });
    const t1 = await mk({ title: 'Preparare la relazione trimestrale', status: 'planned', importance: 5, urgency: 4, quadrant: 'do_now', decision: 'do_now', priorityScore: 8.2, aiClassified: true, sessionDuration: 45, microSteps: JSON.stringify([{ text: 'Aprire il template', done: false }, { text: 'Compilare i dati Q2', done: false }, { text: 'Rileggere e inviare', done: false }]) });
    const t2 = await mk({ title: 'Pagare la bolletta della luce', status: 'planned', importance: 4, urgency: 5, quadrant: 'do_now', decision: 'do_now', priorityScore: 7.9, aiClassified: true, deadline: startOfDayInZone(addDaysIso(today, 1)) });
    const t3 = await mk({ title: 'Chiamare il dentista per appuntamento', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', priorityScore: 5.1, aiClassified: true, category: 'health' });
    await mk({ title: 'Riordinare la scrivania', status: 'inbox', importance: 2, urgency: 2 });
    await mk({ title: 'Rispondere alle mail arretrate', status: 'inbox', importance: 3, urgency: 3 });
    await mk({ title: 'Comprare regalo per Marta', status: 'inbox', importance: 3, urgency: 2, deadline: startOfDayInZone(addDaysIso(today, 6)) });
    await mk({ title: 'Fare la spesa settimanale', status: 'completed', importance: 3, urgency: 3, completedAt: new Date() });
    await db.dailyPlan.create({
      data: {
        userId: u.id, date: today,
        top3Ids: JSON.stringify([t1.id, t2.id, t3.id]),
        energyLevel: 4, timeAvailable: 360,
      },
    });
    return u.id;
  },

  // J3: profilo completo, inbox vuota (le 15 catture le fa la chat).
  caos: async (hashed) => (await createBase('caos', hashed)).id,

  // J4: thread general + piano + review retrodatati di 4 giorni, 2 task scaduti.
  rientro: async (hashed) => {
    const u = await createBase('rientro', hashed);
    const d4 = addDaysIso(today, -4);
    const past = startOfDayInZone(d4);
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Inviare il modulo ISEE', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, -2)), createdAt: past, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Rinnovare assicurazione auto', status: 'planned', importance: 4, urgency: 4, deadline: startOfDayInZone(addDaysIso(today, -1)), createdAt: past, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    const thread = await db.chatThread.create({
      data: {
        userId: u.id, mode: 'general', state: 'active',
        startedAt: past, lastTurnAt: past,
        messages: {
          create: [
            { role: 'user', content: 'Ciao Shadow, oggi devo fare ISEE e assicurazione', createdAt: past },
            { role: 'assistant', content: 'Perfetto, li ho segnati entrambi. Da quale partiamo?', createdAt: past },
          ],
        },
      },
    });
    await db.dailyPlan.create({ data: { userId: u.id, date: d4, top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 3, createdAt: past, threadId: thread.id } });
    await db.review.create({ data: { userId: u.id, date: addDaysIso(today, -5), whatDone: 'spesa', mood: 3, energyEnd: 3, createdAt: startOfDayInZone(addDaysIso(today, -5)) } });
    return u.id;
  },

  // J5: 3 task rimandati 3+ volte / evitati 2+ volte.
  procrastinatore: async (hashed) => {
    const u = await createBase('procrastinatore', hashed);
    const mk = (data: Record<string, unknown>) =>
      db.task.create({ data: { userId: u.id, ...data } as never });
    await mk({ title: 'Compilare la dichiarazione dei redditi', status: 'planned', importance: 5, urgency: 5, resistance: 5, postponedCount: 4, avoidanceCount: 3, lastAvoidedAt: new Date(), quadrant: 'do_now', decision: 'decompose_then_do', aiClassified: true, createdAt: startOfDayInZone(addDaysIso(today, -10)) });
    await mk({ title: 'Prenotare la visita medica di controllo', status: 'planned', importance: 4, urgency: 3, resistance: 4, postponedCount: 3, avoidanceCount: 2, lastAvoidedAt: new Date(), category: 'health', quadrant: 'do_now', decision: 'do_now', aiClassified: true, createdAt: startOfDayInZone(addDaysIso(today, -8)) });
    await mk({ title: 'Scrivere la mail difficile al capo', status: 'planned', importance: 4, urgency: 4, resistance: 5, postponedCount: 5, avoidanceCount: 4, lastAvoidedAt: new Date(), quadrant: 'do_now', decision: 'decompose_then_do', aiClassified: true, createdAt: startOfDayInZone(addDaysIso(today, -12)) });
    await mk({ title: 'Portare il pacco alle poste', status: 'inbox', importance: 2, urgency: 3 });
    await db.dailyPlan.create({ data: { userId: u.id, date: today, top3Ids: '[]', energyLevel: 3 } });
    return u.id;
  },

  // J6: mix candidate per il triage serale.
  review: async (hashed) => {
    const u = await createBase('review', hashed);
    const mk = (data: Record<string, unknown>) =>
      db.task.create({ data: { userId: u.id, ...data } as never });
    await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    await mk({ title: 'Pagare il bollo auto', status: 'planned', importance: 4, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, -1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    await mk({ title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: startOfDayInZone(addDaysIso(today, -3)) });
    await mk({ title: 'Comprare le lampadine', status: 'inbox', importance: 2, urgency: 2 });
    await db.recurringTask.create({ data: { userId: u.id, title: 'Palestra', frequency: 'weekly', weekdays: JSON.stringify([1, 3]), startDate: addDaysIso(today, -14), active: true } });
    return u.id;
  },

  // J7: profilo pulito, le ricorrenze si creano dalla chat.
  ricorrenti: async (hashed) => (await createBase('ricorrenti', hashed)).id,

  // J8: blockedApps nel profilo + piano oggi.
  strict: async (hashed) => {
    const u = await createBase('strict', hashed, {
      blockedApps: JSON.stringify(['com.instagram.android', 'com.zhiliaoapp.musically', 'com.twitter.android']),
    });
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Scrivere il capitolo 2 della tesi', status: 'planned', importance: 5, urgency: 4, sessionDuration: 50, quadrant: 'do_now', decision: 'do_now', aiClassified: true, microSteps: JSON.stringify([{ text: 'Rileggere gli appunti', done: false }, { text: 'Scrivere la scaletta', done: false }, { text: 'Buttare giù 500 parole', done: false }]) } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Sistemare le slide della presentazione', status: 'planned', importance: 4, urgency: 3, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    await db.dailyPlan.create({ data: { userId: u.id, date: today, top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 4 } });
    return u.id;
  },

  // J9: profilo completo + 2 task per gli error path su azioni task.
  errori: async (hashed) => {
    const u = await createBase('errori', hashed);
    await db.task.create({ data: { userId: u.id, title: 'Task cavia per errori', status: 'inbox', importance: 3, urgency: 3 } });
    await db.task.create({ data: { userId: u.id, title: 'Secondo task cavia', status: 'planned', importance: 3, urgency: 3 } });
    return u.id;
  },

  // J10: gate beta/admin/nonbeta (allowlist in .env.local, prerequisiti §3).
  beta: async (hashed) => (await createBase('beta', hashed)).id,
  admin: async (hashed) => (await createBase('admin', hashed)).id,
  nonbeta: async (hashed) => (await createBase('nonbeta', hashed)).id,
};

async function main(): Promise<void> {
  await wakePreflight();

  if (CLEANUP_ONLY) {
    const users = await db.user.findMany({
      where: { email: { startsWith: 'collaudo-', endsWith: DOMAIN } },
      select: { id: true, email: true },
    });
    for (const u of users) await db.user.delete({ where: { id: u.id } });
    console.log(`[seed-cohort] cleanup: ${users.length} utenti collaudo cancellati.`);
    return;
  }

  const roles = (ONLY ? ROLES.filter((r) => ONLY.includes(r)) : ROLES) as Role[];
  const hashed = await bcrypt.hash(COLLAUDO_PASSWORD, 12);
  const out: Array<{ role: Role; email: string; userId: string }> = [];

  for (const role of roles) {
    await deleteRole(role);
    const userId = await seeders[role](hashed);
    out.push({ role, email: email(role), userId });
    console.log(`[seed-cohort] ${role.padEnd(16)} ${email(role).padEnd(38)} ${userId}`);
  }
  console.log(`[seed-cohort] fatto: ${out.length} ruoli. Password unica di collaudo: vedere COLLAUDO_PASSWORD nello script.`);
}

main()
  .catch((err) => {
    console.error('[FATAL] seed-cohort:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
