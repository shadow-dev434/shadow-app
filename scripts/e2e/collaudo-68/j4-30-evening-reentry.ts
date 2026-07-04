/**
 * Collaudo 68 — J4 passi 4-5: review serale con apertura RE_ENTRY + D40.
 *
 * 1. openEveningWindow (ripristino in finally, §2.12).
 * 2. Retrodata lastTurnAt di TUTTI i thread a -4gg (simulazione tempo
 *    sanzionata: il gap 8c si calcola su max(lastTurnAt); senza retrodatazione
 *    l'attività del mattino azzererebbe il gap).
 * 3. GET /api/chat/active-thread dentro finestra -> spina 8c: archivia il set
 *    non-terminale, activeThread=null, shouldStart=true.
 * 4. POST turn evening_review threadId=null -> apertura RE_ENTRY attesa
 *    (bentornato senza conteggio giorni). WARN con 1 retry (LLM reale).
 * 5. Due turni di review (mood/energia), poi D40: turno general parallelo ->
 *    GET /api/chat/threads: quante voci "Oggi" indistinguibili?
 * Adattato da collaudo-62/rientro-06 + rientro-07.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4-30-evening-reentry.ts
 */
import { preflightDb, api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, openEveningWindow, assert, warn, finish, db } from './lib';

const J = 'J4';
const PAST = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

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
const user = await cohortUser('rientro');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
const { hhmm, date } = nowRome();

const restore = await openEveningWindow(user.id);
try {
  // 2. Retrodatazione lastTurnAt.
  const upd = await db.chatThread.updateMany({ where: { userId: user.id }, data: { lastTurnAt: PAST } });
  console.log(`[J4] retrodatati lastTurnAt di ${upd.count} thread a ${PAST.toISOString()}`);

  const before = await db.chatThread.findMany({
    where: { userId: user.id },
    select: { id: true, mode: true, state: true, lastTurnAt: true },
  });
  saveEvidence(J, '30-db-before-spina.json', JSON.stringify(before, null, 2));

  // 3. Apertura in finestra -> spina 8c.
  const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(hhmm)}&clientDate=${date}`, { cookie });
  saveEvidence(J, '30-active-thread-in-window.json', JSON.stringify({ clientTime: hhmm, clientDate: date, status: at.status, body: at.json }, null, 2));
  console.log(`[J4] GET active-thread (in finestra ${hhmm}) -> ${at.status}\n${JSON.stringify(at.json, null, 2)}`);
  assert(at.status === 200, 'active-thread in finestra: 200', at.status);
  const atBody = at.json as { activeThread: unknown; eveningReview?: { shouldStart?: boolean } };
  assert(atBody.activeThread === null, 'spina 8c: activeThread=null', atBody.activeThread);
  assert(atBody.eveningReview?.shouldStart === true, 'eveningReview.shouldStart=true (card review)', atBody.eveningReview);
  const nonTerminal = await db.chatThread.count({ where: { userId: user.id, state: { in: ['active', 'paused'] } } });
  assert(nonTerminal === 0, 'spina 8c: nessun thread non-terminale residuo', nonTerminal);

  // 4. Apertura review RE_ENTRY (WARN + 1 retry).
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
    console.log(`[J4] classificazione: ${JSON.stringify(cls)}`);
    evening = { threadId: r.json.threadId };
    assert(!cls.dayCount, `attempt${attempt}: MAI conteggio giorni nell'apertura`, r.json.assistantMessage);
    if (cls.guilt) warn(`attempt${attempt}: lessico colpevolizzante nell'apertura`, r.json.assistantMessage);
    if (cls.reEntry) { verdict = `attempt${attempt}: apertura RE_ENTRY riconosciuta`; break; }
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
  console.log(`[J4] verdetto RE_ENTRY: ${verdict}`);

  if (evening) {
    // 5a. Due turni di review (mood 3, energia 3).
    let i = 2;
    for (const msg of ['3', '3']) {
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId: evening.threadId, clientDate: date });
      saveEvidence(J, `30-review-turn${i}.json`, JSON.stringify(r.json, null, 2));
      assert(r.status === 200, `review turno ${i}: 200`, r.status);
      console.log(`\n[review turno ${i}] ${r.json.assistantMessage}\ntools: ${JSON.stringify(r.json.toolsExecuted?.map((t) => t.name))}\nQR: ${JSON.stringify(r.json.quickReplies)}`);
      i++;
    }
    await dumpThread(evening.threadId, J, '30-trascrizione-review-reentry');

    // 5b. D40: turno general mentre la review è viva -> lista thread.
    const gen = await postTurn({ cookie, mode: 'general', userMessage: 'aspetta, prima segnami una cosa: ritirare il pacco al fermopoint', threadId: null, clientDate: date });
    saveEvidence(J, '30-d40-general-turn.json', JSON.stringify(gen.json, null, 2));
    assert(gen.status === 200 && !!gen.json.threadId, 'turno general parallelo: 200 + threadId', { status: gen.status });
    console.log(`\n[general parallelo] ${gen.json.assistantMessage}\ntools: ${JSON.stringify(gen.json.toolsExecuted?.map((t) => t.name))}`);
    if (gen.json.threadId) await dumpThread(gen.json.threadId, J, '30-trascrizione-general-parallela');

    const th = await api('GET', '/api/chat/threads', { cookie });
    saveEvidence(J, '30-d40-threads-list.json', JSON.stringify({ status: th.status, body: th.json }, null, 2));
    assert(th.status === 200, 'GET /api/chat/threads: 200', th.status);
    const threads = (th.json as { threads?: Array<{ id: string; mode: string; state: string; label: string; isActive: boolean }> })?.threads ?? [];
    for (const t of threads) console.log(`  [${t.label}] mode=${t.mode} state=${t.state} isActive=${t.isActive} id=${t.id}`);
    const oggi = threads.filter((t) => t.label === 'Oggi');
    console.log(`[J4] voci con label "Oggi": ${oggi.length}`);
    saveEvidence(J, '30-d40-verdict.txt', `voci label "Oggi": ${oggi.length}\n${JSON.stringify(oggi, null, 2)}`);
    if (oggi.length >= 2) warn(`D40: ${oggi.length} voci "Oggi" indistinguibili in sidebar`, oggi.map((t) => `${t.mode}/${t.state}/active=${t.isActive}`));
  }
} finally {
  await restore();
  console.log('[J4] finestra serale ripristinata');
  await db.$disconnect();
}
finish('j4-30-evening-reentry');
