/**
 * Collaudo 62 — J6 porte (e)-(h): seed dei 4 utenti dedicati.
 *
 * Crea collaudo-j6e/j6f/j6g/j6h@probe.local (pattern seed-cohort: profilo
 * completo + settings + pattern) e apre la finestra serale 00:00-23:59 per
 * ognuno via PATCH /api/settings (leva prevista dalle regole di collaudo).
 *
 * Task per ruolo:
 *  - j6e: 3 planned (deadline domani + carryover + normale) → triage per la review interrotta
 *  - j6f: NESSUN task (porta 0-candidate)
 *  - j6g: 1 completed + 1 avoided (avoidanceCount>0) → payload del tab Review manuale
 *  - j6h: 3 planned come j6e → walk completo fino al closing
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6-seed-eh.ts
 */
import bcrypt from 'bcryptjs';
import { db, mintCookie, api, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import { wakePreflight } from '../run-walk';

const ROLES = ['j6e', 'j6f', 'j6g', 'j6h'] as const;
type Role = (typeof ROLES)[number];
const email = (r: Role) => `collaudo-${r}@probe.local`;
const today = formatTodayInRome();

async function createBase(role: Role, hashed: string) {
  const u = await db.user.create({
    data: {
      email: email(role),
      name: `Collaudo ${role.toUpperCase()}`,
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
  return u;
}

async function seedTriageCandidates(userId: string) {
  const mk = (data: Record<string, unknown>) =>
    db.task.create({ data: { userId, ...data } as never });
  await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
  await mk({ title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: startOfDayInZone(addDaysIso(today, -3)) });
  await mk({ title: 'Chiamare il commercialista', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true });
}

async function main(): Promise<void> {
  await wakePreflight();
  const hashed = await bcrypt.hash('Collaudo62!pass', 12);
  const out: string[] = [];

  for (const role of ROLES) {
    const existing = await db.user.findUnique({ where: { email: email(role) } });
    if (existing) await db.user.delete({ where: { id: existing.id } });
    const u = await createBase(role, hashed);

    if (role === 'j6e' || role === 'j6h') {
      await seedTriageCandidates(u.id);
    }
    if (role === 'j6g') {
      await db.task.create({ data: { userId: u.id, title: 'Preparare la relazione trimestrale', status: 'completed', importance: 4, urgency: 4, completedAt: new Date() } });
      await db.task.create({ data: { userId: u.id, title: 'Scrivere la mail difficile al capo', status: 'planned', importance: 4, urgency: 4, avoidanceCount: 2, lastAvoidedAt: new Date() } });
    }

    // Finestra serale aperta tutto il giorno via API (leva di collaudo).
    const cookie = await mintCookie({ userId: u.id, email: email(role) });
    const patch = await api('PATCH', '/api/settings', {
      cookie,
      body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' },
    });
    const settings = (patch.json as { settings?: { eveningWindowStart?: string; eveningWindowEnd?: string } })?.settings;
    const line = `${role} ${email(role)} userId=${u.id} PATCH settings=${patch.status} window=${settings?.eveningWindowStart}-${settings?.eveningWindowEnd}`;
    out.push(line);
    console.log('[j6-seed-eh]', line);
    if (patch.status !== 200) throw new Error(`PATCH /api/settings fallita per ${role}: ${patch.status} ${patch.text}`);
  }

  saveEvidence('J6', 'j6eh-seed.txt', out.join('\n') + '\n');
  console.log('[j6-seed-eh] fatto.');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6-seed-eh:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
