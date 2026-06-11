import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock locali di @/lib/db e @/lib/llm/client, pattern orchestrator.test.ts.
vi.mock('@/lib/db', () => ({
  db: {
    chatThread: { findUnique: vi.fn() },
    chatMessage: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';
import {
  SUMMARY_ROLE,
  SUMMARY_WINDOW,
  SUMMARY_TRIGGER,
  SUMMARY_KEEP,
  SUMMARY_MAX_BATCH,
  SUMMARY_BLOCK_CHAR_CAP,
  SUMMARIZER_MSG_CHAR_CAP,
  isRollingSummaryEnabled,
  parseSummaryPayload,
  isAfterWatermark,
  loadLatestSummary,
  buildSummaryBlock,
  selectFoldBatch,
  buildSummarizerPrompt,
  rollSummaryIfNeeded,
  type FoldableMessage,
  type SummaryPayload,
  type LoadedSummary,
} from './summary';

// ── Factory ────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<SummaryPayload> = {}): SummaryPayload {
  return {
    kind: 'rolling-summary',
    version: 1,
    coveredUntilMessageId: 'm-wm',
    coveredUntilCreatedAt: '2026-06-10T10:00:00.000Z',
    messagesCovered: 40,
    costUsd: 0.01,
    ...overrides,
  };
}

function makeSummaryRow(payload: SummaryPayload | string | null, content = 'LEDGER PRECEDENTE') {
  return {
    content,
    payloadJson:
      payload === null ? null : typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

/**
 * n messaggi alternati user/assistant (indice pari = user), in ordine
 * cronologico, 1 minuto di distanza. Con n pari l'ultimo e' assistant.
 */
function makeMsgs(n: number, startId = 1): FoldableMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${String(startId + i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `msg-${startId + i}`,
    createdAt: new Date(Date.UTC(2026, 5, 11, 10, 0, startId + i)),
  }));
}

/**
 * Dispatcher per db.chatMessage.findMany: rollSummaryIfNeeded lo chiama sia
 * per le righe summary (where.role === 'summary') sia per la history
 * post-watermark (where.role = { in: [...] }). summaryBatches: una entry per
 * OGNI chiamata summary successiva (prev, guard idempotente) — l'ultima entry
 * si ripete se le chiamate sono di piu'.
 */
function dispatchFindMany(
  summaryBatches: Array<ReturnType<typeof makeSummaryRow>[]>,
  historyRows: FoldableMessage[],
) {
  let summaryCall = 0;
  // Cast as any sull'implementation: il tipo Prisma vuole PrismaPromise,
  // il mock async restituisce Promise — equivalenti a runtime per i test.
  vi.mocked(db.chatMessage.findMany).mockImplementation((async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
  ) => {
    if (args?.where?.role === SUMMARY_ROLE) {
      const batch = summaryBatches[Math.min(summaryCall, summaryBatches.length - 1)] ?? [];
      summaryCall += 1;
      return batch;
    }
    return historyRows;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

const ORIGINAL_FLAG = process.env.SHADOW_ROLLING_SUMMARY;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SHADOW_ROLLING_SUMMARY;
  vi.mocked(db.chatThread.findUnique).mockResolvedValue({
    id: 'thread-1',
    mode: 'general',
    state: 'active',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  dispatchFindMany([[]], []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.chatMessage.create).mockResolvedValue({ id: 'summary-row' } as any);
  vi.mocked(callLLM).mockResolvedValue({
    text: 'LEDGER AGGIORNATO',
    toolCalls: [],
    stopReason: 'end_turn',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: 'claude-haiku-4-5' as any,
    tokensIn: 4000,
    tokensOut: 300,
    costUsd: 0.0055,
    latencyMs: 2100,
  });
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.SHADOW_ROLLING_SUMMARY;
  else process.env.SHADOW_ROLLING_SUMMARY = ORIGINAL_FLAG;
});

// ── Kill switch ────────────────────────────────────────────────────────────

describe('isRollingSummaryEnabled (kill switch, default ON)', () => {
  it('default ON quando la env non e\' settata', () => {
    expect(isRollingSummaryEnabled()).toBe(true);
  });

  it('OFF con "off" case-insensitive e spazi', () => {
    process.env.SHADOW_ROLLING_SUMMARY = 'off';
    expect(isRollingSummaryEnabled()).toBe(false);
    process.env.SHADOW_ROLLING_SUMMARY = ' OFF ';
    expect(isRollingSummaryEnabled()).toBe(false);
  });

  it('valori diversi da "off" restano ON', () => {
    process.env.SHADOW_ROLLING_SUMMARY = 'on';
    expect(isRollingSummaryEnabled()).toBe(true);
  });
});

// ── parseSummaryPayload ────────────────────────────────────────────────────

describe('parseSummaryPayload (tollerante)', () => {
  it('payload valido -> normalizzato', () => {
    const p = parseSummaryPayload(JSON.stringify(makePayload()));
    expect(p).toEqual(makePayload());
  });

  it('null / JSON rotto / kind sbagliato / data invalida -> null', () => {
    expect(parseSummaryPayload(null)).toBeNull();
    expect(parseSummaryPayload('{non-json')).toBeNull();
    expect(parseSummaryPayload(JSON.stringify({ kind: 'altro' }))).toBeNull();
    expect(
      parseSummaryPayload(JSON.stringify(makePayload({ coveredUntilCreatedAt: 'not-a-date' }))),
    ).toBeNull();
  });

  it('messagesCovered/costUsd mancanti -> default 0 (non load-bearing)', () => {
    const raw = makePayload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (raw as any).messagesCovered;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (raw as any).costUsd;
    const p = parseSummaryPayload(JSON.stringify(raw));
    expect(p?.messagesCovered).toBe(0);
    expect(p?.costUsd).toBe(0);
  });
});

// ── isAfterWatermark ───────────────────────────────────────────────────────

describe('isAfterWatermark (tiebreaker createdAt poi id)', () => {
  const wm = makePayload({
    coveredUntilMessageId: 'm-050',
    coveredUntilCreatedAt: '2026-06-10T10:00:00.000Z',
  });

  it('createdAt maggiore -> true; minore -> false', () => {
    expect(isAfterWatermark({ id: 'm-001', createdAt: new Date('2026-06-10T10:00:01Z') }, wm)).toBe(true);
    expect(isAfterWatermark({ id: 'm-999', createdAt: new Date('2026-06-10T09:59:59Z') }, wm)).toBe(false);
  });

  it('createdAt uguale -> decide l\'id; id uguale -> false (il watermark stesso non e\' "dopo")', () => {
    const same = new Date('2026-06-10T10:00:00.000Z');
    expect(isAfterWatermark({ id: 'm-051', createdAt: same }, wm)).toBe(true);
    expect(isAfterWatermark({ id: 'm-049', createdAt: same }, wm)).toBe(false);
    expect(isAfterWatermark({ id: 'm-050', createdAt: same }, wm)).toBe(false);
  });
});

// ── loadLatestSummary ──────────────────────────────────────────────────────

describe('loadLatestSummary (pick-max-watermark)', () => {
  it('nessuna riga -> null; query su role=summary, desc, take 3', async () => {
    expect(await loadLatestSummary('t1')).toBeNull();
    const arg = vi.mocked(db.chatMessage.findMany).mock.calls[0][0];
    expect(arg?.where).toEqual({ threadId: 't1', role: SUMMARY_ROLE });
    expect(arg?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg?.take).toBe(3);
  });

  it('riga malformata scartata: vince la riga valida piu\' vecchia', async () => {
    dispatchFindMany(
      [[makeSummaryRow('{corrotto'), makeSummaryRow(makePayload(), 'VALIDO')]],
      [],
    );
    const res = await loadLatestSummary('t1');
    expect(res?.text).toBe('VALIDO');
  });

  it('due righe valide -> vince il watermark MASSIMO indipendentemente dall\'ordine', async () => {
    const older = makePayload({
      coveredUntilCreatedAt: '2026-06-09T10:00:00.000Z',
      coveredUntilMessageId: 'm-010',
    });
    const newer = makePayload({
      coveredUntilCreatedAt: '2026-06-10T10:00:00.000Z',
      coveredUntilMessageId: 'm-050',
    });
    // newer NON in testa: l'ordine di insert non decide.
    dispatchFindMany([[makeSummaryRow(older, 'OLD'), makeSummaryRow(newer, 'NEW')]], []);
    const res = await loadLatestSummary('t1');
    expect(res?.text).toBe('NEW');
    expect(res?.payload.coveredUntilMessageId).toBe('m-050');
  });
});

// ── selectFoldBatch ────────────────────────────────────────────────────────

describe('selectFoldBatch (pura)', () => {
  it('sotto TRIGGER -> null (fold non dovuto)', () => {
    expect(selectFoldBatch(makeMsgs(SUMMARY_TRIGGER - 1))).toBeNull();
  });

  it('a TRIGGER esatto -> piega count-KEEP messaggi, termina su assistant', () => {
    const batch = selectFoldBatch(makeMsgs(SUMMARY_TRIGGER));
    expect(batch).not.toBeNull();
    expect(batch!.length).toBe(SUMMARY_TRIGGER - SUMMARY_KEEP); // 30
    expect(batch![batch!.length - 1].role).toBe('assistant');
    expect(batch![0].id).toBe('m0001'); // i PIU' VECCHI
  });

  it('backlog grosso -> cap MAX_BATCH (convergenza multi-turno)', () => {
    const batch = selectFoldBatch(makeMsgs(100)); // fetch cap = TRIGGER+MAX_BATCH
    expect(batch!.length).toBe(SUMMARY_MAX_BATCH); // 40
  });

  it('confine su user -> shrink fino all\'assistant precedente', () => {
    const msgs = makeMsgs(SUMMARY_TRIGGER);
    // foldableCount=30: l'elemento di confine (indice 29) e' assistant per
    // costruzione; forzo il confine su user per esercitare lo shrink. Lo
    // shrink salta anche la riga user naturale a indice 28 e atterra
    // sull'assistant a indice 27 -> batch di 28.
    msgs[29] = { ...msgs[29], role: 'user' };
    const batch = selectFoldBatch(msgs);
    expect(batch![batch!.length - 1].role).toBe('assistant');
    expect(batch!.length).toBe(28);
  });

  it('batch degenere tutto-user -> null', () => {
    const msgs = makeMsgs(SUMMARY_TRIGGER).map(m => ({ ...m, role: 'user' }));
    expect(selectFoldBatch(msgs)).toBeNull();
  });
});

// ── buildSummaryBlock ──────────────────────────────────────────────────────

describe('buildSummaryBlock', () => {
  const summary: LoadedSummary = { text: 'fatti registrati', payload: makePayload() };

  it('header ledger + testo, nessuna nota copertura sotto la finestra', () => {
    const block = buildSummaryBlock(summary, SUMMARY_WINDOW);
    expect(block).toContain('RIASSUNTO DEI TURNI PRECEDENTI');
    expect(block).toContain('ledger di fatti registrati');
    expect(block).toContain('fatti registrati');
    expect(block).not.toContain('NOTA COPERTURA');
  });

  it('uncoveredCount oltre la finestra -> nota copertura con data del watermark', () => {
    const block = buildSummaryBlock(summary, SUMMARY_WINDOW + 15);
    expect(block).toContain('NOTA COPERTURA');
    expect(block).toContain('2026-06-10'); // coveredUntilCreatedAt.slice(0,10)
    expect(block).toContain('15+');
  });

  it('cap difensivo sul testo iniettato', () => {
    const huge: LoadedSummary = {
      text: 'x'.repeat(SUMMARY_BLOCK_CHAR_CAP + 5000),
      payload: makePayload(),
    };
    const block = buildSummaryBlock(huge, 10);
    // bound: testo troncato al cap (+ header/ellissi), MAI i 5000 extra
    expect(block.length).toBeLessThan(SUMMARY_BLOCK_CHAR_CAP + 500);
    expect(block).toContain('…');
  });
});

// ── buildSummarizerPrompt ──────────────────────────────────────────────────

describe('buildSummarizerPrompt', () => {
  it('include ledger precedente, turni etichettati e direttive load-bearing', () => {
    const { system, user } = buildSummarizerPrompt('LEDGER VECCHIO', makeMsgs(4));
    expect(user).toContain('LEDGER VECCHIO');
    expect(user).toContain('UTENTE: msg-1');
    expect(user).toContain('SHADOW: msg-2');
    // vincoli non negoziabili della spec §2
    expect(system).toContain('crisi');
    expect(system).toContain('__auto_start__');
    expect(system).toContain('ledger');
  });

  it('primo fold -> placeholder esplicito al posto del ledger', () => {
    const { user } = buildSummarizerPrompt(null, makeMsgs(2));
    expect(user).toContain('(nessuno: primo fold di questo thread)');
  });

  it('messaggi oltre il cap troncati nel prompt (bound costi)', () => {
    const msgs = makeMsgs(2);
    msgs[0] = { ...msgs[0], content: 'a'.repeat(SUMMARIZER_MSG_CHAR_CAP + 400) };
    const { user } = buildSummarizerPrompt(null, msgs);
    expect(user).toContain('[…troncato]');
    expect(user).not.toContain('a'.repeat(SUMMARIZER_MSG_CHAR_CAP + 1));
  });
});

// ── rollSummaryIfNeeded ────────────────────────────────────────────────────

describe('rollSummaryIfNeeded (fail-open, gate server-side)', () => {
  it('kill switch off -> disabled, ZERO accessi a db/LLM', async () => {
    process.env.SHADOW_ROLLING_SUMMARY = 'off';
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('disabled');
    expect(db.chatThread.findUnique).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('thread non trovato -> skipped', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue(null);
    expect((await rollSummaryIfNeeded('t1')).status).toBe('skipped');
  });

  it('thread evening_review -> skipped (gate su thread.mode SERVER-side)', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      id: 't1',
      mode: 'evening_review',
      state: 'active',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await rollSummaryIfNeeded('t1');
    expect(res).toEqual({ status: 'skipped', reason: 'evening_review' });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('thread non active (archived) -> skipped', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      id: 't1',
      mode: 'general',
      state: 'archived',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await rollSummaryIfNeeded('t1');
    expect(res).toEqual({ status: 'skipped', reason: 'state_archived' });
  });

  it('sotto soglia -> not_due, LLM mai chiamato', async () => {
    dispatchFindMany([[]], makeMsgs(SUMMARY_TRIGGER - 1));
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('not_due');
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('happy path primo fold: callLLM fast/0.2/700/1-tentativo + insert riga con payload v1 e telemetria', async () => {
    const history = makeMsgs(SUMMARY_TRIGGER);
    dispatchFindMany([[]], history);
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('folded');

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    expect(llmArg.tier).toBe('fast');
    expect(llmArg.temperature).toBe(0.2);
    expect(llmArg.maxTokens).toBe(700);
    expect(llmArg.maxAttempts).toBe(1);

    const createArg = vi.mocked(db.chatMessage.create).mock.calls[0][0];
    expect(createArg.data.role).toBe(SUMMARY_ROLE);
    expect(createArg.data.content).toBe('LEDGER AGGIORNATO');
    expect(createArg.data.modelUsed).toBe('claude-haiku-4-5');
    expect(createArg.data.tokensIn).toBe(4000);
    expect(createArg.data.tokensOut).toBe(300);
    expect(createArg.data.latencyMs).toBe(2100);

    const payload = JSON.parse(createArg.data.payloadJson as string) as SummaryPayload;
    const expectedLast = history[SUMMARY_TRIGGER - SUMMARY_KEEP - 1]; // confine assistant
    expect(payload.kind).toBe('rolling-summary');
    expect(payload.version).toBe(1);
    expect(payload.coveredUntilMessageId).toBe(expectedLast.id);
    expect(payload.coveredUntilCreatedAt).toBe(expectedLast.createdAt.toISOString());
    expect(payload.messagesCovered).toBe(SUMMARY_TRIGGER - SUMMARY_KEEP);
    expect(payload.costUsd).toBeCloseTo(0.0055, 6);
  });

  it('merge: ledger precedente nel prompt e messagesCovered cumulato', async () => {
    const prev = makeSummaryRow(
      makePayload({ messagesCovered: 40, coveredUntilCreatedAt: '2026-06-01T00:00:00.000Z', coveredUntilMessageId: 'm-old' }),
      'LEDGER VECCHIO',
    );
    dispatchFindMany([[prev]], makeMsgs(SUMMARY_TRIGGER));
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('folded');
    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    expect(llmArg.messages[0].content).toContain('LEDGER VECCHIO');
    const createArg = vi.mocked(db.chatMessage.create).mock.calls[0][0];
    const payload = JSON.parse(createArg.data.payloadJson as string) as SummaryPayload;
    expect(payload.messagesCovered).toBe(40 + (SUMMARY_TRIGGER - SUMMARY_KEEP));
  });

  it('LLM reject -> error, NESSUN insert, NESSUN throw (fail-open)', async () => {
    dispatchFindMany([[]], makeMsgs(SUMMARY_TRIGGER));
    vi.mocked(callLLM).mockRejectedValue(new Error('api down'));
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('error');
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });

  it('output vuoto del summarizer -> error, nessun insert', async () => {
    dispatchFindMany([[]], makeMsgs(SUMMARY_TRIGGER));
    vi.mocked(callLLM).mockResolvedValue({
      text: '   ',
      toolCalls: [],
      stopReason: 'end_turn',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'claude-haiku-4-5' as any,
      tokensIn: 1,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 10,
    });
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('error');
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });

  it('guard idempotente: watermark gia\' coperto al re-read -> skipped, nessun insert (mai regressivo)', async () => {
    const history = makeMsgs(SUMMARY_TRIGGER);
    const boundary = history[SUMMARY_TRIGGER - SUMMARY_KEEP - 1];
    // 1a lettura (prev): nessun summary. 2a lettura (guard): un fold
    // concorrente ha gia' coperto fino al confine del nostro batch.
    const concurrent = makeSummaryRow(
      makePayload({
        coveredUntilMessageId: boundary.id,
        coveredUntilCreatedAt: boundary.createdAt.toISOString(),
      }),
      'FOLD CONCORRENTE',
    );
    dispatchFindMany([[], [concurrent]], history);
    const res = await rollSummaryIfNeeded('t1');
    expect(res).toEqual({ status: 'skipped', reason: 'already_covered' });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });

  it('errore db -> error senza throw (after() non deve mai vedere un reject)', async () => {
    vi.mocked(db.chatThread.findUnique).mockRejectedValue(new Error('neon down'));
    const res = await rollSummaryIfNeeded('t1');
    expect(res.status).toBe('error');
    expect(res.reason).toBe('neon down');
  });
});
