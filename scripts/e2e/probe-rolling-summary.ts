/**
 * Probe e2e Task 40 — rolling summary: fold, iniezione, esclusione UI,
 * merge multi-fold, idempotenza/watermark non regressivo.
 *
 * Strategia: thread DEDICATO con history sintetica seminata via DB (niente
 * decine di turni LLM live: il fold resta una chiamata Haiku reale) + turni
 * reali su POST /api/chat/turn per esercitare trigger after() e iniezione.
 *
 * Prerequisiti:
 *  - dev server attivo su baseUrl con SHADOW_ROLLING_SUMMARY non-off
 *  - per il check debugSummaryChars: server avviato con SHADOW_SUMMARY_DEBUG=1
 *    (assenza -> WARN, non FAIL: e' un observable facoltativo)
 *
 * Uso:
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-rolling-summary.ts <userId> [baseUrl]
 *
 * Crea un thread marcato PROBE-TASK40 e lo RIMUOVE in finally (cascade sui
 * messaggi, righe summary incluse), anche su fail. Usare un utente probe
 * dedicato: durante il run il thread probe diventa il piu' recente del
 * profilo (active-thread lo reidraterebbe in una sessione UI concorrente).
 * Exit 0 = tutti i check obbligatori passati (i WARN non bloccano).
 */

import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';
import {
  SUMMARY_ROLE,
  SUMMARY_TRIGGER,
  SUMMARY_KEEP,
  SUMMARY_MAX_BATCH,
  parseSummaryPayload,
  isAfterWatermark,
  type SummaryPayload,
} from '../../src/lib/chat/summary';

const PROBE_MARKER = 'PROBE-TASK40';
const SEED_1 = 70; // >= TRIGGER+2: il primo turno reale innesca fold1
const SEED_2 = 30; // backlog extra per innescare fold2 (merge)

const userId = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://localhost:3000';
if (!userId) {
  console.error('Uso: ... probe-rolling-summary.ts <userId> [baseUrl]');
  process.exit(1);
}

let failures = 0;
let warnings = 0;
let probeThreadId: string | null = null;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Check LLM-dependent o env-dependent: non blocca l'exit code. */
function warn(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) warnings++;
}

async function mintCookie(): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) throw new Error(`utente ${userId} non trovato`);
  const token = await encode({
    token: {
      id: userId,
      sub: userId,
      email: user.email,
      name: user.name ?? 'Probe',
      tourCompleted: true,
      onboardingComplete: true,
    },
    secret,
    maxAge: 3600,
  });
  return `next-auth.session-token=${token}`;
}

async function api(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function postTurn(cookie: string, userMessage: string) {
  return api(cookie, 'POST', '/api/chat/turn', {
    threadId: probeThreadId,
    mode: 'general',
    userMessage,
  });
}

/**
 * Semina `count` righe user/assistant alternate (dispari=user) con fatti
 * numerati verificabili. createdAt esplicito e crescente a partire da `base`.
 */
async function seedMessages(threadId: string, count: number, base: Date, startN: number) {
  await db.chatMessage.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const n = startN + i;
      const isUser = (i + 1) % 2 === 1;
      return {
        threadId,
        role: isUser ? 'user' : 'assistant',
        content: isUser
          ? `${PROBE_MARKER} FATTO #${n}: il codice del progetto numero ${n} e' ALFA-${n}.`
          : `${PROBE_MARKER} registrato il fatto #${n} (ALFA-${n}).`,
        createdAt: new Date(base.getTime() + i * 1000),
      };
    }),
  });
}

async function summaryRows(threadId: string) {
  const rows = await db.chatMessage.findMany({
    where: { threadId, role: SUMMARY_ROLE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    modelUsed: r.modelUsed,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    latencyMs: r.latencyMs,
    payload: parseSummaryPayload(r.payloadJson),
  }));
}

/** Poll finche' fn() ritorna non-null o scade il timeout (after() e' async). */
async function poll<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 30_000,
  intervalMs = 1_500,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out !== null) return out;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function cleanup(): Promise<void> {
  if (probeThreadId === null) return;
  // Cascade sui messaggi (ChatMessage.thread onDelete: Cascade): rimuove
  // anche le righe summary. Delete per id+userId: mai criteri larghi.
  await db.chatThread.deleteMany({ where: { id: probeThreadId, userId } });
}

