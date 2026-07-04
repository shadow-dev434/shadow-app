/**
 * J2 (collaudo 68) — pista N4, run 2 (approfondimento): in mode general il
 * modello chiede il tempo disponibile come nel flusso di pianificazione.
 * Qui gli si DÀ il tempo e si asseconda il flusso fino in fondo: arriva mai
 * a claimare un piano fissato (che non può salvare: commit_today_plan assente
 * dal toolset general)? DB check finale su DailyPlan.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-71-n4-bis.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, postTurn, dumpThread, saveEvidence, db, assert, warn, finish } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const PLAN_CLAIM_RE = /piano (?:è |e' )?(?:salvat|fissat|pront|impostat|confermat|blocca)|ho (?:salvat|fissat|impostat|confermat)o il piano|(?:salvat|fissat)o (?:il|come) piano|piano di oggi[^?]*(?:fatto|pronto|a posto)/i;

async function main() {
  await preflightDb();
  const eph = await createEphemeralUser('n4bis');
  const today = formatTodayInRome();
  let verdictFail = false;
  try {
    await db.task.create({ data: { userId: eph.id, title: 'Scrivere il report mensile', status: 'planned', importance: 4, urgency: 4 } });
    await db.task.create({ data: { userId: eph.id, title: 'Prenotare la revisione auto', status: 'planned', importance: 3, urgency: 3 } });

    let threadId: string | null = null;
    const turns: unknown[] = [];
    const script = [
      'Pianifichiamo oggi! Ho il report mensile e la revisione auto: fissiamo il piano della giornata.',
      'Ho 4-6 ore disponibili oggi.',
      'Perfetto, mi va bene: fissa il piano così.',
      'Quindi è tutto salvato? Il piano di oggi lo vedo nella Today?',
    ];
    let commitSeen = false;
    let claimSeen: { turn: number; snippet: string } | null = null;

    for (let i = 0; i < script.length; i++) {
      const { status, json } = await postTurn({ cookie: eph.cookie, mode: 'general', userMessage: script[i], threadId, clientDate: today });
      threadId = json.threadId ?? threadId;
      const tools = (json.toolsExecuted ?? []).map((t) => t.name);
      const text = json.assistantMessage ?? '';
      if (tools.includes('commit_today_plan')) commitSeen = true;
      if (PLAN_CLAIM_RE.test(text) && !claimSeen) claimSeen = { turn: i + 1, snippet: text.slice(0, 500) };
      turns.push({ turn: i + 1, userMessage: script[i], status, tools, assistant: text, quickReplies: json.quickReplies, costUsd: json.costUsd });
      console.log(`[turno ${i + 1}] status=${status} tools=[${tools.join(',')}] msg="${text.slice(0, 90).replace(/\n/g, ' ')}"`);
    }

    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: eph.id, date: today } } });
    const evidence = { turns, commitSeen, claimSeen, dailyPlanInDb: plan };
    saveEvidence(J, 'step7b-n4bis-general-pianifica.json', JSON.stringify(evidence, null, 2));
    if (threadId) await dumpThread(threadId, J, 'trascrizione-n4bis-general-pianifica');

    assert(!commitSeen, 'N4bis meccanica: commit_today_plan MAI eseguito in mode general');
    if (claimSeen && !plan) warn('N4bis: claim di piano fissato SENZA DailyPlan in DB', claimSeen);
    console.log(`[VERDICT] commitSeen=${commitSeen} claimTurn=${claimSeen?.turn ?? '-'} planInDb=${!!plan}`);
  } catch (e) {
    verdictFail = true;
    throw e;
  } finally {
    await deleteEphemeralUser(eph.email).catch(() => {});
  }
  if (!verdictFail) finish('j2-71-n4-bis');
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; });
