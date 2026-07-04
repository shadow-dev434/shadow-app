/**
 * J2 (collaudo 68) — passo 3: review serale conversazionale COMPLETA via
 * openEveningWindow (RIPRISTINO in finally, §2.12) + postTurn mode=evening_review.
 * walk → plan preview → override "sposta X di pomeriggio" → closing.
 * Piste: R9 (fasce nel DB, verificate poi da j2-40), N32 (mood/energy richiesti
 * ANCHE la sera dopo l'intake del mattino).
 * Adattato da collaudo-62/j2-30-evening.ts.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-30-evening.ts
 */
import { preflightDb, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, openEveningWindow, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { loadPhaseFromContext } from '../../../src/lib/evening-review/triage';

const J = 'J2';
const MAX_TURNS = 20;

interface TurnLog {
  turn: number; userMessage: string; status: number; assistantChars: number;
  questionMarks: number; tools: Array<{ name: string; input?: unknown }>;
  quickReplies: unknown[]; costUsd?: number; phaseAfter?: string; state?: string; error?: string;
}

function nextMessage(ctx: { turn: number; phase?: string; lastAssistant: string; overrideSent: boolean }): string {
  const la = ctx.lastAssistant.toLowerCase();
  if (ctx.turn === 1) return 'Ciao Shadow, la giornata è finita: facciamo la review?';
  if (ctx.phase === 'plan_preview') {
    if (!ctx.overrideSent) return 'Quasi perfetto, ma sposta la chiamata al dentista al pomeriggio: la mattina ho una riunione.';
    return 'Perfetto, confermo il piano così.';
  }
  if (ctx.phase === 'closing') return 'Sì, chiudi pure la review. Buonanotte!';
  // per_entry (o intake pre-fase)
  if (la.includes('relazione')) return 'La relazione l\'ho iniziata, ho fatto il primo step (aperto il template), poi mi sono fermato. La continuo domani.';
  if (la.includes('dentista')) return 'No, il dentista non l\'ho chiamato: lo studio era già chiuso quando mi sono ricordato. Rimandiamolo a domani.';
  if (la.includes('bolletta')) return 'La bolletta l\'ho pagata, fatta!';
  if (la.includes('scrivania')) return 'La scrivania la tengo per domani.';
  if (la.includes('mail')) return 'Le mail arretrate mettile per domani.';
  if (la.includes('regalo') || la.includes('marta')) return 'Il regalo per Marta lo prendo nel weekend, tienilo per domani.';
  if (la.includes('energia')) return 'Energia 3, sono un po\' stanco ma ok.';
  if (la.includes('umore') || la.includes('come è andata') || la.includes('com\'è andata') || la.includes('come ti senti')) {
    return 'Direi 4: giornata piena ma soddisfacente. Di energia invece sono a 3.';
  }
  return 'Questa tienila per domani.';
}

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();

  const restore = await openEveningWindow(u.id);
  console.log('[window] finestra serale aperta (ripristino in finally)');

  try {
    let threadId: string | null = null;
    let lastAssistant = '';
    let phase: string | undefined;
    let overrideSent = false;
    let updatePreviewSeen: unknown = null;
    let moodAskedEvening = false;
    let energyAskedEvening = false;
    const logs: TurnLog[] = [];
    let completed = false;

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const userMessage = nextMessage({ turn, phase, lastAssistant, overrideSent });
      if (phase === 'plan_preview' && !overrideSent) overrideSent = true;

      const { status, json } = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      threadId = json.threadId ?? threadId;
      lastAssistant = json.assistantMessage ?? '';
      const tools = (json.toolsExecuted ?? []).map((t) => ({ name: t.name, input: t.input }));

      if (/umore|come (è |e' )?andata|come ti senti/i.test(lastAssistant)) moodAskedEvening = true;
      if (/energia/i.test(lastAssistant)) energyAskedEvening = true;

      let state: string | undefined;
      if (threadId) {
        const th = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
        state = th?.state;
        phase = loadPhaseFromContext(th?.contextJson ?? null);
      }

      const log: TurnLog = {
        turn, userMessage, status,
        assistantChars: lastAssistant.length,
        questionMarks: (lastAssistant.match(/\?/g) ?? []).length,
        tools, quickReplies: json.quickReplies ?? [],
        costUsd: json.costUsd, phaseAfter: phase, state, error: json.error,
      };
      logs.push(log);
      console.log(`[turno ${turn}] status=${status} phase=${phase ?? '-'} state=${state ?? '?'} tools=[${tools.map(t => t.name).join(',')}] chars=${lastAssistant.length}`);
      saveEvidence(J, `step3-turno${String(turn).padStart(2, '0')}-response.json`, JSON.stringify({ userMessage, status, json }, null, 2));

      if (status !== 200) { console.log(`[HARD FAIL] turno ${turn} status=${status} err=${json.error}`); break; }
      const upd = tools.find((t) => t.name === 'update_plan_preview');
      if (upd) updatePreviewSeen = { turn, input: upd.input };
      if (state === 'completed') { completed = true; break; }
    }

    const summary = {
      threadId, completed,
      totalTurns: logs.length,
      updatePreviewSeen,
      N32_eveningAsksMood: moodAskedEvening,
      N32_eveningAsksEnergy: energyAskedEvening,
      totalCostUsd: logs.reduce((s2, l) => s2 + (l.costUsd ?? 0), 0),
      totalQuestionMarks: logs.reduce((s2, l) => s2 + l.questionMarks, 0),
      quickRepliesTotali: logs.reduce((s2, l) => s2 + (l.quickReplies as unknown[]).length, 0),
      avgAssistantChars: Math.round(logs.reduce((s2, l) => s2 + l.assistantChars, 0) / Math.max(1, logs.length)),
      turns: logs,
    };
    console.log(JSON.stringify({ ...summary, turns: undefined }, null, 2));
    saveEvidence(J, 'step3-evening-summary.json', JSON.stringify(summary, null, 2));

    if (threadId) {
      const p = await dumpThread(threadId, J, 'trascrizione-evening-review');
      console.log(`[dump] ${p}`);
    }
  } finally {
    await restore();
    console.log('[window] finestra serale RIPRISTINATA');
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
