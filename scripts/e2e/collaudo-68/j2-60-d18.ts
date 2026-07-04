/**
 * J2 (collaudo 68) — passo 6, pista D18: thread general attivo con startedAt
 * retrodatato alle 00:30 di OGGI → il bootstrap del morning check-in è soppresso
 * (bootstrap/route.ts:41-55 skippa se ESISTE un thread active, qualunque mode)?
 * 2 ripetizioni su 2 utenti effimeri. Zero LLM (il bootstrap soppresso non chiama il modello).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-60-d18.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, db, saveEvidence, assert, finish } from './lib';
import { formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';

function todayAt0030Rome(): Date {
  // Costruisce le 00:30 di oggi Europe/Rome (luglio = UTC+2 → 22:30Z di ieri).
  const today = formatTodayInRome(); // YYYY-MM-DD
  return new Date(`${today}T00:30:00+02:00`);
}

async function runOnce(iter: number): Promise<Record<string, unknown>> {
  const eph = await createEphemeralUser(`d18-${iter}`);
  try {
    const startedAt = todayAt0030Rome();
    const thread = await db.chatThread.create({
      data: {
        userId: eph.id, mode: 'general', state: 'active', startedAt, lastTurnAt: startedAt,
        messages: {
          create: [
            { role: 'user', content: 'Non riesco a dormire, domani ho mille cose', createdAt: startedAt },
            { role: 'assistant', content: 'Ci sono. Scriviamole e domattina le sistemiamo.', createdAt: startedAt },
          ],
        },
      },
    });

    const boot = await api('POST', '/api/chat/bootstrap', { cookie: eph.cookie });
    const bootJson = (boot.json ?? {}) as { triggered?: boolean; reason?: string };
    console.log(`[iter ${iter}] romeNow=${nowHHMMInRome()} bootstrap status=${boot.status} triggered=${bootJson.triggered} reason=${bootJson.reason}`);

    // Controprova: nessun thread morning_checkin creato.
    const morning = await db.chatThread.findFirst({ where: { userId: eph.id, mode: 'morning_checkin' } });

    const result = {
      iter, romeNow: nowHHMMInRome(),
      threadStartedAt: startedAt.toISOString(),
      bootstrapStatus: boot.status,
      triggered: bootJson.triggered,
      reason: bootJson.reason,
      morningThreadCreated: !!morning,
      generalThreadId: thread.id,
    };
    assert(boot.status === 200, `iter${iter}: bootstrap 200`);
    assert(bootJson.triggered === false, `iter${iter}: morning check-in SOPPRESSO (triggered=false)`);
    assert(bootJson.reason === 'active_thread_exists', `iter${iter}: reason=active_thread_exists (got ${bootJson.reason})`);
    assert(!morning, `iter${iter}: nessun thread morning_checkin creato`);
    return result;
  } finally {
    await deleteEphemeralUser(eph.email);
  }
}

async function main() {
  await preflightDb();
  const r1 = await runOnce(1);
  const r2 = await runOnce(2);
  saveEvidence(J, 'step6-d18-bootstrap-soppresso.json', JSON.stringify({ runs: [r1, r2] }, null, 2));
  finish('j2-60-d18');
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; });
