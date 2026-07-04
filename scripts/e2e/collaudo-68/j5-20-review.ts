/**
 * Collaudo 68 — J5 "Il procrastinatore" — passo 2 (review serale LLM reale).
 * - il modello intercetta i rimandati (mark_what_blocked_asked / whatBlocked)?
 * - decomposizione opportunistica sui decompose_then_do (67C: step pregenerati)?
 * - chiusura dichiarando UN blocco esplicito ("non so da dove iniziare con la
 *   dichiarazione") -> il whatBlocked deve arrivare in Review + LearningSignal.
 * Adattato da collaudo-62/procrastinatore-review.ts. WARN+1 retry sulle scelte
 * del modello; HARD solo su HTTP/righe DB.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j5-20-review.ts
 */
import { preflightDb, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, openEveningWindow, llmSpend, assert, warn, finish, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J5';
const MAX_TURNS = 22;
await preflightDb();

const u = await cohortUser('procrastinatore');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 procrastinatore' });
const today = formatTodayInRome();

const log: string[] = [];
function push(s: string): void { log.push(s); console.log(s); }

let blockDeclared = false;
let decompApproved = false;
function utteranceFor(turnIdx: number, lastTools: string[], lastMsg: string, lastQR: string[]): string {
  if (turnIdx === 0) return 'ok dai, facciamo questa review';
  if (turnIdx === 1) return '2';
  if (turnIdx === 2) return '2';
  const msgLc = lastMsg.toLowerCase();
  if (lastTools.includes('mark_what_blocked_asked') && !blockDeclared) {
    blockDeclared = true;
    return 'non so da dove iniziare con la dichiarazione, appena la apro mi blocco';
  }
  if (lastTools.includes('propose_decomposition') || lastQR.some((q) => /salval|approv/i.test(q))) {
    if (!decompApproved) { decompApproved = true; return 'sì dai, salvali'; }
  }
  if (msgLc.includes('piano') && (msgLc.includes('va bene') || msgLc.includes('confermi') || msgLc.includes('domani'))) return 'ok, va bene il piano così';
  if (msgLc.includes('chiud')) return 'sì, chiudi pure';
  // triage per_entry: il procrastinatore rimanda, ma su UNA voce dichiara il blocco
  if (!blockDeclared && msgLc.includes('dichiarazione')) {
    blockDeclared = true;
    return 'niente, non l\'ho fatta neanche oggi: non so da dove iniziare con la dichiarazione';
  }
  return 'non l\'ho fatto, rimandiamolo a domani';
}

const restore = await openEveningWindow(u.id);
let threadId: string | null = null;
const turnLog: Array<Record<string, unknown>> = [];
const allTools: string[] = [];
let closed = false;
try {
  let lastTools: string[] = [];
  let lastMsg = '';
  let lastQR: string[] = [];
  for (let i = 0; i < MAX_TURNS; i++) {
    const msg = utteranceFor(i, lastTools, lastMsg, lastQR);
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate: today });
    assert(r.status === 200, `turno ${i + 1}: HTTP 200`, { status: r.status, err: r.json.error });
    if (r.status !== 200) break;
    threadId = r.json.threadId ?? threadId;
    lastTools = (r.json.toolsExecuted ?? []).map((t) => t.name);
    allTools.push(...lastTools);
    lastMsg = r.json.assistantMessage ?? '';
    lastQR = (r.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? '');
    turnLog.push({ turn: i + 1, user: msg, tools: lastTools, qr: lastQR, cost: r.json.costUsd, assistant: lastMsg.slice(0, 400) });
    push(`T${i + 1} [${lastTools.join(',') || '-'}] QR=[${lastQR.join(' | ')}] :: ${lastMsg.slice(0, 140).replace(/\n/g, ' ')}`);
    if (lastTools.some((t) => /confirm_close_review|close_review/.test(t))) { closed = true; break; }
    const th = await db.chatThread.findUnique({ where: { id: threadId! }, select: { state: true } });
    if (th?.state === 'completed') { closed = true; break; }
  }
} finally {
  await restore();
}

assert(closed, `review chiusa entro ${MAX_TURNS} turni`, { turns: turnLog.length, tools: allTools });
if (!allTools.includes('mark_what_blocked_asked')) warn('mark_what_blocked_asked MAI eseguito: il modello non ha indagato il blocco (WARN lessicale)');
if (!allTools.some((t) => /propose_decomposition|approve_decomposition|save_decomposition/.test(t))) warn('nessun tool di decomposizione eseguito sui decompose_then_do (67C non innescato in questo walk)');
push(`tools totali: ${allTools.join(', ')}`);

if (threadId) {
  const p = await dumpThread(threadId, J, 'j5-20-review-serale');
  push(`trascrizione: ${p}`);
}
saveEvidence(J, 'j5-20-turnlog.json', JSON.stringify(turnLog, null, 2));

const spend = await llmSpend(u.id);
push(`spesa LLM utente: $${spend.toFixed(4)}`);
saveEvidence(J, 'j5-20-run-log.txt', log.join('\n'));
finish('j5-20-review');
