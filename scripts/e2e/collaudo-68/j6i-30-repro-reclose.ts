/**
 * Collaudo 68 — J6 porta (i): repro n.2 del finding "reclose esplicito".
 * Rimanda lo stesso messaggio di ri-chiusura esplicita (dopo che la review di
 * oggi è già chiusa) e salva la risposta: al primo run il modello ha INVENTATO
 * un bottone "Chiudi review in fondo alla schermata" che non esiste nell'app.
 * HARD: HTTP 200, nessun nuovo Review/DailyPlan. WARN: contenuto lessicale.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6i-30-repro-reclose.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const today = formatTodayInRome();
const tomorrow = addDaysIso(today, 1);

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('review-i');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const restore = await openEveningWindow(u.id);
  try {
    const firstThread = await db.chatThread.findFirst({
      where: { userId: u.id, mode: 'evening_review', state: 'completed' },
      orderBy: { startedAt: 'asc' },
      select: { id: true },
    });
    if (!firstThread) throw new Error('nessun thread review completed: lanciare prima j6i-10');

    const r = await postTurn({
      cookie, mode: 'evening_review', threadId: firstThread.id, clientDate: today,
      userMessage: 'chiudi di nuovo la review e riconferma il piano di domani, voglio essere sicuro che sia salvato',
    });
    const msg = (r.json.assistantMessage ?? '').replace(/\n/g, ' | ');
    console.log(`RECLOSE repro2: HTTP ${r.status} thread=${r.json.threadId} tools=[${(r.json.toolsExecuted ?? []).map((t) => t.name).join(',')}]`);
    console.log(`  assistant: ${msg.slice(0, 600)}`);
    saveEvidence(J, 'j6i-reclose-repro2.json', JSON.stringify({ status: r.status, json: r.json }, null, 2));
    assert(r.status === 200, 'reclose repro2: HTTP 200');

    const lower = msg.toLowerCase();
    const hallucinated = lower.includes('bottone') || lower.includes('pulsante') || lower.includes('schermata') || lower.includes('in fondo');
    if (hallucinated) warn('reclose repro2: di nuovo riferimento a UI inesistente (bottone/schermata)', msg.slice(0, 300));
    else console.log('reclose repro2: nessun riferimento a UI inventata questa volta');

    const reviews = await db.review.count({ where: { userId: u.id, date: today } });
    const plans = await db.dailyPlan.count({ where: { userId: u.id, date: tomorrow } });
    assert(reviews === 1, 'repro2: sempre 1 Review(oggi)', reviews);
    assert(plans === 1, 'repro2: sempre 1 DailyPlan(domani)', plans);

    if (r.json.threadId) await dumpThread(r.json.threadId, J, `j6i-trascrizione-reclose-repro2-${r.json.threadId.slice(-6)}`);
    const spend = await llmSpend(u.id);
    console.log(`spesa cumulativa utente review-i: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6i-spend.txt', `llmSpend(${u.email}) = ${spend}`);
  } finally {
    await restore();
  }
  finish('j6i-30-repro-reclose');
}

main().catch(async (err) => {
  console.error('[FATAL] j6i-30:', err);
  await db.$disconnect();
  process.exit(1);
});
