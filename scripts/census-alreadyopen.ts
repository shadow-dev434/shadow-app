/**
 * Read-only census: esiste ANCORA in DB un payload con un fire alreadyOpen
 * (o previousEntryOpen) cross-verificabile? Dopo che i 4 thread nominati sono
 * risultati shell vuote (messaggi=0), serve sapere se un artefatto reale
 * sopravvive da qualche parte per confrontare la shape del result col codice.
 *
 *   bun run dotenv -e .env.local -- bun run scripts/census-alreadyopen.ts
 *
 * SOLA LETTURA.
 */

import { db } from '../src/lib/db';

async function main(): Promise<void> {
  const totMsg = await db.chatMessage.count();
  const totThread = await db.chatThread.count();
  const evThread = await db.chatThread.count({ where: { mode: 'evening_review' } });
  const assistMsg = await db.chatMessage.count({ where: { role: 'assistant' } });

  console.log(`[census] chatThread totali=${totThread} (evening_review=${evThread})`);
  console.log(`[census] chatMessage totali=${totMsg} (assistant=${assistMsg})`);

  for (const marker of ['"alreadyOpen":true', '"previousEntryOpen":true']) {
    const hits = await db.chatMessage.findMany({
      where: { role: 'assistant', payloadJson: { contains: marker } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { threadId: true, payloadJson: true, createdAt: true },
    });
    console.log(`[census] --- payload con ${marker}: ${hits.length} (mostro max 3 recenti) ---`);
    for (const h of hits) {
      let tools: Array<{ name?: string; result?: unknown }> = [];
      try {
        tools = (JSON.parse(h.payloadJson ?? '{}').toolsExecuted ?? []) as typeof tools;
      } catch {
        tools = [];
      }
      const fire = tools.find((t) => {
        const r = t.result as Record<string, unknown> | null | undefined;
        return r && (r.alreadyOpen === true || r.previousEntryOpen === true);
      });
      console.log(`[census]   thread=${h.threadId} @${h.createdAt.toISOString()}`);
      console.log(`[census]     fire.result=${JSON.stringify(fire?.result ?? null)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('[FATAL] census-alreadyopen failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
