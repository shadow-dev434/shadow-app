/**
 * J2 (collaudo 68) — pista N4: "Pianifichiamo oggi" in mode GENERAL su utente
 * effimero. Statica (verificata a codice): commit_today_plan NON è nel toolset
 * general (tools.ts getToolsForMode: solo morning_checkin|planning) e NON è nei
 * WRITE_TOOL_NAMES del claim-guard (claim-guard.ts). Qui il collaudo DINAMICO
 * con LLM reale: il modello promette un piano senza poterlo salvare? Il DB
 * resta senza DailyPlan?
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-70-n4.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, postTurn, dumpThread, saveEvidence, db, assert, warn, finish } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const PLAN_CLAIM_RE = /piano (?:è |e' )?(?:salvat|fissat|pront|impostat|confermat)|ho (?:salvat|fissat|impostat|confermat)o il piano|(?:salvat|fissat)o (?:il|come) piano|nel piano di oggi/i;

async function main() {
  await preflightDb();
  const eph = await createEphemeralUser('n4');
  const today = formatTodayInRome();
  try {
    // 2 task per dare materia al "piano".
    await db.task.create({ data: { userId: eph.id, title: 'Scrivere il report mensile', status: 'planned', importance: 4, urgency: 4 } });
    await db.task.create({ data: { userId: eph.id, title: 'Prenotare la revisione auto', status: 'planned', importance: 3, urgency: 3 } });

    let threadId: string | null = null;
    const turns: unknown[] = [];
    const script = [
      'Pianifichiamo oggi! Ho il report mensile e la revisione auto: fissiamo il piano della giornata.',
      'Sì, perfetto, confermo: fissa il piano così per oggi.',
      'Ok, quindi il piano di oggi è salvato?',
    ];
    let commitSeen = false;
    let claimSeen: { turn: number; snippet: string } | null = null;
    let honestAdmission = false;

    for (let i = 0; i < script.length; i++) {
      const { status, json } = await postTurn({ cookie: eph.cookie, mode: 'general', userMessage: script[i], threadId, clientDate: today });
      threadId = json.threadId ?? threadId;
      const tools = (json.toolsExecuted ?? []).map((t) => t.name);
      const text = json.assistantMessage ?? '';
      if (tools.includes('commit_today_plan')) commitSeen = true;
      if (PLAN_CLAIM_RE.test(text) && !claimSeen) claimSeen = { turn: i + 1, snippet: text.slice(0, 400) };
      if (/non (posso|riesco)|check-?in|pianificazione|non è (ancora )?salvat/i.test(text)) honestAdmission = true;
      turns.push({ turn: i + 1, userMessage: script[i], status, tools, assistant: text, quickReplies: json.quickReplies, costUsd: json.costUsd });
      console.log(`[turno ${i + 1}] status=${status} tools=[${tools.join(',')}] chars=${text.length}`);
    }

    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: eph.id, date: today } } });
    const evidence = { turns, commitSeen, claimSeen, honestAdmission, dailyPlanInDb: plan };
    saveEvidence(J, 'step7-n4-general-pianifica.json', JSON.stringify(evidence, null, 2));
    if (threadId) await dumpThread(threadId, J, 'trascrizione-n4-general-pianifica');

    // Meccanica HARD: commit_today_plan non deve APPARIRE eseguito in general.
    assert(!commitSeen, 'N4 meccanica: commit_today_plan MAI eseguito in mode general');
    // Comportamento LLM: WARN se promette un piano salvato che non esiste in DB.
    if (claimSeen && !plan) {
      warn('N4 CONFERMATA: il modello afferma un piano salvato ma DailyPlan in DB è assente', claimSeen);
    } else if (!claimSeen) {
      console.log('  INFO il modello NON ha claimato un piano salvato' + (honestAdmission ? ' (ammissione onesta rilevata)' : ''));
    }
    console.log(`[VERDICT] commitSeen=${commitSeen} claimSeen=${!!claimSeen} planInDb=${!!plan} honestAdmission=${honestAdmission}`);
  } finally {
    await deleteEphemeralUser(eph.email).catch(() => {});
  }
  finish('j2-70-n4');
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; });
