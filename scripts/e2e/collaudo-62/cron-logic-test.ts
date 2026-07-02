/**
 * Collaudo Task 62 — Fase 2.2: logica della cron review serale SENZA inviare email.
 *
 * SICUREZZA: la cron reale (GET /api/cron/evening-review) invia email VERE via
 * Resend a OGNI utente in finestra presente nel DB condiviso — inaccettabile in
 * collaudo. Qui testo le funzioni pure che la cron usa (computeEveningReviewSignal
 * + dedup via Notification + opt-out via notificationsEnabled) su un utente
 * dedicato, senza mai chiamare sendEveningReviewEmail. Il gate auth (404) è
 * testato a parte con fetch.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/cron-logic-test.ts
 */
import bcrypt from 'bcryptjs';
import { db, saveEvidence } from './lib';
import { computeEveningReviewSignal } from '../../../src/lib/evening-review/compute-signal';
import { nowHHMMInRome, formatTodayInRome, startOfDayInZone } from '../../../src/lib/evening-review/dates';

const out: string[] = [];
function log(s: string) { out.push(s); console.log(s); }

async function main() {
  const email = 'collaudo-cron@probe.local';
  const ex = await db.user.findUnique({ where: { email } });
  if (ex) await db.user.delete({ where: { id: ex.id } });
  const u = await db.user.create({
    data: { email, name: 'Collaudo Cron', password: await bcrypt.hash('Collaudo62!pass', 12),
      profile: { create: { onboardingComplete: true, tourCompleted: true, consentGivenAt: new Date() } } },
  });
  const userId = u.id;
  const now = nowHHMMInRome();
  const today = formatTodayInRome();

  // Finestra che copre ORA + notifiche on + un task planned + niente review oggi.
  await db.settings.create({ data: { userId, notificationsEnabled: true, eveningWindowStart: '00:00', eveningWindowEnd: '23:59' } });
  await db.task.create({ data: { userId, title: 'triage cavia cron', status: 'planned' } });

  // 1. In finestra, nessuna review → shouldStart TRUE (candidato all'invio)
  let sig = await computeEveningReviewSignal(userId, now, today);
  log(`1. in-finestra, no review → shouldStart=${sig.shouldStart} [atteso true]`);

  // 2. Dedup: crea il marcatore Notification di oggi → la cron salterebbe (skip)
  const dayStart = startOfDayInZone(today, 'Europe/Rome');
  await db.notification.create({ data: { userId, type: 'evening_review_prompt', title: 'x', body: 'y', actionUrl: '/' } });
  const already = await db.notification.findFirst({ where: { userId, type: 'evening_review_prompt', createdAt: { gte: dayStart } }, select: { id: true } });
  log(`2. dedup: marcatore oggi presente=${!!already} → la cron farebbe skip [atteso true]`);

  // 3. Review-oggi sopprime il segnale
  await db.review.create({ data: { userId, date: today, mood: 3, energyEnd: 3 } });
  sig = await computeEveningReviewSignal(userId, now, today);
  log(`3. con Review-oggi → shouldStart=${sig.shouldStart} [atteso false]`);
  await db.review.deleteMany({ where: { userId } });

  // 4. Opt-out: notificationsEnabled=false → escluso dai candidati della cron
  await db.settings.updateMany({ where: { userId }, data: { notificationsEnabled: false } });
  const candidate = await db.settings.findFirst({ where: { userId, notificationsEnabled: true }, select: { userId: true } });
  log(`4. opt-out: candidato con notif-off=${!!candidate} → NON riceve email [atteso false]`);

  // 5. Fuori finestra → shouldStart false
  await db.settings.updateMany({ where: { userId }, data: { notificationsEnabled: true, eveningWindowStart: '20:00', eveningWindowEnd: '20:01' } });
  sig = await computeEveningReviewSignal(userId, now, today);
  const outWindow = !(now >= '20:00' && now <= '20:01');
  log(`5. fuori finestra (20:00-20:01, ora ${now}) → shouldStart=${sig.shouldStart} [atteso ${outWindow ? 'false' : 'true'}]`);

  saveEvidence('fase2-sweep', 'cron-logic.md', ['# Cron review — logica (senza invio)', '', ...out].join('\n'));
  await db.user.delete({ where: { id: userId } });
}

main().catch((e) => { console.error('[FATAL cron-logic]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
