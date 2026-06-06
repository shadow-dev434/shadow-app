/**
 * READ-ONLY: dump dei tool per-turno (focus T5) dei 4 thread INVALID di config-B
 * (indagine force-engagement celle E, 08/09). Zero chiamate Anthropic, zero run.
 * I thread sono archived dal reset successivo ma NON cancellati -> ChatMessage
 * leggibili (payloadJson String @db.Text -> JSON.parse; tool = {name,input,result}).
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/dump-invalid-t5.ts
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';

const THREADS = [
  { id: 'cmq23fsgh007jib5cznbps280', label: 'E-postponed run#1' },
  { id: 'cmq23hl8r008dib5cplm2prt3', label: 'E-postponed run#2' },
  { id: 'cmq23j41s0097ib5cbqab33n3', label: 'E-postponed run#3' },
  { id: 'cmq23kw4h00a1ib5cd9ftz1ya', label: 'E-parked run#1' },
];

type ToolExec = {
  name?: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

function pick(obj: Record<string, unknown> | undefined, keys: string[]): string {
  const o = obj ?? {};
  const parts = keys.filter((k) => k in o).map((k) => `${k}=${JSON.stringify(o[k])}`);
  return parts.length ? parts.join(' ') : JSON.stringify(o);
}

function fmtTool(t: ToolExec): string {
  const inp = pick(t.input, ['entryId', 'outcome', 'value', 'level']);
  const res = pick(t.result, [
    'entryId',
    'previousEntryId',
    'previousEntryOpen',
    'alreadyOpen',
    'alreadyClosed',
    'success',
    'kind',
  ]);
  return `${t.name}( ${inp} )  ->  result{ ${res} }`;
}

async function dumpThread(id: string, label: string): Promise<void> {
  const thread = await db.chatThread.findUnique({
    where: { id },
    select: { id: true, state: true },
  });
  if (!thread) {
    console.log(`\n##### ${label}  thread=${id}  -> NON TROVATO`);
    return;
  }
  const messages = await db.chatMessage.findMany({
    where: { threadId: id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, payloadJson: true },
  });
  console.log(`\n############ ${label}  thread=${id}  state=${thread.state}  (${messages.length} msg) ############`);
  let turn = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      turn++;
      const marker = turn === 5 ? '   <<<<<<<<<< T5 (utterance cella) >>>>>>>>>>' : '';
      console.log(`\n[T${turn}] USER: ${JSON.stringify(m.content)}${marker}`);
    } else if (m.role === 'assistant') {
      let tools: ToolExec[] = [];
      try {
        tools = (JSON.parse(m.payloadJson ?? '{}').toolsExecuted ?? []) as ToolExec[];
      } catch {
        tools = [];
      }
      const txt = (m.content ?? '').replace(/\s+/g, ' ').slice(0, 110);
      console.log(`[T${turn}] ASSIST text="${txt}"`);
      if (tools.length === 0) {
        console.log('        tools: (nessuno)');
      } else {
        tools.forEach((t, i) => console.log(`        tool[${i}]: ${fmtTool(t)}`));
      }
    }
  }
}

async function main(): Promise<void> {
  for (const t of THREADS) await dumpThread(t.id, t.label);
}

main()
  .catch((e) => {
    console.error('[FATAL]', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
