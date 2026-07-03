/**
 * Collaudo 62 — J6 seed: verifica collaudo-review + crea utenti dedicati
 * per le porte b/c/d (collaudo-j6b/j6c/j6d@probe.local) e apre la finestra
 * serale per tutti e 4 via PATCH /api/settings (leva sanzionata).
 *
 * Idempotente: cancella e ricrea i soli utenti j6b/j6c/j6d.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6-seed.ts
 */
import bcrypt from 'bcryptjs';
import { db, mintCookie, api, cohortUser, saveEvidence } from './lib';

const SUFFIXES = ['j6b', 'j6c', 'j6d'] as const;

async function createJ6User(suffix: string, hashed: string): Promise<string> {
  const email = `collaudo-${suffix}@probe.local`;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) await db.user.delete({ where: { id: existing.id } });

  const u = await db.user.create({
    data: {
      email,
      name: `Collaudo ${suffix.toUpperCase()}`,
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
        },
      },
    },
  });
  await db.settings.create({ data: { userId: u.id } });
  await db.userPattern.create({ data: { userId: u.id } });

  // 2-3 task planned (candidate per il triage serale)
  await db.task.create({ data: { userId: u.id, title: 'Rispondere alla mail del condominio', status: 'planned', importance: 4, urgency: 4, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
  await db.task.create({ data: { userId: u.id, title: 'Preparare i documenti per il commercialista', status: 'planned', importance: 4, urgency: 3, quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
  await db.task.create({ data: { userId: u.id, title: 'Fissare il tagliando della macchina', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true } });
  return u.id;
}

async function openEveningWindow(userId: string, email: string): Promise<void> {
  const cookie = await mintCookie({ userId, email });
  const r = await api('PATCH', '/api/settings', {
    cookie,
    body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' },
  });
  if (r.status !== 200) {
    throw new Error(`PATCH /api/settings per ${email} -> ${r.status}: ${r.text.slice(0, 300)}`);
  }
  console.log(`[j6-seed] finestra serale aperta per ${email} (200)`);
}

async function main(): Promise<void> {
  const lines: string[] = [];

  // Porta (a): utente coorte collaudo-review (deve esistere dal seed-cohort)
  const review = await cohortUser('review');
  const reviewTasks = await db.task.findMany({ where: { userId: review.id }, select: { id: true, title: true, status: true, deadline: true, source: true, postponedCount: true } });
  const reviewRec = await db.recurringTask.findMany({ where: { userId: review.id }, select: { id: true, title: true, frequency: true, weekdays: true, active: true } });
  console.log(`[j6-seed] collaudo-review ok: ${review.id}, tasks=${reviewTasks.length}, recurring=${reviewRec.length}`);
  lines.push(`collaudo-review userId=${review.id}`);
  lines.push(JSON.stringify({ tasks: reviewTasks, recurring: reviewRec }, null, 2));

  await openEveningWindow(review.id, review.email);

  const hashed = await bcrypt.hash('Collaudo62!pass', 12);
  for (const s of SUFFIXES) {
    const userId = await createJ6User(s, hashed);
    console.log(`[j6-seed] collaudo-${s} creato: ${userId}`);
    lines.push(`collaudo-${s} userId=${userId}`);
    await openEveningWindow(userId, `collaudo-${s}@probe.local`);
  }

  const p = saveEvidence('J6', 'j6-seed-setup.txt', lines.join('\n'));
  console.log(`[j6-seed] evidenza: ${p}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] j6-seed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
