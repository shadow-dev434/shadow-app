/**
 * Fase 2 — Onboarding -> profilo (§8.10, pista N33) — aggiornato dal Task 71.
 * N33 CHIUSA: la logica inline della route è stata estratta nella fonte unica
 * buildAdaptiveProfileFromOnboarding (src/lib/onboarding/profile-from-onboarding.ts)
 * e initializeProfileFromOnboarding (engine, mai chiamata e divergente) è stata
 * RIMOSSA. Il probe ora è un test di NON-divergenza: l'AdaptiveProfile scritto
 * dalla route reale deve coincidere con l'output della funzione condivisa.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-onboarding-profile.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, db, saveEvidence, assert, finish } from './lib';
import {
  buildAdaptiveProfileFromOnboarding,
  type OnboardingAnswers,
} from '../../../src/lib/onboarding/profile-from-onboarding';

const CASES: Array<{ name: string; answers: OnboardingAnswers }> = [
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

// Campi scalari confrontati route (DB) vs fonte unica + i JSON delle finestre
// (erano le divergenze principali della N33 originale).
const CMP_FIELDS = [
  'executiveLoad', 'familyResponsibilityLoad', 'domesticBurden', 'workStudyCentrality',
  'avoidanceProfile', 'activationDifficulty', 'optimalSessionLength',
  'preferredDecompositionGranularity', 'predictedBlockLikelihood', 'interruptionVulnerability',
] as const;
const CMP_JSON_FIELDS = ['bestTimeWindows', 'worstTimeWindows', 'motivationProfile'] as const;

async function main() {
  await preflightDb();
  const report: string[] = ['# N33 (chiusa Task 71) — route vs fonte unica buildAdaptiveProfileFromOnboarding\n'];
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

      // Oracle: la fonte unica con le stesse risposte grezze.
      const expected = buildAdaptiveProfileFromOnboarding(c.answers);

      report.push(`## Caso ${c.name}`);
      report.push('| campo | route (DB) | fonte unica | drift |');
      report.push('|---|---|---|---|');
      for (const f of CMP_FIELDS) {
        const rn = Number((ap as unknown as Record<string, unknown>)[f]);
        const en = Number((expected as Record<string, unknown>)[f]);
        const drift = Math.abs(rn - en) > 1e-6;
        if (drift) anyDrift = true;
        report.push(`| ${f} | ${rn} | ${en} | ${drift ? 'SI' : '-'} |`);
      }
      for (const f of CMP_JSON_FIELDS) {
        const rv = String((ap as unknown as Record<string, unknown>)[f] ?? '');
        const ev = String((expected as Record<string, unknown>)[f] ?? '');
        const drift = rv !== ev;
        if (drift) anyDrift = true;
        report.push(`| ${f} | ${rv} | ${ev} | ${drift ? 'SI' : '-'} |`);
      }
      report.push('');
    } finally {
      await deleteEphemeralUser(u.email);
    }
  }

  assert(!anyDrift, 'N33 chiusa: route e fonte unica coincidono su tutti i campi confrontati');

  const p = saveEvidence('fase2', 'f2-onboarding-profile-drift.md', report.join('\n'));
  console.log(`  evidenza: ${p}`);
  finish('f2-onboarding-profile');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
