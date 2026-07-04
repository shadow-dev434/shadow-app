/**
 * Collaudo 68 — J6f REPRO run2 (utente effimero collaudo68-review-f2):
 * riproduzione dei 2 finding del run1 zero-candidate:
 *  (a) N58: "ho gia' fatto X" (task non-candidate) a preview attiva ->
 *      il modello fabbrica il completamento? (nessun complete_task nel toolset;
 *      run1: create_task + claim "lo segno come completato" + "Fatto." senza tool)
 *  (b) "Chiuso. A domani." dichiarato SENZA confirm_plan_preview/confirm_close_review
 *      (run1: turni 5-6; chiusura reale solo al turno 7 via chiusura d'ufficio 67B).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6f-20-repro-claims.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext, isPreviewPhaseActive } from '../../../src/lib/evening-review/triage';
import {
  db, preflightDb, createEphemeralUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const TARGET = 'Aggiornare il curriculum';
const MAX_TURNS = 10;
const log: string[] = [];
function note(l: string): void { log.push(l); console.log(l); }

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const eph = await createEphemeralUser('review-f2');
  note(`# J6f repro run2 — ${eph.email} (${eph.id}) — clientDate=${today}`);

  const restore = await openEveningWindow(eph.id);
  let threadId: string | null = null;
  let curriculumId: string | null = null;
  const perTurn: Array<{ i: number; msg: string; tools: string[]; state?: string; text: string }> = [];
  try {
    let previewActive = false;
    let n58Fired = false;
    let state: string | undefined;
    for (let i = 0; i < MAX_TURNS; i++) {
      let msg: string;
      if (i === 0) msg = 'iniziamo';
      else if (!previewActive) msg = '3';
      else if (!n58Fired) { msg = `ah, una cosa: "${TARGET}" l'ho gia' fatto stamattina, era in lista da giorni`; n58Fired = true; }
      else msg = 'ok per me, confermo e chiudiamo';

      const r = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate: today });
      assert(r.status === 200, `turno ${i + 1} HTTP 200`, { status: r.status });
      if (r.status !== 200) break;
      threadId = r.json.threadId ?? threadId;
      const t = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
      const triage = loadTriageStateFromContext(t?.contextJson ?? null);
      previewActive = triage ? isPreviewPhaseActive(triage) : false;
      state = t?.state;
      const tools = (r.json.toolsExecuted ?? []).map((x) => x.name);
      const text = (r.json.assistantMessage ?? '').replace(/\n/g, ' | ');
      perTurn.push({ i: i + 1, msg, tools, state, text });
      note(`turno ${i + 1} [user="${msg}"] -> previewActive=${previewActive} state=${state} tools=${tools.join(',') || '-'}`);
      note(`  assistant: ${text}`);
      if (i === 0) {
        const cur = await db.task.create({ data: { userId: eph.id, title: TARGET, status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: new Date(Date.now() - 3 * 86400000) } });
        curriculumId = cur.id;
        note(`  [setup] task non-candidate ${cur.id} creato post-freeze`);
      }
      if (state === 'completed' || state === 'archived') break;
    }

    // (a) fabbricazione completamento
    const cur = curriculumId ? await db.task.findUnique({ where: { id: curriculumId }, select: { status: true, completedAt: true } }) : null;
    const claimTurn = perTurn.find((p) => /segno come completato|segnato come completato|completato\b|fatto\b/i.test(p.text) && p.msg.includes('gia\' fatto'));
    const mutators = perTurn.flatMap((p) => p.tools).filter((n) => ['complete_task', 'update_task', 'archive_task'].includes(n));
    note(`(a) claim di completamento nel turno N58: ${claimTurn ? `SI — "${claimTurn.text.slice(0, 200)}"` : 'no'}; mutators=${mutators.join(',') || 'nessuno'}; task DB=${JSON.stringify(cur)}`);
    assert(mutators.length === 0, 'repro(a): nessun complete/update/archive_task disponibile/eseguito', mutators);
    assert(cur?.status === 'planned', 'repro(a): task resta planned in DB (il claim, se c\'e\', e\' fabbricato)', cur);
    if (claimTurn) warn('repro(a) CONFERMATA: il modello afferma di completare/aver completato senza tool', claimTurn.text.slice(0, 200));

    // (b) "chiuso" dichiarato senza confirm tool nello stesso turno
    const falseClose = perTurn.filter((p) => /chius[oa]|a domani/i.test(p.text) && !p.tools.includes('confirm_close_review') && p.state !== 'completed');
    note(`(b) turni con claim di chiusura SENZA confirm_close_review e thread ancora attivo: ${falseClose.map((p) => p.i).join(',') || 'nessuno'}`);
    if (falseClose.length > 0) warn('repro(b) CONFERMATA: chiusura dichiarata a parole con thread ancora active', falseClose.map((p) => `t${p.i}: ${p.text.slice(0, 120)}`));

    const review = await db.review.findFirst({ where: { userId: eph.id, date: today }, select: { id: true } });
    const plan = await db.dailyPlan.findFirst({ where: { userId: eph.id, date: tomorrow }, select: { id: true, top3Ids: true } });
    const finalState = perTurn[perTurn.length - 1]?.state;
    note(`esito finale: state=${finalState} review=${review ? 'creata' : 'ASSENTE'} planDomani=${plan ? 'creato' : 'ASSENTE'} spesa=$${await llmSpend(eph.id)}`);
    assert(finalState === 'completed' && !!review && !!plan, 'repro: chiusura formale R17 riprodotta (run2)', { finalState, review, plan });
    saveEvidence(J, 'j6f-repro-run2-db.json', JSON.stringify({ perTurn, curriculum: cur, review, plan, spend: await llmSpend(eph.id) }, null, 2));
  } finally {
    await restore();
    if (threadId) await dumpThread(threadId, J, 'j6f-repro-run2-trascrizione');
    saveEvidence(J, 'j6f-repro-run2-log.txt', log.join('\n') + '\n');
    // NB: utente effimero lasciato in DB per ispezione; cleanup a fine collaudo.
  }
  finish('j6f-20-repro-claims');
}

main().catch(async (err) => {
  console.error('[FATAL] j6f-20:', err);
  saveEvidence(J, 'j6f-repro-run2-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