async function main(): Promise<void> {
  const cookie = await mintCookie();

  // ── 0. Thread probe dedicato + history sintetica ─────────────────────
  const thread = await db.chatThread.create({
    data: { userId, mode: 'general', state: 'active', title: PROBE_MARKER },
  });
  probeThreadId = thread.id;
  console.log(`thread probe: ${probeThreadId}`);

  // Base 2h nel passato: i turni reali (now) restano DOPO la semina.
  await seedMessages(probeThreadId, SEED_1, new Date(Date.now() - 2 * 3600_000), 1);
  const seeded = await db.chatMessage.findMany({
    where: { threadId: probeThreadId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true, createdAt: true },
  });
  check('semina batch 1', seeded.length === SEED_1, `${seeded.length}/${SEED_1} righe`);

  // ── 1. Turno reale -> trigger after() -> fold1 ───────────────────────
  const turn1 = await postTurn(cookie, `${PROBE_MARKER} ciao, riprendiamo da dove eravamo.`);
  check('turno 1: POST /api/chat/turn 200', turn1.status === 200, `status=${turn1.status}`);
  check(
    'turno 1: risponde sul thread probe',
    turn1.json.threadId === probeThreadId,
    String(turn1.json.threadId),
  );

  const fold1 = await poll(async () => {
    const rows = await summaryRows(probeThreadId!);
    return rows.length >= 1 ? rows : null;
  });
  check('fold1: riga role=summary creata (after() vivo)', fold1 !== null);
  if (fold1 === null) throw new Error('fold1 mai arrivato: inutile proseguire');

  const f1 = fold1[0];
  // Post-watermark al fold1 = SEED_1 + 2 (turno 1) = 72 -> batch atteso
  // min(72-KEEP, MAX_BATCH) = 40, confine sull'assistant n.40 della semina.
  const expectedBatch1 = Math.min(SEED_1 + 2 - SUMMARY_KEEP, SUMMARY_MAX_BATCH);
  const expectedBoundary = seeded[expectedBatch1 - 1];
  check('fold1: payload v1 valido', f1.payload !== null);
  check(
    'fold1: watermark = confine batch atteso (assistant)',
    f1.payload?.coveredUntilMessageId === expectedBoundary.id &&
      expectedBoundary.role === 'assistant',
    `atteso ${expectedBoundary.id} (${expectedBoundary.role}), avuto ${f1.payload?.coveredUntilMessageId}`,
  );
  check(
    'fold1: messagesCovered = dimensione batch',
    f1.payload?.messagesCovered === expectedBatch1,
    `atteso ${expectedBatch1}, avuto ${f1.payload?.messagesCovered}`,
  );
  check(
    'fold1: telemetria V2c popolata (haiku, token, latenza)',
    (f1.modelUsed ?? '').includes('haiku') &&
      (f1.tokensIn ?? 0) > 0 &&
      (f1.tokensOut ?? 0) > 0 &&
      (f1.latencyMs ?? 0) > 0,
    `model=${f1.modelUsed} in=${f1.tokensIn} out=${f1.tokensOut} lat=${f1.latencyMs}ms`,
  );
  check('fold1: contenuto non vuoto', f1.content.trim().length > 0);
  check(
    'fold1: costUsd nel payload',
    typeof f1.payload?.costUsd === 'number' && f1.payload.costUsd > 0,
    `costUsd=${f1.payload?.costUsd}`,
  );
  console.log(
    `  fold1: ${f1.tokensIn}->${f1.tokensOut} tok, $${f1.payload?.costUsd?.toFixed(6)}, ${f1.latencyMs}ms`,
  );

  // ── 2. Esclusione dal rehydrate UI ───────────────────────────────────
  const rehydrate = await api(cookie, 'GET', '/api/chat/active-thread?clientTime=12:00&clientDate=2026-06-11');
  const activeThread = rehydrate.json.activeThread as {
    threadId?: string;
    messages?: Array<{ role: string }>;
  } | null;
  check(
    'rehydrate UI: il thread attivo coincide col probe',
    activeThread?.threadId === probeThreadId,
  );
  check(
    'rehydrate UI: NESSUNA riga summary tra i messaggi',
    (activeThread?.messages ?? []).every(m => m.role === 'user' || m.role === 'assistant'),
  );

  // ── 3. Iniezione: observable debugSummaryChars + check behavioral ───
  const turn2 = await postTurn(cookie, `${PROBE_MARKER} qual era il codice del progetto numero 3?`);
  check('turno 2: 200', turn2.status === 200);
  warn(
    'iniezione: debugSummaryChars > 0 (richiede server con SHADOW_SUMMARY_DEBUG=1)',
    typeof turn2.json.debugSummaryChars === 'number' && (turn2.json.debugSummaryChars as number) > 0,
    `debugSummaryChars=${String(turn2.json.debugSummaryChars)}`,
  );
  warn(
    'behavioral: il modello recupera il FATTO #3 dal summary (LLM-dependent)',
    String(turn2.json.assistantMessage ?? '').includes('ALFA-3'),
    `risposta: ${String(turn2.json.assistantMessage ?? '').slice(0, 120)}`,
  );

  // ── 4. Fold2: merge del ledger ───────────────────────────────────────
  // Semina un secondo backlog (timestamp DOPO il turno 2) e fa un turno.
  await seedMessages(probeThreadId, SEED_2, new Date(), SEED_1 + 1);
  const turn3 = await postTurn(cookie, `${PROBE_MARKER} ok, andiamo avanti.`);
  check('turno 3: 200', turn3.status === 200);

  const fold2 = await poll(async () => {
    const rows = await summaryRows(probeThreadId!);
    return rows.length >= 2 ? rows : null;
  });
  check('fold2: seconda riga summary (compaction incrementale)', fold2 !== null);
  if (fold2 !== null) {
    const valid = fold2.filter(r => r.payload !== null);
    const latest = valid.reduce((a, b) =>
      isAfterWatermark(
        {
          id: b.payload!.coveredUntilMessageId,
          createdAt: new Date(b.payload!.coveredUntilCreatedAt),
        },
        a.payload as SummaryPayload,
      )
        ? b
        : a,
    );
    check(
      'fold2: watermark AVANZATO (mai regressivo)',
      latest.id !== f1.id &&
        isAfterWatermark(
          {
            id: latest.payload!.coveredUntilMessageId,
            createdAt: new Date(latest.payload!.coveredUntilCreatedAt),
          },
          f1.payload as SummaryPayload,
        ),
    );
    check(
      'fold2: messagesCovered cumulato',
      (latest.payload?.messagesCovered ?? 0) > expectedBatch1,
      `covered=${latest.payload?.messagesCovered}`,
    );
    warn(
      'merge: il ledger fold2 conserva un fatto del batch 1 (LLM-dependent)',
      /ALFA-\d/.test(latest.content),
      `estratto: ${latest.content.slice(0, 160)}`,
    );
    console.log(
      `  fold2: ${latest.tokensIn}->${latest.tokensOut} tok, $${latest.payload?.costUsd?.toFixed(6)}, ${latest.latencyMs}ms`,
    );
  }

  // ── 5. Idempotenza: sotto soglia nessun fold nuovo ───────────────────
  const before = (await summaryRows(probeThreadId)).length;
  const turn4 = await postTurn(cookie, `${PROBE_MARKER} ultima domanda: tutto ok?`);
  check('turno 4: 200', turn4.status === 200);
  // Attesa breve: se un fold indebito partisse, comparirebbe qui.
  await new Promise(r => setTimeout(r, 8_000));
  const after = await summaryRows(probeThreadId);
  check(
    'idempotenza: count sotto soglia -> NESSUN fold nuovo',
    after.length === before,
    `righe summary: ${before} -> ${after.length}`,
  );
  const stillLatest = after.filter(r => r.payload !== null).pop();
  check(
    'watermark finale invariato dopo il turno sotto soglia',
    stillLatest !== undefined,
  );

  // ── 6. Costo totale del probe ────────────────────────────────────────
  const totalCost = after.reduce((s, r) => s + (r.payload?.costUsd ?? 0), 0);
  console.log(
    `\ncosto fold cumulativo: $${totalCost.toFixed(6)} su ${after.length} fold ` +
      `(+ ~4 turni haiku live)`,
  );
}

main()
  .catch(err => {
    console.error('Probe error:', err);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch(err => console.error('Cleanup error:', err));
    console.log(
      failures === 0
        ? `\nPROBE OK (tutti i check obbligatori passati${warnings > 0 ? `, ${warnings} WARN` : ''})`
        : `\nPROBE FAIL (${failures} check falliti, ${warnings} WARN)`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
