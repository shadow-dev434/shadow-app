/**
 * Fase 2 — Onboarding -> profilo (§8.10, pista N33).
 * La route onboarding/complete inizializza l'AdaptiveProfile con logica INLINE
 * (route.ts:102-184), mentre initializeProfileFromOnboarding (learning-engine.ts:620)
 * NON e' mai chiamata. Verifichiamo il DRIFT: 3 profili con risposte note ->
 * confronto AdaptiveProfile generato (route) vs atteso (engine).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-onboarding-profile.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, db, saveEvidence, assert, warn, finish } from './lib';
import { initializeProfileFromOnboarding } from '../../../src/lib/engines/learning-engine';

interface Answers {
  age: number; role: string; roleDetail?: string; livingSituation: string;
  householdManager: boolean; loadSources: string[]; difficultAreas: string[];
  motivations: Record<string, number>; productiveTime: string; sessionPreference: string;
  activationDifficulty: number; promptStyle: string;
}

const CASES: Array<{ name: string; answers: Answers }> = [
  {
    name: 'worker-difficile',
    answers: {
      age: 34, role: 'worker', roleDetail: 'developer', livingSituation: 'alone',
      householdManager: true, loadSources: ['lavoro', 'casa', 'sport', 'famiglia', 'studio'],
      difficultAreas: ['admin', 'household'], motivations: { urgency: 2, reward: 1 },
      productiveTime: 'morning', sessionPreference: 'long', activationDifficulty: 5, promptStyle: 'direct',
    },
  },
  {
    name: 'parent-gentle',
    answers: {
      age: 40, role: 'parent', livingSituation: 'family', householdManager: false,
      loadSources: ['famiglia'], difficultAreas: [], motivations: { identity: 2 },
      productiveTime: 'evening', sessionPreference: 'short', activationDifficulty: 2, promptStyle: 'gentle',
    },
  },
  {
    name: 'student-medio',
    answers: {
      age: 22, role: 'student', livingSituation: 'shared', householdManager: false,
      loadSources: ['studio', 'lavoretto'], difficultAreas: ['study'], motivations: {},
      productiveTime: 'afternoon', sessionPreference: 'medium', activationDifficulty: 3, promptStyle: 'gentle',
    },
  },
];

// Campi su cui confrontiamo route vs engine (numerici scalari, drift piu' leggibile).
const CMP_FIELDS = [
  'executiveLoad', 'familyResponsibilityLoad', 'domesticBurden', 'workStudyCentrality',
  'avoidanceProfile', 'activationDifficulty', 'optimalSessionLength',
  'preferredDecompositionGranularity', 'predictedBlockLikelihood', 'interruptionVulnerability',
] as const;

async function main() {
  await preflightDb();
  const report: string[] = ['# N33 — Onboarding -> AdaptiveProfile: route (inline) vs engine (mai chiamato)\n'];
  let anyDrift = false;

  for (const c of CASES) {
    const u = await createEphemeralUser(`f2onb-${c.name}`, { onboarded: false });
    try {
      // Semina le risposte grezze come farebbe PATCH /api/onboarding.
      await db.userProfile.update({
        where: { userId: u.id },
        data: { onboardingAnswers: JSON.stringify(c.answers) },
      });
      // Finalizza via la route reale.
      const res = await api('POST', '/api/onboarding/complete', { cookie: u.cookie, body: {} });
      assert(res.status === 200, `[${c.name}] onboarding/complete -> 200`, res.status);

      const ap = await db.adaptiveProfile.findUnique({ where: { userId: u.id } });
      assert(ap !== null, `[${c.name}] AdaptiveProfile creato`, null);
      if (!ap) continue;

      // Atteso dall'engine mai chiamato.
      const sessionLength = c.answers.sessionPreference === 'short' ? 10 : c.answers.sessionPreference === 'long' ? 45 : 25;
      const expected = initializeProfileFromOnboarding({
        role: c.answers.role,
        hasChildren: c.answers.role === 'parent',
        householdManager: c.answers.householdManager,
        difficultAreas: c.answers.difficultAreas,
        mainResponsibilities: c.answers.loadSources,
        livingSituation: c.answers.livingSituation,
        preferredSessionLength: sessionLength,
        focusModeDefault: c.answers.promptStyle === 'direct' ? 'strict' : 'soft',
      });

      report.push(`## Caso ${c.name}`);
      report.push('| campo | route (reale) | engine (atteso) | drift |');
      report.push('|---|---|---|---|');
      for (const f of CMP_FIELDS) {
        const rv = (ap as unknown as Record<string, unknown>)[f];
        const ev = (expected as Record<string, unknown>)[f];
        const rn = typeof rv === 'number' ? rv : Number(rv);
        const en = typeof ev === 'number' ? ev : Number(ev);
        const drift = Math.abs(rn - en) > 1e-6;
        if (drift) anyDrift = true;
        report.push(`| ${f} | ${rn} | ${en} | ${drift ? 'SI' : '-'} |`);
      }
      report.push('');
    } finally {
      await deleteEphemeralUser(u.email);
    }
  }

  if (anyDrift) console.log('  CONFERMATA N33: drift tra logica inline della route e initializeProfileFromOnboarding (dead code divergente)');
  else warn('N33: nessun drift misurato sui campi confrontati — la logica coincide');

  const p = saveEvidence('fase2', 'f2-onboarding-profile-drift.md', report.join('\n'));
  console.log(`  evidenza: ${p}`);
  finish('f2-onboarding-profile');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
