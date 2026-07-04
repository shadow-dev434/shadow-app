/**
 * Fase 2 — Loop di apprendimento end-to-end (§8.7, piste N5/N6/N7/N8/N18).
 * Usa collaudo68-apprendista (14 segnali seminati, processed=false).
 * - N5: completare via chat NON emette task_completed (query per signalType).
 * - N6: segnali server-side restano processed=false per sempre (conteggio DB).
 * - N7: prioritizeTaskAdaptive dead code (confermato a codice: nessun caller in src/).
 * - N8: nudge accettato -> sempre task_started? (a codice page.tsx:1591).
 * - N18: Streak/UserPattern mai aggiornati (updatedAt vs createdAt).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-learning.ts
 */
import { preflightDb, cohortUser, mintCookie, api, db, saveEvidence, assert, warn, finish, createEphemeralUser, deleteEphemeralUser, postTurn } from './lib';

async function main() {
  await preflightDb();
  const appr = await cohortUser('apprendista');
  const report: string[] = [];

  // ── N6: quanti segnali processed=true vs false per apprendista? ────────────
  const total = await db.learningSignal.count({ where: { userId: appr.id } });
  const processed = await db.learningSignal.count({ where: { userId: appr.id, processed: true } });
  const byType = await db.learningSignal.groupBy({
    by: ['signalType', 'processed'],
    where: { userId: appr.id },
    _count: true,
  });
  report.push(`# N6 — segnali apprendista`);
  report.push(`totale=${total} processed=true=${processed} processed=false=${total - processed}`);
  for (const g of byType) report.push(`  ${g.signalType.padEnd(22)} processed=${g.processed} count=${g._count}`);
  assert(total > 0, 'N6: apprendista ha segnali', total);
  // N6: se TUTTI i 14 seminati sono processed=false, la pista e' confermata.
  if (processed === 0) console.log(`  CONFERMATA N6: 0/${total} segnali processed=true (il profilo non li incorpora mai)`);
  else warn(`N6: alcuni segnali processed=true (${processed}) — verificare la fonte`);

  // ── N5: quali signalType esistono? task_completed presente solo da UI? ─────
  // Completiamo un task dell'apprendista VIA CHAT e verifichiamo che NON nasca
  // un nuovo task_completed (su un utente effimero, per non sporcare apprendista).
  const u = await createEphemeralUser('f2learn');
  try {
    const t = await db.task.create({
      data: { userId: u.id, title: 'Task da completare via chat', status: 'planned', importance: 3, urgency: 3 },
    });
    const before = await db.learningSignal.count({ where: { userId: u.id, signalType: 'task_completed' } });
    const turn = await postTurn({
      cookie: u.cookie, mode: 'general',
      userMessage: `Ho completato "${t.title}", segnalo come fatto.`,
    });
    // Attendi eventuale side-effect asincrono.
    await new Promise((r) => setTimeout(r, 500));
    const taskAfter = await db.task.findUnique({ where: { id: t.id }, select: { status: true } });
    const after = await db.learningSignal.count({ where: { userId: u.id, signalType: 'task_completed' } });
    const toolNames = (turn.json.toolsExecuted ?? []).map((x) => x.name);
    report.push(`\n# N5 — completamento via chat`);
    report.push(`tools=${JSON.stringify(toolNames)} taskStatus=${taskAfter?.status} task_completed signals: before=${before} after=${after}`);
    assert(turn.status === 200, 'N5: turno chat ok', turn.status);
    if (taskAfter?.status === 'completed') {
      assert(after === before, 'N5: completamento via chat NON emette task_completed', { before, after });
      if (after === before) console.log('  CONFERMATA N5: complete_task via chat non emette LearningSignal task_completed');
    } else {
      warn('N5: il modello non ha completato il task (scelta LLM) — riprovare', { toolNames, status: taskAfter?.status });
    }
    saveEvidence('fase2', 'f2-n5-chat-complete.json', JSON.stringify({ toolNames, taskAfter, before, after, msg: turn.json.assistantMessage?.slice(0, 400) }, null, 2));
  } finally {
    await deleteEphemeralUser(u.email);
  }

  // ── N18: Streak / UserPattern mai aggiornati nei flussi correnti ───────────
  // Streak: nessun updatedAt (righe per-data). Verifichiamo se ESISTONO righe
  // Streak per la coorte (le scrive qualche flusso corrente?). UserPattern ha
  // updatedAt: se == createdAt e i contatori sono ai default, non e' mai scritto.
  const streakCount = await db.streak.count({
    where: { user: { email: { startsWith: 'collaudo68-', endsWith: '@probe.local' } } },
  });
  const globalStreakCount = await db.streak.count();
  const patterns = await db.userPattern.findMany({
    where: { user: { email: { startsWith: 'collaudo68-', endsWith: '@probe.local' } } },
    select: { userId: true, createdAt: true, updatedAt: true, totalTasksCompleted: true, totalTasksAvoided: true, streakDays: true, lastActiveDate: true },
  });
  report.push(`\n# N18 — Streak/UserPattern`);
  report.push(`Streak rows (coorte68)=${streakCount}; Streak rows (TUTTO il DB dev)=${globalStreakCount}`);
  report.push(`UserPattern rows (coorte68)=${patterns.length}`);
  const patternTouched = patterns.filter((p) => Math.abs(p.updatedAt.getTime() - p.createdAt.getTime()) > 1000).length;
  const patternNonDefault = patterns.filter((p) => p.totalTasksCompleted > 0 || p.totalTasksAvoided > 0 || p.streakDays > 0 || p.lastActiveDate !== '').length;
  report.push(`UserPattern con updatedAt!=createdAt: ${patternTouched}/${patterns.length}`);
  report.push(`UserPattern con contatori non-default (>0 o lastActiveDate!=''): ${patternNonDefault}/${patterns.length}`);
  console.log(`  INFO  Streak coorte=${streakCount} globale=${globalStreakCount}  UserPattern touched=${patternTouched}/${patterns.length} nonDefault=${patternNonDefault}/${patterns.length}`);
  if (globalStreakCount === 0) console.log('  CONFERMATA N18(Streak): 0 righe Streak in tutto il DB dev — nessun flusso la scrive');
  if (patternNonDefault === 0 && patterns.length > 0) console.log('  CONFERMATA N18(UserPattern): tutte le righe UserPattern ai default — mai aggiornate');

  // ── N7: prioritizeTaskAdaptive dead code (grep a codice) ───────────────────
  report.push(`\n# N7 — prioritizeTaskAdaptive dead code`);
  report.push(`daily-plan/route.ts usa prioritizeTask (NON adaptive) alla riga 91; nessun caller di prioritizeTaskAdaptive in src/ (verificato via Grep).`);

  const p = saveEvidence('fase2', 'f2-learning-report.md', report.join('\n'));
  console.log(`  evidenza: ${p}`);
  finish('f2-learning');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
