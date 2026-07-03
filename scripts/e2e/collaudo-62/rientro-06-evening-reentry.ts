/**
 * Collaudo 62 — J4 passo 5: variante re-entry della review serale (spina 8c).
 *
 * 1. PATCH /api/settings: finestra serale 00:00-23:59 (leva sanzionata).
 * 2. Retrodata lastTurnAt di TUTTI i thread dell'utente a -4 giorni
 *    (simulazione tempo sanzionata: dati, non orologio).
 * 3. GET /api/chat/active-thread dentro finestra -> attesa spina 8c:
 *    archivia il set non-terminale, activeThread=null, shouldStart=true.
 * 4. POST /api/chat/turn mode=evening_review threadId=null 'iniziamo'
 *    -> attesa apertura RE_ENTRY (bentornato senza conteggio giorni, poi mood).
 *    WARN con 1 retry se il modello non la usa.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-06-evening-reentry.ts
 */
import { api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';
import { snapshotRientro, diffThreads } from './rientro-00-util';

const J = 'J4';
const PAST = new Date('2026-06-27T22:00:00.000Z'); // stesso istante del seed (-4gg circa)

function nowRome(): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { hhmm: `${hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Classificazione leggera dell'apertura re-entry (calco dei vincoli HARD 8c). */
function classifyOpening(content: string): { reEntry: boolean; dayCount: boolean; asksMood: boolean; notes: string[] } {
  const lower = content.toLowerCase();
  const reEntry = /bentornat|ci si rivede|bello risentirti|è passato un po|e' passato un po/.test(lower);
  const dayCount = /\d+\s*giorn/.test(lower) || /quattro giorni|quattro giorno/.test(lower);
  const asksMood = /1-5|1 a 5|come stai/.test(lower);
  const notes: string[] = [];
  if (/finalmente|dove eri finito|dov'eri finito/.test(lower)) notes.push('LESSICO VIETATO presente');
  return { reEntry, dayCount, asksMood, notes };
}

async function main(): Promise<void> {
  const user = await cohortUser('rientro');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
  const { hhmm, date } = nowRome();

  // 1. Finestra serale aperta.
  const patch = await api('PATCH', '/api/settings', { cookie, body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' } });
  console.log(`[J4] PATCH settings -> ${patch.status}`);
  saveEvidence(J, '05-settings-patch.json', JSON.stringify({ status: patch.status, body: patch.json }, null, 2));
  if (patch.status !== 200) throw new Error(`PATCH settings fallita: ${patch.status} ${patch.text}`);

  // 2. Retrodatazione lastTurnAt (tutti i thread dell'utente).
  const upd = await db.chatThread.updateMany({ where: { userId: user.id }, data: { lastTurnAt: PAST } });
  console.log(`[J4] retrodatati lastTurnAt di ${upd.count} thread a ${PAST.toISOString()}`);

  const before = await snapshotRientro(user.id, user.email);
  saveEvidence(J, '05-db-before-spina.json', JSON.stringify(before, null, 2));

  // 3. Apertura app dentro finestra -> spina 8c.
  const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(hhmm)}&clientDate=${date}`, { cookie });
  console.log(`[J4] GET active-thread (in finestra, ${hhmm}) -> ${at.status}`);
  console.log(JSON.stringify(at.json, null, 2));
  saveEvidence(J, '05-active-thread-in-window.json', JSON.stringify({ clientTime: hhmm, clientDate: date, status: at.status, body: at.json }, null, 2));

  const after = await snapshotRientro(user.id, user.email);
  const diff = diffThreads(before, after);
  saveEvidence(J, '05-diff-spina.txt', diff.join('\n'));
  console.log('[J4] DIFF thread dopo spina:');
  for (const d of diff) console.log(`  ${d}`);

  // 4. Avvio review serale su threadId=null -> apertura RE_ENTRY attesa.
  let attempt = 0;
  let opening: { threadId: string; content: string } | null = null;
  let verdictNote = '';
  while (attempt < 2) {
    attempt++;
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: 'iniziamo', threadId: null, clientDate: date });
    console.log(`\n[J4] review turno 1 (tentativo ${attempt}) -> ${r.status} thread=${r.json.threadId}`);
    saveEvidence(J, `05-review-turn1-attempt${attempt}.json`, JSON.stringify(r.json, null, 2));
    if (r.status !== 200 || !r.json.threadId) throw new Error(`apertura review fallita: ${r.status} ${JSON.stringify(r.json)}`);
    console.log('--- ASSISTANT (apertura review) ---');
    console.log(r.json.assistantMessage);
    const cls = classifyOpening(r.json.assistantMessage ?? '');
    console.log(`[J4] classificazione: reEntry=${cls.reEntry} dayCount=${cls.dayCount} asksMood=${cls.asksMood} ${cls.notes.join(' ')}`);
    opening = { threadId: r.json.threadId, content: r.json.assistantMessage ?? '' };
    if (cls.reEntry && !cls.dayCount) {
      verdictNote = `attempt${attempt}: re-entry presente, nessun conteggio giorni, asksMood=${cls.asksMood}`;
      break;
    }
    verdictNote = `attempt${attempt}: re-entry=${cls.reEntry} dayCount=${cls.dayCount} -> ${attempt < 2 ? 'RETRY' : 'WARN definitivo'}`;
    if (attempt < 2) {
      // reset per retry: archivia il thread evening appena creato e retrodata il suo lastTurnAt
      await db.chatThread.update({ where: { id: r.json.threadId }, data: { state: 'archived', endedAt: new Date(), lastTurnAt: PAST } });
      console.log('[J4] retry: thread evening archiviato e retrodatato');
    }
  }
  saveEvidence(J, '05-reentry-verdict.txt', verdictNote);
  console.log(`[J4] verdetto re-entry: ${verdictNote}`);

  if (opening) {
    await dumpThread(opening.threadId, J, '05-trascrizione-review-reentry');
  }
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-06-evening-reentry:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
