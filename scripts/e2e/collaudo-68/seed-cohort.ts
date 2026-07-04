/**
 * Collaudo 68 — seed della coorte utenti di test (spec §6.6).
 *
 * Crea (o ricrea da zero) gli utenti `collaudo68-<ruolo>@probe.local` con i
 * seed previsti dai journey J1-J13. Idempotente: ogni run cancella e ricrea.
 * PURE-DB: nessuna chiamata API → non richiede il dev server. Le finestre
 * serali si aprono per-journey via openEveningWindow (con ripristino, §2.12).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/seed-cohort.ts
 * Flag:
 *   --cleanup                 cancella TUTTI i collaudo68-*@probe.local ed esce
 *   --only=<ruolo>[,<ruolo>]  ricrea solo alcuni ruoli (es. --only=tipo,review-g)
 *
 * SICUREZZA: tocca SOLO utenti collaudo68-*@probe.local sul DB dev royal-feather
 * (preflightDb). Password unica: COHORT_PASSWORD (bcrypt 12) per i login reali.
 */
import bcrypt from 'bcryptjs';
import { preflightDb, db, COHORT_PASSWORD } from './lib';
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';

const DOMAIN = '@probe.local';

const args = process.argv.slice(2);
const CLEANUP_ONLY = args.includes('--cleanup');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

const REVIEW_DOORS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] as const;

const ROLES = [
  'tipo', 'caos', 'rientro', 'fantasma', 'procrastinatore',
  ...REVIEW_DOORS.map((d) => `review-${d}`),
  'sommerso', 'ricorrenti', 'strict', 'body', 'pwa', 'errori',
  'beta', 'admin', 'nonbeta', 'apprendista',
] as const;
type Role = (typeof ROLES)[number];

function email(role: Role): string {
  return `collaudo68-${role}${DOMAIN}`;
}

const today = formatTodayInRome();
const daysAgo = (n: number) => startOfDayInZone(addDaysIso(today, -n));
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);

/** Utente base: profilo completo (gate middleware passati) + settings + pattern. */
async function createBase(
  role: Role,
  hashed: string,
  profileExtra: Record<string, unknown> = {},
  opts: { consent?: boolean; onboarded?: boolean } = {},
) {
  const consent = opts.consent ?? true;
  const onboarded = opts.onboarded ?? true;
  const u = await db.user.create({
    data: {
      email: email(role),
      name: `C68 ${role[0].toUpperCase()}${role.slice(1)}`,
      password: hashed,
      profile: {
        create: {
          onboardingComplete: onboarded,
          tourCompleted: onboarded,
          ...(consent ? { consentGivenAt: new Date(), consentVersion: '0.2-draft', consentArt9: true } : {}),
          ...(onboarded
            ? {
                role: 'worker',
                occupation: 'impiegato amministrativo',
                age: 34,
                mainResponsibilities: JSON.stringify(['lavoro', 'casa']),
                difficultAreas: JSON.stringify(['bureaucracy', 'admin']),
              }
            : {}),
          ...profileExtra,
        },
      },
    },
  });
  await db.settings.create({ data: { userId: u.id } });
  await db.userPattern.create({ data: { userId: u.id } });
  return u;
}

const mkTask = (userId: string) => (data: Record<string, unknown>) =>
  db.task.create({ data: { userId, ...data } as never });

/** 3 candidate standard per il triage serale (pattern j6-seed). */
async function seedTriageCandidates(userId: string): Promise<void> {
  const mk = mkTask(userId);
  await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
  await mk({ title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: daysAgo(3) });
  await mk({ title: 'Chiamare il commercialista', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true });
}

