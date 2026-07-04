/**
 * Collaudo 68 — J9 repro dedicato dei due 500 trovati da j9-10-api-errors.ts:
 *  (A) allegato con mediaType valido ma base64 corrotto → 500 "Errore interno"
 *  (B) body non-JSON su POST /api/chat/turn → 500 invece di 400
 * + verifica D39: dopo il 500 (A), il messaggio utente è in DB?
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j9-20-repro-500.ts
 */
import { preflightDb, db, api, createEphemeralUser, deleteEphemeralUser, saveEvidence, assert, warn, finish, BASE_URL } from './lib';

const EV: string[] = [];

async function main() {
  await preflightDb();
  const u = await createEphemeralUser('j9-repro500');
  try {
    // (A) base64 corrotto — repro n. 3 e 4 (dopo i 2 del j9-10)
    const marker = `messaggio-repro500-${Date.now()}`;
    for (let i = 1; i <= 2; i++) {
      const r = await api('POST', '/api/chat/turn', {
        cookie: u.cookie,
        body: { mode: 'general', userMessage: `${marker}-run${i}`, attachments: [{ kind: 'image', mediaType: 'image/png', data: '%%%non-base64###' }] },
      });
      EV.push(`## A run ${i}: base64 corrotto\nstatus=${r.status}\nbody=${r.text.slice(0, 300)}\n`);
      assert(r.status === 500, `A run ${i}: riprodotto 500 (got ${r.status})`, r.text.slice(0, 150));
    }
    // D39: il messaggio del turno fallito è in DB? (atteso Sì: persistito pre-LLM)
    const persisted = await db.chatMessage.findMany({
      where: { thread: { userId: u.id }, content: { contains: marker } },
      select: { threadId: true, content: true },
    });
    EV.push(`## D39 dopo il 500\nmessaggi persistiti=${JSON.stringify(persisted, null, 1)}\n`);
    assert(persisted.length === 2, `D39: i 2 messaggi dei turni falliti SONO in DB (=${persisted.length}) → recuperabili dallo storico`, persisted);
    // ...ma il thread creato dal turno fallito resta 'active' senza risposta assistant?
    if (persisted[0]) {
      const t = await db.chatThread.findUnique({ where: { id: persisted[0].threadId }, select: { state: true, mode: true } });
      const aCount = await db.chatMessage.count({ where: { threadId: persisted[0].threadId, role: 'assistant' } });
      EV.push(`thread del turno fallito: state=${t?.state} assistant_msgs=${aCount}\n`);
      if (aCount === 0) warn(`D39-bis: il 500 lascia un thread ${t?.state} con messaggio utente SENZA risposta (orfano visibile allo storico?)`);
    }

    // (B) body non-JSON — repro n. 2 e 3
    for (let i = 1; i <= 2; i++) {
      const r = await fetch(`${BASE_URL}/api/chat/turn`, { method: 'POST', headers: { Cookie: u.cookie, 'Content-Type': 'application/json' }, body: 'garbage{{{' });
      const text = await r.text();
      EV.push(`## B run ${i}: body non-JSON\nstatus=${r.status}\nbody=${text.slice(0, 300)}\n`);
      assert(r.status === 500, `B run ${i}: riprodotto 500 su body non-JSON (got ${r.status})`, text.slice(0, 150));
    }
    // Confronto: /api/consent gestisce lo stesso caso con 400 (route.ts:28-32) → pattern disponibile
    EV.push('Nota: POST /api/consent con body non-JSON risponde 400 "Invalid JSON" (try/catch dedicato) — /api/chat/turn no: req.json() lancia dentro il try esterno → 500 generico + captureApiError.');
  } finally {
    await deleteEphemeralUser(u.email).catch(() => {});
    saveEvidence('J9', 'j9-20-repro-500.md', `# J9 — repro 500 (${new Date().toISOString()})\n\n${EV.join('\n')}`);
  }
  finish('j9-20-repro-500');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
