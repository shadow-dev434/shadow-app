/**
 * Probe e2e Task 55 — sorgente del cielo contro il DB reale.
 *
 * Verifica DETERMINISTICA (tutti HARD) della query che alimenta il cielo:
 * countLitStars conta SOLO i task `source='recurring'` con `completedAt`; un task
 * non ricorrente completato NON incrementa; un'istanza ricorrente completata e poi
 * ARCHIVIATA resta contata (la stella non si spegne); un ricorrente senza
 * completedAt non conta. Poi computeSkyState mappa il conteggio in stato coerente.
 *
 * Strategia: utente probe usa-e-getta (pattern probe-recurring) + chiamate DIRETTE
 * agli helper (no dev server, no LLM, no costi). Cleanup in finally (cascade).
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/55-sky.ts
 *
 * Exit 0 = nessun FAIL.
 */

import { db } from '../../src/lib/db';
import { countLitStars } from '../../src/lib/sky/lit-stars';
import { computeSkyState } from '../../src/lib/sky/sky-state';
import { CONSTELLATIONS, TOTAL_SKY_STARS } from '../../src/lib/sky/constellations';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';

const PROBE_EMAIL = 'probe-sky55@example.com';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function seedRecurringCompleted(userId: string, n: number, base: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.task.create({
      data: {
        userId,
        title: `Abitudine ${i}`,
        status: 'completed',
        source: 'recurring',
        completedAt: new Date(),
        occurrenceDate: `${base}-${i}`,
        urgency: 3,
        importance: 3,
        category: 'health',
      },
    });
  }
}

async function main(): Promise<void> {
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) await db.user.delete({ where: { id: existing.id } });
  const user = await db.user.create({
    data: { email: PROBE_EMAIL, name: 'Probe Sky55', password: 'not-a-real-login-55!' },
  });
  const userId = user.id;
  const today = formatTodayInRome();

  try {
    // ── 1. cielo vuoto all'inizio ────────────────────────────────────────────
    check('1 cielo vuoto: 0 stelle', (await countLitStars(userId)) === 0);

    // ── 2. K istanze ricorrenti completate → litStars = K ────────────────────
    const K = 5;
    await seedRecurringCompleted(userId, K, today);
    const litAfterSeed = await countLitStars(userId);
    check('2 K ricorrenti completate accendono K stelle', litAfterSeed === K, `lit=${litAfterSeed}`);

    // ── 3. task NON ricorrente completato non incrementa ─────────────────────
    await db.task.create({
      data: { userId, title: 'Compito manuale', status: 'completed', source: 'manual', completedAt: new Date(), urgency: 2, importance: 2, category: 'work' },
    });
    check('3 manuale completato NON accende stelle', (await countLitStars(userId)) === K, `lit=${await countLitStars(userId)}`);

    // ── 4. ricorrente senza completedAt non conta ────────────────────────────
    await db.task.create({
      data: { userId, title: 'Ricorrente di oggi non fatto', status: 'inbox', source: 'recurring', occurrenceDate: `${today}-open`, urgency: 3, importance: 3, category: 'health' },
    });
    check('4 ricorrente NON completato non conta', (await countLitStars(userId)) === K, `lit=${await countLitStars(userId)}`);

    // ── 5. ricorrente completato POI archiviato resta contato (loss-free) ─────
    await db.task.create({
      data: { userId, title: 'Ricorrente archiviato', status: 'archived', source: 'recurring', completedAt: new Date(), occurrenceDate: `${today}-arch`, urgency: 3, importance: 3, category: 'health' },
    });
    const litWithArchived = await countLitStars(userId);
    check('5 ricorrente completato-poi-archiviato resta contato', litWithArchived === K + 1, `lit=${litWithArchived}`);

    // ── 6. computeSkyState coerente col conteggio (K+1 = 6) ───────────────────
    const s = computeSkyState(litWithArchived);
    const lucciola = CONSTELLATIONS[0].stars; // 4
    check('6 litStars riflesso nello stato', s.litStars === litWithArchived, `state.lit=${s.litStars}`);
    check('6 prima costellazione completa a 6 stelle (4<6)', s.constellations[0].complete === true && s.completedCount === 1, `completed=${s.completedCount}`);
    check('6 seconda costellazione corrente con il resto acceso', s.currentIndex === 1 && s.constellations[1].litStars === litWithArchived - lucciola, `cur=${s.currentIndex} lit1=${s.constellations[1].litStars}`);
    check('6 stella fresca = ultima accesa', s.freshStarGlobalIndex === litWithArchived - 1, `fresh=${s.freshStarGlobalIndex}`);

    // ── 7. clamp a cielo pieno ────────────────────────────────────────────────
    const full = computeSkyState(TOTAL_SKY_STARS + 99);
    check('7 oltre il totale → cielo pieno clampato, nessun overflow', full.skyFull === true && full.litStars === TOTAL_SKY_STARS && full.currentIndex === null, `lit=${full.litStars} cur=${full.currentIndex}`);

    // ── 8. isolamento per utente ─────────────────────────────────────────────
    const other = await db.user.create({ data: { email: 'probe-sky55-other@example.com', name: 'Other', password: 'x-not-real-55!' } });
    try {
      check('8 altro utente parte da cielo vuoto', (await countLitStars(other.id)) === 0);
    } finally {
      await db.user.delete({ where: { id: other.id } }).catch(() => {});
    }
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
