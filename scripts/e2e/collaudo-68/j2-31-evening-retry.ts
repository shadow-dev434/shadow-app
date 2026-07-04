/**
 * J2 (collaudo 68) — passo 3 RETRY (tentativo 2): il tentativo 1 è caduto nello
 * STESSO incaglio del collaudo 62 (driver rigido: fallback "tienila per domani"
 * su domande pre-walk). NB dal tentativo 1 restano due osservazioni REALI:
 * record_mood value=3 fabbricato da una risposta senza numero, e "chiudiamo qui"
 * detto a parole senza alcun tool di chiusura (thread rimasto active).
 * Qui: archivio del thread inquinato + driver adattivo (pattern collaudo-62/j2-31).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-31-evening-retry.ts
 */
import { preflightDb, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, openEveningWindow, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { loadPhaseFromContext } from '../../../src/lib/evening-review/triage';

const J = 'J2';
const MAX_TURNS = 24;
const POLLUTED_THREAD = 'cmr687s3u00jlibe4xgfte1m8';

interface TurnLog {
  turn: number; userMessage: string; status: number; assistantChars: number;
  questionMarks: number; tools: Array<{ name: string; input?: unknown }>;
  quickReplies: unknown[]; costUsd?: number; phaseAfter?: string; state?: string; error?: string;
}

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();

  const polluted = await db.chatThread.findFirst({ where: { id: POLLUTED_THREAD, userId: u.id, state: 'active' } });
  if (polluted) {
    await db.chatThread.update({ where: { id: POLLUTED_THREAD }, data: { state: 'archived', endedAt: new Date() } });
    console.log('[retry] thread tentativo1 archiviato');
  }

  const restore = await openEveningWindow(u.id);
  console.log('[window] finestra serale aperta (ripristino in finally)');

  try {
    let threadId: string | null = null;
    let lastAssistant = '';
    let phase: string | undefined;
    let moodGiven = false;
    let energyGiven = false;
    let walkStarted = false;
    let overrideSent = false;
    let moodAskedEvening = false;
    let energyAskedEvening = false;
    const updatePreviewSeen: Array<{ turn: number; input: unknown; result?: unknown }> = [];
    const logs: TurnLog[] = [];
    let completed = false;

    function chooseMessage(turn: number): string {
      const la = lastAssistant.toLowerCase();
      if (turn === 1) return 'Ciao Shadow, la giornata è finita: facciamo la review?';
      if (phase === 'plan_preview') {
        if (!overrideSent) {
          overrideSent = true;
          return 'Quasi perfetto, ma sposta la chiamata al dentista al pomeriggio: domattina ho una riunione.';
        }
        return 'Perfetto, confermo il piano così.';
      }
      if (phase === 'closing') return 'Sì, chiudi pure la review. Buonanotte!';
      if (walkStarted) {
        if (la.includes('bolletta')) return 'La bolletta l\'ho pagata, fatta!';
        if (la.includes('dentista')) return 'No, il dentista non l\'ho chiamato: lo studio era già chiuso. Rimandiamolo a domani.';
        if (la.includes('relazione')) return 'La relazione l\'ho iniziata: primo step fatto, la continuo domani.';
        if (la.includes('regalo') || la.includes('marta')) return 'Il regalo per Marta lo prendo nel weekend, tienilo per domani.';
        if (la.includes('scrivania')) return 'La scrivania può aspettare, tienila per domani se ci sta.';
        if (la.includes('mail')) return 'Le mail non le ho toccate, tienile per domani.';
        return 'Tienila per domani, va bene.';
      }
      if (!moodGiven && (la.includes('1-5') || la.includes('1 a 5') || la.includes('come stai') || la.includes('umore') || la.includes('andata'))) {
        moodGiven = true;
        return 'Direi 4: giornata piena ma soddisfacente.';
      }
      if (!energyGiven && la.includes('energia')) {
        energyGiven = true;
        return 'Energia 3, un po\' stanco ma ok.';
      }
      return 'Sì, partiamo!';
    }

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const userMessage = chooseMessage(turn);
      const { status, json } = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      threadId = json.threadId ?? threadId;
      lastAssistant = json.assistantMessage ?? '';
      const tools = (json.toolsExecuted ?? []).map((t) => ({ name: t.name, input: t.input, result: t.result }));

      if (/umore|come (è |e' )?andata|come stai/i.test(lastAssistant)) moodAskedEvening = true;
      if (/energia/i.test(lastAssistant)) energyAskedEvening = true;

      let state: string | undefined;
      if (threadId) {
        const th = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
        state = th?.state;
        phase = loadPhaseFromContext(th?.contextJson ?? null);
      }
      if (tools.some((t) => t.name === 'set_current_entry' || t.name === 'mark_entry_discussed')) walkStarted = true;

      logs.push({
        turn, userMessage, status,
        assistantChars: lastAssistant.length,
        questionMarks: (lastAssistant.match(/\?/g) ?? []).length,
        tools: tools.map((t) => ({ name: t.name, input: t.input })),
        quickReplies: json.quickReplies ?? [],
        costUsd: json.costUsd, phaseAfter: phase, state, error: json.error,
      });
      console.log(`[turno ${turn}] status=${status} phase=${phase ?? '-'} state=${state ?? '?'} tools=[${tools.map(t => t.name).join(',')}] msg="${lastAssistant.slice(0, 70).replace(/\n/g, ' ')}"`);
      saveEvidence(J, `step3r-turno${String(turn).padStart(2, '0')}-response.json`, JSON.stringify({ userMessage, status, json }, null, 2));

      if (status !== 200) { console.log(`[HARD FAIL] turno ${turn} status=${status} err=${json.error}`); break; }
      for (const t of tools) if (t.name === 'update_plan_preview') updatePreviewSeen.push({ turn, input: t.input, result: t.result });
      if (state === 'completed') { completed = true; break; }
    }

    const summary = {
      threadId, completed,
      totalTurns: logs.length,
      updatePreviewSeen,
      N32_eveningAsksMood: moodAskedEvening,
      N32_eveningAsksEnergy: energyAskedEvening,
      totalCostUsd: logs.reduce((s, l) => s + (l.costUsd ?? 0), 0),
      totalQuestionMarks: logs.reduce((s, l) => s + l.questionMarks, 0),
      quickRepliesTotali: logs.reduce((s, l) => s + (l.quickReplies as unknown[]).length, 0),
      avgAssistantChars: Math.round(logs.reduce((s, l) => s + l.assistantChars, 0) / Math.max(1, logs.length)),
      turns: logs,
    };
    console.log(JSON.stringify({ ...summary, turns: undefined }, null, 2));
    saveEvidence(J, 'step3r-evening-summary.json', JSON.stringify(summary, null, 2));

    if (threadId) {
      const p = await dumpThread(threadId, J, 'trascrizione-evening-review-retry');
      console.log(`[dump] ${p}`);
    }
  } finally {
    await restore();
    console.log('[window] finestra serale RIPRISTINATA');
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
