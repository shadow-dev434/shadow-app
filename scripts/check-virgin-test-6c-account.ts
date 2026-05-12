/**
 * Check setup "virgin account" per smoke test E2E Slice 6c (spec §H setup).
 *
 * Lista tutti gli utenti e per ciascuno verifica i requisiti del piano:
 *  - AdaptiveProfile: optimalSessionLength=25, shameFrustrationSensitivity=4,
 *    preferredPromptStyle='direct', bestTimeWindows include 'morning'
 *  - Settings: wakeTime='07:00', sleepTime='23:00'
 *  - 8 task in inbox: 3 con deadline <=48h da now, 5 senza deadline,
 *    durate variate (size 1..5)
 *  - Nessun thread evening_review in stato active/paused (virgin per la
 *    sessione di retest)
 *
 * Output: per ogni utente, lista pass/fail per ogni requisito + verdetto.
 * Niente mutazioni. Solo SELECT.
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bunx tsx scripts/check-virgin-test-6c-account.ts
 */

import { db } from '../src/lib/db';

const REQUIRED_PROFILE = {
  optimalSessionLength: 25,
  shameFrustrationSensitivity: 4,
  preferredPromptStyle: 'direct',
  bestTimeWindowsIncludes: 'morning',
};
const REQUIRED_SETTINGS = {
  wakeTime: '07:00',
  sleepTime: '23:00',
};
const REQUIRED_TASKS_TOTAL = 8;
const REQUIRED_TASKS_WITH_DEADLINE = 3;
const REQUIRED_TASKS_WITHOUT_DEADLINE = 5;
const DEADLINE_IMMUNITY_HOURS = 48;

type CheckRow = { label: string; pass: boolean; detail: string };

