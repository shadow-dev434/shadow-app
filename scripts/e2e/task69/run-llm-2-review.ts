/**
 * Task 69 — run LLM 2: review serale REALE con energia bassa e completamento
 * in-review (S2-A + wiring E).
 *
 * Scenario: 4 task candidabili; intake mood 4 / energia 2; alla prima entry
 * l'utente dice "questa l'ho già fatta" (caso N58 del collaudo: il modello
 * fabbricava "la segno fatta" senza tool). Invarianti:
 *  1. ZERO claim-senza-tool in tutta la review (claim-guard v2 in evening);
 *  2. il task dichiarato fatto risulta 'completed' in DB entro fine review
 *     (o il modello ha risposto col fallback onesto — mai il claim nudo);
 *  3. energyEnd=2 registrata nel triage state (da lì il sizing è pure
 *     function già coperta da unit: buffer.test + reconstruction);
 *  4. la review si chiude con Review + DailyPlan reali.
 *
 * Costo atteso: ~10-14 turni Sonnet ≈ $0.8-1.5.
 */

import { db } from '@/lib/db';
import { textClaimsWrite, isWriteToolName } from '@/lib/chat/claim-guard';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import {
  postTurn,
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  llmSpend,
  assert,
  warn,
  finish,
} from '../collaudo-68/lib';

async function main() {
  const eph = await createEphemeralUser('t69-review');
  const today = formatTodayInRome();
  let restore: (() => Promise<void>) | null = null;
  let claimNudi = 0;

  try {
    // Seed: 4 task con deadline vicina (tutti candidate 'deadline').
    const tomorrow = new Date(Date.now() + 20 * 3600 * 1000);
    const titles = ['Pagare bolletta gas', 'Chiamare commercialista', 'Portare pacco alle poste', 'Scrivere relazione breve'];
    const seeded: Array<{ id: string; title: string }> = [];
    for (const title of titles) {
      seeded.push(
        await db.task.create({
          data: { userId: eph.id, title, status: 'inbox', deadline: tomorrow, size: 2 },
          select: { id: true, title: true },
        }),
      );
    }
    restore = await openEveningWindow(eph.id);

    let threadId: string | null = null;
    const transcript: string[] = [];
    const turn = async (userMessage: string): Promise<string> => {
      const r = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      assert(r.status === 200, `turno review 200 ("${userMessage.slice(0, 30)}")`, r.status);
      threadId = r.json.threadId ?? threadId;
      const msg = r.json.assistantMessage ?? '';
      const wrote = (r.json.toolsExecuted ?? []).some((t) => isWriteToolName(t.name));
      const isFallback = /non sono riuscito a registrare|non risulta salvato/i.test(msg);
      if (textClaimsWrite(msg) && !wrote && !isFallback) {
        claimNudi++;
        console.error(`  CLAIM NUDO: "${msg.slice(0, 140)}" tools=${JSON.stringify((r.json.toolsExecuted ?? []).map((t) => t.name))}`);
      }
      transcript.push(`> ${userMessage}\n< ${msg}`);
      return msg;
    };

    await turn('__auto_start__');
    await turn('mood 4');
    await turn('energia 2, sono abbastanza scarico');
    // Caso N58: completamento dichiarato in-review sulla prima entry.
    await turn(`la bolletta del gas l'ho già pagata oggi, è fatta`);
    // Walk veloce delle altre: decisioni secche per arrivare al piano.
    await turn('il commercialista tienilo per domani');
    await turn('il pacco rimandalo, non domani');
    await turn('la relazione tienila per domani');
    let msg = await turn('ok, fammi vedere il piano');
    // Chiusura (max 3 solleciti: il flusso può chiedere conferme).
    for (let i = 0; i < 3; i++) {
      const review = await db.review.findUnique({
        where: { userId_date: { userId: eph.id, date: today } },
        select: { id: true },
      });
      if (review) break;
      msg = await turn(i === 0 ? 'va bene così, confermo: chiudi pure la review' : 'sì, chiudi');
    }

    // ── Invarianti ────────────────────────────────────────────────────────
    assert(claimNudi === 0, `ZERO claim-senza-tool nella review (trovati ${claimNudi})`);

    const bolletta = await db.task.findUnique({
      where: { id: seeded[0].id },
      select: { status: true },
    });
    if (bolletta?.status !== 'completed') {
      warn(`N58: "l'ho già fatta" non ha completato il task (status=${bolletta?.status}) — accettabile SOLO se il modello non ha claimato (claimNudi=0 lo garantisce)`);
    } else {
      console.log('  [N58] completamento in-review scritto in DB ✓');
    }

    const thread = await db.chatThread.findFirst({
      where: { userId: eph.id, mode: 'evening_review' },
      orderBy: { startedAt: 'desc' },
      select: { contextJson: true },
    });
    const ctx = JSON.parse(thread?.contextJson ?? '{}') as { triage?: { moodIntake?: { energyEnd?: number } } };
    assert(ctx.triage?.moodIntake?.energyEnd === 2, 'E: energyEnd=2 nel triage state (input del sizing)', ctx.triage?.moodIntake);

    const review = await db.review.findUnique({
      where: { userId_date: { userId: eph.id, date: today } },
      select: { id: true, energyEnd: true },
    });
    assert(review !== null, 'review chiusa: riga Review presente');
    // Piano di DOMANI (la chiusura scrive planDate=reviewDate+1; un
    // DailyPlan di OGGI vuoto esiste by-design da upsertTodayContext quando
    // set_user_energy gira in chat — non è il piano).
    const tomorrowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const plan = await db.dailyPlan.findFirst({
      where: { userId: eph.id, date: tomorrowIso },
      select: { id: true, doNowIds: true },
    });
    assert(plan !== null, 'review chiusa: DailyPlan di DOMANI presente');
    console.log(`  [piano ${tomorrowIso}] doNowIds=${plan?.doNowIds}`);
    const spend = await llmSpend(eph.id);
    console.log(`  [spesa] ~$${spend.toFixed(3)}`);
    console.log('\n--- trascrizione ---\n' + transcript.join('\n'));
  } finally {
    if (restore) await restore();
    await deleteEphemeralUser(eph.email);
  }

  finish('task69/run-llm-2-review');
}

main().catch((err) => {
  console.error('[run-llm-2] ERRORE', err);
  process.exit(1);
});
