/**
 * Collaudo 62 — J7 passo 6 (D49): non esiste alcuna superficie API/UI per
 * listare le ricorrenze attive (censimento: solo l'export GDPR include
 * recurringTasks). Unica via: la chat. Si chiede "che ricorrenze ho attive?"
 * e si valuta completezza/accuratezza contro il DB.
 *
 * Stato atteso al momento del run: ATTIVE = Innaffiare le piante (weekly ma/gio),
 * Bere due litri d'acqua (daily). DISATTIVATA = Stretching 10 minuti.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-06-d49-lista-ricorrenze.ts
 */
import { cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';

const J = 'J7';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });

  const templates = await db.recurringTask.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
  saveEvidence(J, '06-db-templates-ground-truth.json', JSON.stringify(templates, null, 2));
  console.log('[J7-06] ground truth DB:');
  for (const t of templates) console.log(`  "${t.title}" freq=${t.frequency} weekdays=${t.weekdays} active=${t.active}`);

  const t1 = await postTurn({ cookie, mode: 'general', userMessage: 'che ricorrenze ho attive in questo momento?' });
  console.log(`[J7-06] turno -> HTTP ${t1.status}`);
  saveEvidence(J, '06-turno-lista-ricorrenze.json', JSON.stringify(t1, null, 2));
  const tools = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-06] tools=[${tools.join(', ')}]`);
  console.log(`[J7-06] assistant:\n${t1.json.assistantMessage}`);
  if (t1.json.threadId) await dumpThread(t1.json.threadId, J, '06-thread-lista-ricorrenze');

  const msg = (t1.json.assistantMessage ?? '').toLowerCase();
  console.log(JSON.stringify({
    verdict: {
      http200: t1.status === 200,
      mentionsPiante: msg.includes('piante') || msg.includes('innaffiare'),
      mentionsAcqua: msg.includes('acqua'),
      mentionsStretchingAsActive: msg.includes('stretching'),
      toolsUsed: tools,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-06:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
