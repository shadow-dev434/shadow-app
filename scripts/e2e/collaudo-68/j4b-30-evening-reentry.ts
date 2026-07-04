/**
 * Collaudo 68 — J4-bis passo 5: review serale re-entry a 15gg (LLM REALE).
 *
 * 1. openEveningWindow (RIPRISTINO in finally, §2.12).
 * 2. Retrodata lastTurnAt di TUTTI i thread a -15gg (il gap 8c si calcola su
 *    max(lastTurnAt); il morning di j4b-20 lo azzererebbe).
 * 3. GET active-thread in finestra -> spina 8c + shouldStart=true.
 * 4. Apertura review threadId=null -> attesa apertura RE_ENTRY (gap 15 >= 3):
 *    bentornato SENZA conteggio giorni (HARD), senza colpa (WARN), 1 retry.
 * 5. Due turni (umore/energia bassi) -> osservare: piano minimale? UN passo?
 * NB: la Review di ieri sera per il fantasma non esiste -> il DailyPlan di oggi
 * (creato da j4b-20) è il candidato del walk.
 * Adattato da j4-30-evening-reentry.ts (PAST=-15gg, senza la parte D40 che è di J4).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-30-evening-reentry.ts
 */
import { preflightDb, api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, openEveningWindow, assert, warn, finish, db } from './lib';

const J = 'J4bis';
const PAST = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

function nowRome(): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { hhmm: `${hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

function classifyOpening(content: string): { reEntry: boolean; dayCount: boolean; guilt: boolean } {
  const lower = content.toLowerCase();
  return {
    reEntry: /bentornat|ci si rivede|bello risentirti|bello rivederti|è passato un po|e' passato un po|rieccoci|di nuovo qui/.test(lower),
    dayCount: /\d+\s*giorn/.test(lower),
    guilt: /finalmente|dove eri finito|dov'eri finito|sparito/.test(lower),
  };
}

await preflightDb();
const user = await cohortUser('fantasma');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'C68 Fantasma' });
const { hhmm, date } = nowRome();

const restore = await openEveningWindow(user.id);
try {
  const upd = await db.chatThread.updateMany({ where: { userId: user.id }, data: { lastTurnAt: PAST } });
  console.log(`[J4bis] retrodatati lastTurnAt di ${upd.count} thread a ${PAST.toISOString()}`);

  const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(hhmm)}&clientDate=${date}`, { cookie });
  saveEvidence(J, '30-active-thread-in-window.json', JSON.stringify({ clientTime: hhmm, clientDate: date, status: at.status, body: at.json }, null, 2));
  assert(at.status === 200, 'active-thread in finestra: 200', at.status);
  const atBody = at.json as { activeThread: unknown; eveningReview?: { shouldStart?: boolean } };
  assert(atBody.activeThread === null, 'spina 8c: activeThread=null', atBody.activeThread);
  assert(atBody.eveningReview?.shouldStart === true, 'eveningReview.shouldStart=true (card review)', atBody.eveningReview);
  const nonTerminal = await db.chatThread.count({ where: { userId: user.id, state: { in: ['active', 'paused'] } } });
  assert(nonTerminal === 0, 'spina 8c: nessun thread non-terminale residuo', nonTerminal);

  let attempt = 0;
  let evening: { threadId: string } | null = null;
  let verdict = '';
  while (attempt < 2) {
    attempt++;
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: 'iniziamo', threadId: null, clientDate: date });
    saveEvidence(J, `30-review-turn1-attempt${attempt}.json`, JSON.stringify(r.json, null, 2));
    assert(r.status === 200 && !!r.json.threadId, `review turno 1 attempt${attempt}: 200 + threadId`, { status: r.status });
    if (r.status !== 200 || !r.json.threadId) break;
    console.log(`\n[apertura review attempt${attempt}] ${r.json.assistantMessage}\nQR: ${JSON.stringify(r.json.quickReplies)}`);
    const cls = classifyOpening(r.json.assistantMessage ?? '');
    console.log(`[J4bis] classificazione: ${JSON.stringify(cls)}`);
    evening = { threadId: r.json.threadId };
    assert(!cls.dayCount, `attempt${attempt}: MAI conteggio giorni nell'apertura`, r.json.assistantMessage);
    if (cls.guilt) warn(`attempt${attempt}: lessico colpevolizzante nell'apertura`, r.json.assistantMessage);
    if (cls.reEntry) { verdict = `attempt${attempt}: apertura RE_ENTRY riconosciuta a 15gg`; break; }
    verdict = `attempt${attempt}: apertura senza saluto di rientro`;
    if (attempt < 2) {
      warn('apertura senza RE_ENTRY -> retry (LLM reale)');
      await db.chatThread.update({ where: { id: r.json.threadId }, data: { state: 'archived', endedAt: new Date(), lastTurnAt: PAST } });
      evening = null;
    } else {
      warn('RE_ENTRY assente anche al retry — WARN definitivo (verificare trascrizione)');
    }
  }
  saveEvidence(J, '30-reentry-verdict.txt', verdict);
  console.log(`[J4bis] verdetto RE_ENTRY: ${verdict}`);

  if (evening) {
    let i = 2;
    for (const msg of ['2', '2']) {
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId: evening.threadId, clientDate: date });
      saveEvidence(J, `30-review-turn${i}.json`, JSON.stringify(r.json, null, 2));
      assert(r.status === 200, `review turno ${i}: 200`, r.status);
      console.log(`\n[review turno ${i}] ${r.json.assistantMessage}\ntools: ${JSON.stringify(r.json.toolsExecuted?.map((t) => t.name))}\nQR: ${JSON.stringify(r.json.quickReplies)}`);
      i++;
    }
    await dumpThread(evening.threadId, J, '30-trascrizione-review-reentry-15gg');
  }
} finally {
  await restore();
  console.log('[J4bis] finestra serale ripristinata');
  await db.$disconnect();
}
finish('j4b-30-evening-reentry');