const seeders: Record<Role, (hashed: string) => Promise<string>> = {
  // J2: profilo completo + 7 task misti + DailyPlan di oggi (pattern 62).
  tipo: async (hashed) => {
    const u = await createBase('tipo', hashed);
    const mk = mkTask(u.id);
    const t1 = await mk({ title: 'Preparare la relazione trimestrale', status: 'planned', importance: 5, urgency: 4, quadrant: 'do_now', decision: 'do_now', priorityScore: 8.2, aiClassified: true, sessionDuration: 45, microSteps: JSON.stringify([{ text: 'Aprire il template', done: false }, { text: 'Compilare i dati Q2', done: false }, { text: 'Rileggere e inviare', done: false }]) });
    const t2 = await mk({ title: 'Pagare la bolletta della luce', status: 'planned', importance: 4, urgency: 5, quadrant: 'do_now', decision: 'do_now', priorityScore: 7.9, aiClassified: true, deadline: startOfDayInZone(addDaysIso(today, 1)) });
    const t3 = await mk({ title: 'Chiamare il dentista per appuntamento', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', priorityScore: 5.1, aiClassified: true, category: 'health' });
    await mk({ title: 'Riordinare la scrivania', status: 'inbox', importance: 2, urgency: 2 });
    await mk({ title: 'Rispondere alle mail arretrate', status: 'inbox', importance: 3, urgency: 3 });
    await mk({ title: 'Comprare regalo per Marta', status: 'inbox', importance: 3, urgency: 2, deadline: startOfDayInZone(addDaysIso(today, 6)) });
    await mk({ title: 'Fare la spesa settimanale', status: 'completed', importance: 3, urgency: 3, completedAt: new Date() });
    await db.dailyPlan.create({
      data: { userId: u.id, date: today, top3Ids: JSON.stringify([t1.id, t2.id, t3.id]), energyLevel: 4, timeAvailable: 360 },
    });
    return u.id;
  },

  // J3: profilo completo, inbox vuota (le 15 catture le fa la chat).
  caos: async (hashed) => (await createBase('caos', hashed)).id,

  // J4: thread general + piano + review retrodatati di 4 giorni, 2 task scaduti.
  rientro: async (hashed) => {
    const u = await createBase('rientro', hashed);
    const past = daysAgo(4);
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Inviare il modulo ISEE', status: 'planned', importance: 5, urgency: 5, deadline: daysAgo(2), createdAt: past, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Rinnovare assicurazione auto', status: 'planned', importance: 4, urgency: 4, deadline: daysAgo(1), createdAt: past, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    const thread = await db.chatThread.create({
      data: {
        userId: u.id, mode: 'general', state: 'active', startedAt: past, lastTurnAt: past,
        messages: {
          create: [
            { role: 'user', content: 'Ciao Shadow, oggi devo fare ISEE e assicurazione', createdAt: past },
            { role: 'assistant', content: 'Perfetto, li ho segnati entrambi. Da quale partiamo?', createdAt: past },
          ],
        },
      },
    });
    await db.dailyPlan.create({ data: { userId: u.id, date: addDaysIso(today, -4), top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 3, createdAt: past, threadId: thread.id } });
    await db.review.create({ data: { userId: u.id, date: addDaysIso(today, -5), whatDone: 'spesa', mood: 3, energyEnd: 3, createdAt: daysAgo(5) } });
    return u.id;
  },

  // J4-bis: il drop-off ADHD reale — tutto retrodatato di 15 giorni.
  fantasma: async (hashed) => {
    const u = await createBase('fantasma', hashed);
    const past = daysAgo(15);
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Disdire l\'abbonamento in palestra', status: 'planned', importance: 4, urgency: 4, deadline: daysAgo(12), createdAt: past, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Prenotare il controllo dal dentista', status: 'planned', importance: 3, urgency: 3, createdAt: past, quadrant: 'schedule', decision: 'schedule', aiClassified: true } });
    const thread = await db.chatThread.create({
      data: {
        userId: u.id, mode: 'general', state: 'active', startedAt: past, lastTurnAt: past,
        messages: {
          create: [
            { role: 'user', content: 'Domani mi metto in pari con tutto', createdAt: past },
            { role: 'assistant', content: 'Ci sono. Ripartiamo con calma da una cosa sola.', createdAt: past },
          ],
        },
      },
    });
    await db.dailyPlan.create({ data: { userId: u.id, date: addDaysIso(today, -15), top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 2, createdAt: past, threadId: thread.id } });
    await db.review.create({ data: { userId: u.id, date: addDaysIso(today, -16), whatDone: 'poco', mood: 2, energyEnd: 2, createdAt: daysAgo(16) } });
    // notifiche email attive: serve a J4-bis/N61 (quante email avrebbe ricevuto in 15gg?)
    return u.id;
  },

  // J5: 3 task rimandati 3+ volte + 1 task_blocked fresco (≤36h, per 65E2).
  procrastinatore: async (hashed) => {
    const u = await createBase('procrastinatore', hashed);
    const mk = mkTask(u.id);
    const blocked = await mk({ title: 'Compilare la dichiarazione dei redditi', status: 'planned', importance: 5, urgency: 5, resistance: 5, postponedCount: 4, avoidanceCount: 3, lastAvoidedAt: new Date(), quadrant: 'do_now', decision: 'decompose_then_do', aiClassified: true, createdAt: daysAgo(10) });
    await mk({ title: 'Prenotare la visita medica di controllo', status: 'planned', importance: 4, urgency: 3, resistance: 4, postponedCount: 3, avoidanceCount: 2, lastAvoidedAt: new Date(), category: 'health', quadrant: 'do_now', decision: 'do_now', aiClassified: true, createdAt: daysAgo(8) });
    await mk({ title: 'Scrivere la mail difficile al capo', status: 'planned', importance: 4, urgency: 4, resistance: 5, postponedCount: 5, avoidanceCount: 4, lastAvoidedAt: new Date(), quadrant: 'do_now', decision: 'decompose_then_do', aiClassified: true, createdAt: daysAgo(12) });
    await mk({ title: 'Portare il pacco alle poste', status: 'inbox', importance: 2, urgency: 3 });
    await db.dailyPlan.create({ data: { userId: u.id, date: today, top3Ids: '[]', energyLevel: 3 } });
    await db.learningSignal.create({
      data: { userId: u.id, signalType: 'task_blocked', taskId: blocked.id, createdAt: hoursAgo(12), metadata: JSON.stringify({ reason: 'non so da dove iniziare' }) },
    });
    return u.id;
  },

  // ── J6: un utente per porta (mutuamente esclusive su utente+giorno) ──────
  // (a) walk felice completo: 3 candidate + 1 inbox + ricorrenza.
  'review-a': async (hashed) => {
    const u = await createBase('review-a', hashed);
    await seedTriageCandidates(u.id);
    await mkTask(u.id)({ title: 'Comprare le lampadine', status: 'inbox', importance: 2, urgency: 2 });
    await db.recurringTask.create({ data: { userId: u.id, title: 'Palestra', frequency: 'weekly', weekdays: JSON.stringify([1, 3]), startDate: addDaysIso(today, -14), active: true } });
    return u.id;
  },
  // (b) burnout in apertura, (c) scarico emotivo, (d) guardia-crisi: base + candidate.
  'review-b': async (hashed) => { const u = await createBase('review-b', hashed); await seedTriageCandidates(u.id); return u.id; },
  'review-c': async (hashed) => { const u = await createBase('review-c', hashed); await seedTriageCandidates(u.id); return u.id; },
  'review-d': async (hashed) => { const u = await createBase('review-d', hashed); await seedTriageCandidates(u.id); return u.id; },
  // (e) review interrotta → pausa → resume → abbandono oltre finestra.
  'review-e': async (hashed) => { const u = await createBase('review-e', hashed); await seedTriageCandidates(u.id); return u.id; },
  // (f) 0 candidate: NESSUN task.
  'review-f': async (hashed) => (await createBase('review-f', hashed)).id,
  // (g) auto-decomposizione 67C: 2 decompose_then_do SENZA microSteps + 1 CON (no-dup R18).
  'review-g': async (hashed) => {
    const u = await createBase('review-g', hashed);
    const mk = mkTask(u.id);
    await mk({ title: 'Preparare il trasloco della cantina', status: 'planned', importance: 4, urgency: 4, decision: 'decompose_then_do', quadrant: 'do_now', aiClassified: true, microSteps: '[]' });
    await mk({ title: 'Organizzare la festa di compleanno di Luca', status: 'planned', importance: 4, urgency: 3, decision: 'decompose_then_do', quadrant: 'do_now', aiClassified: true, microSteps: '[]' });
    await mk({ title: 'Sistemare il giardino', status: 'planned', importance: 3, urgency: 3, decision: 'decompose_then_do', quadrant: 'do_now', aiClassified: true, microSteps: JSON.stringify([{ text: 'Tagliare l\'erba', done: false }, { text: 'Potare la siepe', done: false }]) });
    return u.id;
  },
  // (h) chiusura d'ufficio 67B + caso avverso N2.
  'review-h': async (hashed) => { const u = await createBase('review-h', hashed); await seedTriageCandidates(u.id); return u.id; },
  // (i) idempotenza chiusura.
  'review-i': async (hashed) => { const u = await createBase('review-i', hashed); await seedTriageCandidates(u.id); return u.id; },
  // (j) trimming: 5 candidate perché il piano ne lasci fuori due (D46).
  'review-j': async (hashed) => {
    const u = await createBase('review-j', hashed);
    await seedTriageCandidates(u.id);
    const mk = mkTask(u.id);
    await mk({ title: 'Rinnovare il passaporto', status: 'planned', importance: 4, urgency: 3, quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    await mk({ title: 'Scrivere al proprietario di casa', status: 'planned', importance: 3, urgency: 4, quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    return u.id;
  },
  // (k) shame day: DailyPlan di IERI con 5 voci, 0 completate.
  'review-k': async (hashed) => {
    const u = await createBase('review-k', hashed);
    const mk = mkTask(u.id);
    const yesterday = addDaysIso(today, -1);
    const created = daysAgo(1);
    const ids: string[] = [];
    for (const title of [
      'Finire la presentazione per lunedì',
      'Pagare il bollo auto',
      'Chiamare l\'idraulico',
      'Portare le scarpe dal calzolaio',
      'Rispondere alla PEC dell\'agenzia',
    ]) {
      const t = await mk({ title, status: 'planned', importance: 4, urgency: 4, quadrant: 'do_now', decision: 'do_now', aiClassified: true, createdAt: created });
      ids.push(t.id as string);
    }
    await db.dailyPlan.create({ data: { userId: u.id, date: yesterday, top3Ids: JSON.stringify(ids.slice(0, 3)), doNowIds: JSON.stringify(ids.slice(3)), energyLevel: 4, createdAt: created } });
    return u.id;
  },

  // J13: overwhelm — 40 inbox + 15 candidate planned.
  sommerso: async (hashed) => {
    const u = await createBase('sommerso', hashed);
    const mk = mkTask(u.id);
    const inboxTitles = [
      'Rispondere alla mail di Franca', 'Comprare il detersivo', 'Cercare un idraulico', 'Stampare i documenti per la banca',
      'Disdire Netflix', 'Aggiornare il telefono', 'Portare i vestiti in lavanderia', 'Scrivere a Marco per il weekend',
      'Controllare l\'estratto conto', 'Prenotare il taglio di capelli', 'Cambiare la lampadina del bagno', 'Ordinare le lenti a contatto',
      'Iscriversi al corso di nuoto', 'Pagare la retta della palestra', 'Sistemare le foto delle vacanze', 'Buttare le scatole in cantina',
      'Comprare il regalo per la mamma', 'Rinnovare la carta d\'identità', 'Chiedere il rimborso ad Amazon', 'Leggere il contratto nuovo',
      'Fissare il colloquio con la maestra', 'Riparare la bici', 'Portare l\'auto dal gommista', 'Chiamare il veterinario',
      'Aggiornare il CV su LinkedIn', 'Svuotare la casella PEC', 'Comprare le pile per il telecomando', 'Registrarsi al portale INPS',
      'Scongelare il freezer', 'Sistemare i cavi della scrivania', 'Fare il backup del computer', 'Restituire il libro in biblioteca',
      'Scaricare i giustificativi per il commercialista', 'Prendere appuntamento in banca', 'Pulire i filtri del condizionatore', 'Scrivere la recensione del B&B',
      'Mandare gli auguri a zia Pina', 'Controllare le scadenze dell\'assicurazione', 'Comprare la stampante nuova', 'Organizzare l\'armadio invernale',
    ];
    for (const title of inboxTitles) await mk({ title, status: 'inbox', importance: 2 + (title.length % 3), urgency: 2 + (title.length % 2) });
    const plannedTitles = [
      'Consegnare il report al cliente', 'Preparare la riunione di giovedì', 'Pagare le tasse universitarie', 'Compilare il 730',
      'Rispondere al condominio', 'Finire il documento di progetto', 'Chiamare il medico per la ricetta', 'Rinnovare l\'abbonamento dei mezzi',
      'Sistemare la perdita del lavandino', 'Scrivere il verbale della riunione', 'Preparare le slide del corso', 'Ordinare i farmaci',
      'Mandare la disdetta della palestra', 'Fare il bonifico dell\'affitto', 'Completare l\'iscrizione al torneo',
    ];
    for (const [i, title] of plannedTitles.entries()) {
      await mk({ title, status: 'planned', importance: 3 + (i % 3), urgency: 3 + ((i + 1) % 3), quadrant: 'do_now', decision: 'do_now', aiClassified: true, createdAt: daysAgo(1 + (i % 5)) });
    }
    return u.id;
  },

  // J7: 2 template attivi con assenza 10gg simulata (ultima istanza -10gg).
  ricorrenti: async (hashed) => {
    const u = await createBase('ricorrenti', hashed);
    const daily = await db.recurringTask.create({ data: { userId: u.id, title: 'Prendere le medicine', frequency: 'daily', startDate: addDaysIso(today, -14), active: true, category: 'health' } });
    await db.recurringTask.create({ data: { userId: u.id, title: 'Palestra', frequency: 'weekly', weekdays: JSON.stringify([1, 3, 5]), startDate: addDaysIso(today, -14), active: true } });
    // ultima istanza materializzata e completata 10 giorni fa → da allora "assente"
    await db.task.create({
      data: {
        userId: u.id, title: 'Prendere le medicine', status: 'completed', importance: 3, urgency: 3,
        source: 'recurring', recurringTemplateId: daily.id, occurrenceDate: addDaysIso(today, -10),
        createdAt: daysAgo(10), completedAt: daysAgo(10),
      },
    });
    return u.id;
  },

  // J8: blockedApps nel profilo + piano oggi + task con microSteps.
  strict: async (hashed) => {
    const u = await createBase('strict', hashed, {
      blockedApps: JSON.stringify(['com.instagram.android', 'com.zhiliaoapp.musically', 'com.twitter.android']),
    });
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Scrivere il capitolo 2 della tesi', status: 'planned', importance: 5, urgency: 4, sessionDuration: 50, quadrant: 'do_now', decision: 'do_now', aiClassified: true, microSteps: JSON.stringify([{ text: 'Rileggere gli appunti', done: false }, { text: 'Scrivere la scaletta', done: false }, { text: 'Buttare giù 500 parole', done: false }]) } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Sistemare le slide della presentazione', status: 'planned', importance: 4, urgency: 3, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    await db.dailyPlan.create({ data: { userId: u.id, date: today, top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 4 } });
    return u.id;
  },

  // J11: body doubling — un task CON microSteps e uno SENZA.
  body: async (hashed) => {
    const u = await createBase('body', hashed);
    const t1 = await db.task.create({ data: { userId: u.id, title: 'Riordinare l\'archivio delle fatture', status: 'planned', importance: 4, urgency: 3, sessionDuration: 25, quadrant: 'do_now', decision: 'do_now', aiClassified: true, microSteps: JSON.stringify([{ text: 'Raccogliere le fatture sparse', done: false }, { text: 'Dividerle per anno', done: false }, { text: 'Archiviarle nei raccoglitori', done: false }]) } });
    const t2 = await db.task.create({ data: { userId: u.id, title: 'Stirare la pila di camicie', status: 'planned', importance: 3, urgency: 3, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
    await db.dailyPlan.create({ data: { userId: u.id, date: today, top3Ids: JSON.stringify([t1.id, t2.id]), energyLevel: 3 } });
    return u.id;
  },

  // J12: PWA/share — profilo completo + 1 task.
  pwa: async (hashed) => {
    const u = await createBase('pwa', hashed);
    await db.task.create({ data: { userId: u.id, title: 'Task esistente pre-share', status: 'planned', importance: 3, urgency: 3 } });
    return u.id;
  },

  // J9: SENZA consenso e SENZA onboarding (banner 500 su /consent e /onboarding).
  errori: async (hashed) => {
    const u = await createBase('errori', hashed, {}, { consent: false, onboarded: false });
    await db.task.create({ data: { userId: u.id, title: 'Task cavia per errori', status: 'inbox', importance: 3, urgency: 3 } });
    await db.task.create({ data: { userId: u.id, title: 'Secondo task cavia', status: 'planned', importance: 3, urgency: 3 } });
    return u.id;
  },

  // J10: gate beta/admin/nonbeta (allowlist in .env.local, §3).
  beta: async (hashed) => (await createBase('beta', hashed)).id,
  admin: async (hashed) => (await createBase('admin', hashed)).id,
  nonbeta: async (hashed) => (await createBase('nonbeta', hashed)).id,

  // §8.7: storico segnali per il loop di apprendimento.
  apprendista: async (hashed) => {
    const u = await createBase('apprendista', hashed);
    const mk = mkTask(u.id);
    const t1 = await mk({ title: 'Preparare il budget mensile', status: 'completed', importance: 4, urgency: 4, completedAt: daysAgo(2), createdAt: daysAgo(9), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    const t2 = await mk({ title: 'Scrivere la relazione annuale', status: 'planned', importance: 5, urgency: 4, resistance: 4, postponedCount: 2, createdAt: daysAgo(7), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
    const t3 = await mk({ title: 'Sistemare il garage', status: 'planned', importance: 3, urgency: 2, avoidanceCount: 2, lastAvoidedAt: daysAgo(1), createdAt: daysAgo(11), quadrant: 'schedule', decision: 'schedule', aiClassified: true });
    const sig = (data: Record<string, unknown>) => db.learningSignal.create({ data: { userId: u.id, ...data } as never });
    // 14 giorni di segnali misti, tutti non processati (pista N6)
    await sig({ signalType: 'task_completed', taskId: t1.id, createdAt: daysAgo(2), timeSlot: 'morning' });
    await sig({ signalType: 'task_completed', createdAt: daysAgo(4), timeSlot: 'morning' });
    await sig({ signalType: 'task_completed', createdAt: daysAgo(6), timeSlot: 'afternoon' });
    await sig({ signalType: 'task_completed', createdAt: daysAgo(9), timeSlot: 'morning' });
    await sig({ signalType: 'task_completed', createdAt: daysAgo(12), timeSlot: 'evening' });
    await sig({ signalType: 'task_postponed', taskId: t2.id, createdAt: daysAgo(3), timeSlot: 'evening' });
    await sig({ signalType: 'task_postponed', taskId: t2.id, createdAt: daysAgo(5), timeSlot: 'evening' });
    await sig({ signalType: 'task_postponed', createdAt: daysAgo(8), timeSlot: 'afternoon' });
    await sig({ signalType: 'task_avoided', taskId: t3.id, createdAt: daysAgo(1), timeSlot: 'morning' });
    await sig({ signalType: 'task_avoided', taskId: t3.id, createdAt: daysAgo(6), timeSlot: 'morning' });
    await sig({ signalType: 'nudge_accepted', createdAt: daysAgo(2), timeSlot: 'morning' });
    await sig({ signalType: 'nudge_accepted', createdAt: daysAgo(7), timeSlot: 'afternoon' });
    await sig({ signalType: 'task_blocked', taskId: t2.id, createdAt: hoursAgo(20), metadata: JSON.stringify({ reason: 'troppo grande' }) });
    await sig({ signalType: 'emotional_offload', createdAt: daysAgo(5), timeSlot: 'evening' });
    await db.review.create({ data: { userId: u.id, date: addDaysIso(today, -2), whatDone: 'budget', whatBlocked: 'relazione', mood: 3, energyEnd: 3, createdAt: daysAgo(2) } });
    await db.review.create({ data: { userId: u.id, date: addDaysIso(today, -5), whatDone: 'poco', mood: 2, energyEnd: 2, createdAt: daysAgo(5) } });
    return u.id;
  },
};

async function main(): Promise<void> {
  await preflightDb();

  if (CLEANUP_ONLY) {
    const users = await db.user.findMany({
      where: { email: { startsWith: 'collaudo68-', endsWith: DOMAIN } },
      select: { id: true, email: true },
    });
    for (const u of users) await db.user.delete({ where: { id: u.id } });
    console.log(`[seed-cohort-68] cleanup: ${users.length} utenti collaudo68 cancellati.`);
    return;
  }

  const roles = (ONLY ? ROLES.filter((r) => ONLY.includes(r)) : ROLES) as Role[];
  const hashed = await bcrypt.hash(COHORT_PASSWORD, 12);

  for (const role of roles) {
    const existing = await db.user.findUnique({ where: { email: email(role) } });
    if (existing) await db.user.delete({ where: { id: existing.id } });
    const userId = await seeders[role](hashed);
    console.log(`[seed-cohort-68] ${role.padEnd(18)} ${email(role).padEnd(42)} ${userId}`);
  }
  console.log(`[seed-cohort-68] fatto: ${roles.length} ruoli. Password unica: COHORT_PASSWORD in lib.ts. collaudo68-vergine NON creato (register reale in J1).`);
}

main()
  .catch((err) => {
    console.error('[FATAL] seed-cohort-68:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
