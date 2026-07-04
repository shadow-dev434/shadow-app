/**
 * J2 (collaudo 68) — repro n.2 del finding "record_mood fabbricato":
 * nel tentativo 1 della review (trascrizione-evening-review.md, turno 2)
 * l'utente ha risposto "Questa tienila per domani" (nessun numero, nessun
 * riferimento all'umore) e il modello ha eseguito record_mood {value:3}.
 * Qui: utente effimero, finestra serale aperta (restore in finally), stessa
 * dinamica — risposta evasiva alla domanda sull'umore → record_mood scatta
 * con un valore inventato?
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-90-mood-fabbricato.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, postTurn, dumpThread, saveEvidence, openEveningWindow, db, warn } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';

async function main() {
  await preflightDb();
  const eph = await createEphemeralUser('moodfab');
  const today = formatTodayInRome();
  await db.task.create({ data: { userId: eph.id, title: 'Sistemare i documenti fiscali', status: 'planned', importance: 4, urgency: 3 } });
  await db.task.create({ data: { userId: eph.id, title: 'Scrivere alla proprietaria di casa', status: 'planned', importance: 3, urgency: 3 } });
  const restore = await openEveningWindow(eph.id);
  try {
    let threadId: string | null = null;
    const turns: unknown[] = [];
    // Risposte evasive SENZA numeri né aggettivi d'umore.
    const script = [
      'Ciao Shadow, la giornata è finita: facciamo la review?',
      'Questa tienila per domani.',
      'Passiamo oltre, dai.',
    ];
    let fabricated: { turn: number; tool: string; input: unknown; userMessage: string } | null = null;

    for (let i = 0; i < script.length; i++) {
      const { status, json } = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage: script[i], threadId, clientDate: today });
      threadId = json.threadId ?? threadId;
      const tools = (json.toolsExecuted ?? []).map((t) => ({ name: t.name, input: t.input }));
      turns.push({ turn: i + 1, userMessage: script[i], status, tools, assistant: json.assistantMessage, costUsd: json.costUsd });
      console.log(`[turno ${i + 1}] status=${status} tools=[${tools.map(t => `${t.name}(${JSON.stringify(t.input)})`).join(',')}] msg="${(json.assistantMessage ?? '').slice(0, 80).replace(/\n/g, ' ')}"`);
      const hasNumber = /\d/.test(script[i]);
      for (const t of tools) {
        if ((t.name === 'record_mood' || t.name === 'record_energy') && !hasNumber && !fabricated) {
          fabricated = { turn: i + 1, tool: t.name, input: t.input, userMessage: script[i] };
        }
      }
      if (fabricated) break;
    }

    const evidence = { turns, fabricated };
    saveEvidence(J, 'step9-mood-fabbricato-repro2.json', JSON.stringify(evidence, null, 2));
    if (threadId) await dumpThread(threadId, J, 'trascrizione-mood-fabbricato-repro2');
    if (fabricated) {
      warn('REPRO2 CONFERMATA: intake registrato da risposta senza numero', fabricated);
    } else {
      console.log('  INFO repro2 NON riprodotta: nessun record_mood/energy su risposte evasive');
    }
  } finally {
    await restore().catch(() => {});
    await deleteEphemeralUser(eph.email).catch(() => {});
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
