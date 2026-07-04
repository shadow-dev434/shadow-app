/**
 * Collaudo 68 — J13 passo 2: chat general sotto overwhelm + sonda N9.
 * Utente: collaudo68-sommerso@probe.local (55 task non terminali).
 *
 *  - "sono sommerso, non so da dove iniziare" -> la risposta riduce (propone UN
 *    passo) o elenca tutto? (WARN lessicale, mai FAIL)
 *  - N9: get_today_tasks ha take 15 (tools.ts:1143) -> con 55 task il modello
 *    vede al massimo 15 voci e NON sa che ce ne sono altre 40 (nessun campo
 *    total). Assert HARD sulla meccanica: se il tool gira, result.data <= 15.
 *  - "cosa ho in lista?" per forzare il tool se il primo turno non lo invoca.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j13-20-chat-sommerso.ts
 */
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  llmSpend, assert, warn, finish,
} from './lib';

const J = 'J13';

interface ToolExec { name: string; input?: unknown; result?: unknown }

function todayTasksCount(tools: ToolExec[]): { invoked: boolean; n: number | null; raw: string } {
  const t = tools.find((x) => x.name === 'get_today_tasks');
  if (!t) return { invoked: false, n: null, raw: '' };
  const res = t.result as { data?: unknown[] } | unknown[] | undefined;
  const arr = Array.isArray(res) ? res : (res && Array.isArray((res as { data?: unknown[] }).data) ? (res as { data: unknown[] }).data : null);
  return { invoked: true, n: arr ? arr.length : null, raw: JSON.stringify(t.result).slice(0, 1500) };
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const user = await cohortUser('sommerso');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J13 passo 2 — chat general sommerso — ${user.email} — clientDate=${clientDate}`];

  let threadId: string | null = null;
  const utterances = [
    'sono sommerso, non so da dove iniziare',
    'cosa ho in lista?',
  ];

  let n9Seen: { invoked: boolean; n: number | null; raw: string } | null = null;
  let firstReply = '';

  for (const [i, msg] of utterances.entries()) {
    const t0 = Date.now();
    let r = await postTurn({ cookie, mode: 'general', userMessage: msg, threadId, clientDate });
    if (r.status !== 200) {
      warn(`turno ${i + 1} HTTP ${r.status}, retry 1`, r.json);
      r = await postTurn({ cookie, mode: 'general', userMessage: msg, threadId, clientDate });
    }
    const ms = Date.now() - t0;
    assert(r.status === 200, `general turno ${i + 1} HTTP 200`, r.json);
    if (r.status !== 200) break;
    threadId = r.json.threadId ?? threadId;
    const tools = (r.json.toolsExecuted ?? []) as ToolExec[];
    const tt = todayTasksCount(tools);
    if (tt.invoked) n9Seen = tt;
    if (i === 0) firstReply = r.json.assistantMessage ?? '';
    log.push('', `## TURNO ${i + 1}: "${msg}" -> 200 (${ms}ms) tools=[${tools.map((t) => t.name).join(',')}] qr=[${(r.json.quickReplies ?? []).map((q) => q.label ?? q.action).join(' | ')}] cost=$${(r.json.costUsd ?? 0).toFixed(4)}`);
    log.push(`risposta (${(r.json.assistantMessage ?? '').length} char):`);
    log.push(r.json.assistantMessage ?? '');
    if (tt.invoked) log.push(`[N9] get_today_tasks -> ${tt.n} elementi visti dal modello (DB=55). result raw: ${tt.raw}`);
  }

  // ── valutazioni ────────────────────────────────────────────────────────────
  // N9 meccanica: se il tool e' stato invocato, il modello vede <= 15 task.
  if (n9Seen) {
    assert(n9Seen.n !== null && n9Seen.n <= 15, `N9: get_today_tasks restituisce <=15 elementi (visti ${n9Seen.n} su 55 in DB)`, n9Seen);
    if (n9Seen.n === 15) {
      warn('N9 CONFERMATA: il modello vede esattamente 15 task su 55; nessun campo "total" nel result -> i 40 oltre il cap sono invisibili E il modello non sa che esistono');
    }
    const totalHinted = /total|altri|"count"/i.test(n9Seen.raw);
    log.push('', `[N9] indizio di totale nel result del tool: ${totalHinted ? 'presente' : 'ASSENTE'}`);
  } else {
    warn('N9: get_today_tasks mai invocato nei 2 turni (sonda lessicale non conclusiva)');
  }

  // Lessicale (WARN): la prima risposta riduce o elenca?
  const bulletCount = (firstReply.match(/^\s*[-•*\d]+[.)]?\s+/gm) ?? []).length;
  log.push('', `## Analisi prima risposta: ${firstReply.length} char, ${bulletCount} voci elencate`);
  if (bulletCount > 5) warn(`prima risposta all'overwhelm elenca ${bulletCount} voci invece di ridurre a UN passo (L2/L3)`);
  else log.push('La prima risposta NON ricalca la lista completa (<=5 voci evidenziate).');

  saveEvidence(J, 'j13-20-chat-log.md', log.join('\n'));
  if (threadId) await dumpThread(threadId, J, 'j13-trascrizione-general-sommerso');
  const spend = await llmSpend(user.id);
  console.log(`spesa cumulativa collaudo68-sommerso: $${spend.toFixed(4)}`);
  saveEvidence(J, 'j13-20-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  await db.$disconnect();
  finish('j13-20-chat-sommerso');
}

main().catch(async (err) => {
  console.error('[FATAL] j13-20:', err);
  await db.$disconnect();
  process.exit(1);
});
