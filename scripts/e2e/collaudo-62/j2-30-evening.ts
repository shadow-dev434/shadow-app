/**
 * J2 — passo 5: finestra serale aperta via PATCH /api/settings + review serale
 * COMPLETA via POST /api/chat/turn mode=evening_review.
 * Driver adattivo per fase (contextJson.phase: per_entry | plan_preview | closing):
 *   - intake mood/energia con messaggi naturali
 *   - triage voce per voce: bolletta = fatta, dentista = rimandata con motivo,
 *     il resto tienile per domani
 *   - plan_preview: OVERRIDE "sposta le mail arretrate al pomeriggio" poi conferma
 *   - closing: conferma chiusura
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-30-evening.ts
 */
import { cohortUser, mintCookie, api, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { loadPhaseFromContext } from '../../../src/lib/evening-review/triage';

const J = 'J2';
const MAX_TURNS = 20;

interface TurnLog {
  turn: number;
  phaseBefore?: string;
  userMessage: string;
  status: number;
  assistantChars: number;
  questionMarks: number;
  tools: Array<{ name: string; input?: unknown }>;
  quickReplies: unknown[];
  costUsd?: number;
  phaseAfter?: string;
  state?: string;
  error?: string;
}

/** Sceglie il messaggio utente in base a fase + contenuto dell'ultima risposta. */
function nextMessage(ctx: {
  turn: number;
  phase?: string;
  lastAssistant: string;
  overrideSent: boolean;
  confirmPreviewSent: boolean;
}): string {
  const la = ctx.lastAssistant.toLowerCase();
  if (ctx.turn === 1) return 'Ciao Shadow, la giornata è finita: facciamo la review?';
  if (ctx.phase === 'plan_preview') {
    if (!ctx.overrideSent) return 'Quasi perfetto, ma sposta le mail arretrate al pomeriggio: la mattina ho una riunione.';
    return 'Perfetto, confermo il piano così.';
  }
  if (ctx.phase === 'closing') return 'Sì, chiudi pure la review. Buonanotte!';
  // per_entry (o intake pre-fase)
  if (la.includes('bolletta')) return 'La bolletta l\'ho pagata stamattina appena arrivato in ufficio, fatta!';
  if (la.includes('dentista')) return 'No, il dentista non l\'ho chiamato: lo studio era già chiuso quando mi sono ricordato. Rimandiamolo a domani.';
  if (la.includes('relazione')) return 'Sì, la relazione l\'ho finita stamattina, è già segnata.';
  if (la.includes('energia')) return 'Energia 3, sono un po\' stanco ma ok.';
  if (la.includes('umore') || la.includes('come è andata') || la.includes('com\'è andata') || la.includes('come ti senti')) {
    return 'Direi 4: giornata piena ma soddisfacente. Di energia invece sono a 3.';
  }
  // fallback triage generico
  return 'Questa tienila per domani.';
}

async function main() {
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();

  // ── Leva finestra serale ──────────────────────────────────────────────────
  const s = await api('PATCH', '/api/settings', {
    cookie,
    body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' },
  });
  console.log(`[settings] status=${s.status} body=${s.text.slice(0, 200)}`);
  saveEvidence(J, 'step5-settings-patch.json', JSON.stringify({ status: s.status, body: s.json }, null, 2));
  if (s.status !== 200) throw new Error('PATCH /api/settings fallita');

  // ── Walk della review ─────────────────────────────────────────────────────
  let threadId: string | null = null;
  let lastAssistant = '';
  let phase: string | undefined;
  let overrideSent = false;
  let confirmPreviewSent = false;
  let updatePreviewSeen: unknown = null;
  const logs: TurnLog[] = [];
  let completed = false;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const userMessage = nextMessage({ turn, phase, lastAssistant, overrideSent, confirmPreviewSent });
    if (phase === 'plan_preview' && !overrideSent) overrideSent = true;
    else if (phase === 'plan_preview' && overrideSent) confirmPreviewSent = true;

    const { status, json } = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
    threadId = json.threadId ?? threadId;
    lastAssistant = json.assistantMessage ?? '';
    const tools = (json.toolsExecuted ?? []).map((t) => ({ name: t.name, input: t.input }));

    let state: string | undefined;
    if (threadId) {
      const th = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
      state = th?.state;
      phase = loadPhaseFromContext(th?.contextJson ?? null);
    }

    const log: TurnLog = {
      turn,
      userMessage,
      status,
      assistantChars: lastAssistant.length,
      questionMarks: (lastAssistant.match(/\?/g) ?? []).length,
      tools,
      quickReplies: json.quickReplies ?? [],
      costUsd: json.costUsd,
      phaseAfter: phase,
      state,
      error: json.error,
    };
    logs.push(log);
    console.log(`[turno ${turn}] status=${status} phase=${phase ?? '-'} state=${state ?? '?'} tools=[${tools.map(t => t.name).join(',')}] chars=${lastAssistant.length}`);
    saveEvidence(J, `step5-turno${String(turn).padStart(2, '0')}-response.json`, JSON.stringify({ userMessage, status, json }, null, 2));

    if (status !== 200) { console.log(`[HARD FAIL] turno ${turn} status=${status} err=${json.error}`); break; }
    const upd = tools.find((t) => t.name === 'update_plan_preview');
    if (upd) updatePreviewSeen = { turn, input: upd.input };
    if (state === 'completed') { completed = true; break; }
  }

  const summary = {
    threadId,
    completed,
    totalTurns: logs.length,
    updatePreviewSeen,
    totalCostUsd: logs.reduce((s2, l) => s2 + (l.costUsd ?? 0), 0),
    totalQuestionMarks: logs.reduce((s2, l) => s2 + l.questionMarks, 0),
    avgAssistantChars: Math.round(logs.reduce((s2, l) => s2 + l.assistantChars, 0) / Math.max(1, logs.length)),
    turns: logs,
  };
  console.log(JSON.stringify({ ...summary, turns: undefined }, null, 2));
  saveEvidence(J, 'step5-evening-summary.json', JSON.stringify(summary, null, 2));

  if (threadId) {
    const p = await dumpThread(threadId, J, 'trascrizione-evening-review');
    console.log(`[dump] ${p}`);
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