async function main(): Promise<void> {
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`[check] ${users.length} utenti totali nel DB.`);
  console.log('');

  for (const u of users) {
    const profile = await db.adaptiveProfile.findUnique({
      where: { userId: u.id },
      select: {
        optimalSessionLength: true,
        shameFrustrationSensitivity: true,
        preferredPromptStyle: true,
        bestTimeWindows: true,
      },
    });
    const settings = await db.settings.findFirst({
      where: { userId: u.id },
      select: { wakeTime: true, sleepTime: true },
    });
    const tasks = await db.task.findMany({
      where: { userId: u.id, status: 'inbox' },
      select: { id: true, title: true, size: true, deadline: true, priorityScore: true },
    });
    const activeThread = await db.chatThread.findFirst({
      where: {
        userId: u.id,
        mode: 'evening_review',
        state: { in: ['active', 'paused'] },
      },
      select: { id: true, state: true, lastTurnAt: true },
      orderBy: { lastTurnAt: 'desc' },
    });

    const now = new Date();
    const deadlineThreshold = new Date(now.getTime() + DEADLINE_IMMUNITY_HOURS * 60 * 60 * 1000);
    const tasksWithImmuneDeadline = tasks.filter(
      (t) => t.deadline !== null && t.deadline >= now && t.deadline <= deadlineThreshold,
    );
    const tasksWithoutDeadline = tasks.filter((t) => t.deadline === null);
    const sizesPresent = new Set(tasks.map((t) => t.size));

    let parsedBestTimeWindows: string[] = [];
    if (profile?.bestTimeWindows) {
      try {
        const raw = JSON.parse(profile.bestTimeWindows);
        if (Array.isArray(raw)) parsedBestTimeWindows = raw.filter((x): x is string => typeof x === 'string');
      } catch {
        parsedBestTimeWindows = [];
      }
    }

    const checks: CheckRow[] = [
      {
        label: 'AdaptiveProfile esiste',
        pass: profile !== null,
        detail: profile === null ? 'NONE' : 'ok',
      },
      {
        label: `optimalSessionLength == ${REQUIRED_PROFILE.optimalSessionLength}`,
        pass: profile?.optimalSessionLength === REQUIRED_PROFILE.optimalSessionLength,
        detail: String(profile?.optimalSessionLength ?? 'n/a'),
      },
      {
        label: `shameFrustrationSensitivity == ${REQUIRED_PROFILE.shameFrustrationSensitivity}`,
        pass: profile?.shameFrustrationSensitivity === REQUIRED_PROFILE.shameFrustrationSensitivity,
        detail: String(profile?.shameFrustrationSensitivity ?? 'n/a'),
      },
      {
        label: `preferredPromptStyle == '${REQUIRED_PROFILE.preferredPromptStyle}'`,
        pass: profile?.preferredPromptStyle === REQUIRED_PROFILE.preferredPromptStyle,
        detail: String(profile?.preferredPromptStyle ?? 'n/a'),
      },
      {
        label: `bestTimeWindows include '${REQUIRED_PROFILE.bestTimeWindowsIncludes}'`,
        pass: parsedBestTimeWindows.includes(REQUIRED_PROFILE.bestTimeWindowsIncludes),
        detail: JSON.stringify(parsedBestTimeWindows),
      },
      {
        label: `Settings.wakeTime == '${REQUIRED_SETTINGS.wakeTime}'`,
        pass: settings?.wakeTime === REQUIRED_SETTINGS.wakeTime,
        detail: String(settings?.wakeTime ?? 'n/a'),
      },
      {
        label: `Settings.sleepTime == '${REQUIRED_SETTINGS.sleepTime}'`,
        pass: settings?.sleepTime === REQUIRED_SETTINGS.sleepTime,
        detail: String(settings?.sleepTime ?? 'n/a'),
      },
      {
        label: `task in inbox totali == ${REQUIRED_TASKS_TOTAL}`,
        pass: tasks.length === REQUIRED_TASKS_TOTAL,
        detail: String(tasks.length),
      },
      {
        label: `task con deadline <=48h == ${REQUIRED_TASKS_WITH_DEADLINE}`,
        pass: tasksWithImmuneDeadline.length === REQUIRED_TASKS_WITH_DEADLINE,
        detail: String(tasksWithImmuneDeadline.length),
      },
      {
        label: `task senza deadline == ${REQUIRED_TASKS_WITHOUT_DEADLINE}`,
        pass: tasksWithoutDeadline.length === REQUIRED_TASKS_WITHOUT_DEADLINE,
        detail: String(tasksWithoutDeadline.length),
      },
      // Soglia ammorbidita 2026-05-11: originalmente >= 4 (varianza alta per
      // setup generico), ridotta a >= 3 per accomodare il setup retest 6c che
      // concentra 6 task size=5 per produrre overflow controllato a 512 min
      // su capacity 480 (107% overflowing). Soglia >= 3 resta discriminante:
      // blocca setup degenerati con tutti uguali (1 size) o solo 2 sizes.
      // Rif: docs/tasks/05-slice-6c-retest-rubric.md "Setup virgin account"
      // + scripts/seed-virgin-test-6c.ts commento di calibratura.
      {
        label: 'durate variate (size distinti >= 3)',
        pass: sizesPresent.size >= 3,
        detail: `sizes=[${[...sizesPresent].sort().join(',')}]`,
      },
      {
        label: "nessun thread evening_review active/paused (virgin)",
        pass: activeThread === null,
        detail: activeThread === null
          ? 'ok'
          : `thread id=${activeThread.id} state=${activeThread.state}`,
      },
    ];

    const passed = checks.filter((c) => c.pass).length;
    const total = checks.length;
    const verdict = passed === total ? 'VIRGIN OK' : 'NOT READY';

    console.log(`=== USER id=${u.id} email=${u.email ?? 'n/a'} name=${u.name ?? 'n/a'} ===`);
    console.log(`createdAt=${u.createdAt.toISOString()}`);
    for (const c of checks) {
      console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.label} -- ${c.detail}`);
    }
    console.log(`  -> ${verdict} (${passed}/${total})`);
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('[FATAL] check-virgin-test-6c-account failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
