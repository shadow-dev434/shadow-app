/**
 * Task 65 (E1/J4) — piano di rientro nel morning check-in, via
 * POST /api/chat/bootstrap con LLM REALE (tier fast): costa centesimi.
 * Setup: assenza simulata (thread vecchio con lastTurnAt -5gg) + 3 task
 * scaduti. HARD assert solo sulla struttura (triggered, quickReplies,
 * etica niente-conteggio-giorni); il contenuto della proposta e' WARN
 * (LLM non deterministico) con dump per verifica manuale.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-rientro-bootstrap.ts
 * Richiede dev server su :3000 + DB royal-feather + ANTHROPIC_API_KEY.
 */
import { preflightDb, api, assert, warn, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';

await preflightDb();
const hour = Number(new Intl.DateTimeFormat('it-IT', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()));
if (hour < 5) {
  console.log('[skip] prima delle 5 Europe/Rome il morning check-in non scatta (soglia bootstrap)');
  process.exit(0);
}

const user = await createEphemeralUser('rientro');

interface TurnJson {
  triggered?: boolean;
  threadId?: string;
  assistantMessage?: string;
  quickReplies?: { label: string }[];
}

try {
  // Assenza: ultimo contatto 5 giorni fa (thread completato, non-active per
  // non far scattare il guard C2 del bootstrap).
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  await db.chatThread.create({
    data: { userId: user.id, mode: 'general', state: 'completed', startedAt: fiveDaysAgo, lastTurnAt: fiveDaysAgo },
  });

  // 3 task scaduti (deadline 2 giorni fa), priorita' decrescente.
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (const [i, title] of ['T65 bollette arretrate', 'T65 mail commercialista', 'T65 ricetta medica'].entries()) {
    await db.task.create({
      data: { userId: user.id, title, status: 'planned', deadline: twoDaysAgo, priorityScore: 90 - i * 10, urgency: 5, importance: 4 },
    });
  }

  // Turno 1: bootstrap -> saluto di rientro + domanda umore con QR.
  const boot = await api('POST', '/api/chat/bootstrap', { cookie: user.cookie, body: {} });
  assert(boot.status === 200, 'bootstrap: 200', boot.status);
  const t1 = boot.json as TurnJson;
  assert(t1.triggered === true, 'bootstrap: morning check-in triggered', t1);
  assert(typeof t1.assistantMessage === 'string' && t1.assistantMessage.length > 0, 'turno 1: messaggio presente');
  assert((t1.quickReplies?.length ?? 0) > 0, 'turno 1: quick replies presenti (scala umore)', t1.quickReplies);
  // Etica 8c: MAI recitare il numero di giorni d'assenza.
  assert(!/\b\d+\s*giorn/i.test(t1.assistantMessage ?? ''), 'turno 1: nessun conteggio giorni', t1.assistantMessage);
  console.log('\n[turno 1]', t1.assistantMessage, '\nQR:', JSON.stringify(t1.quickReplies));

  // Turno 2: umore 4 -> attesa proposta rientro con QR "Si', parti da questi".
  const turn2 = await api('POST', '/api/chat/turn', {
    cookie: user.cookie,
    body: { threadId: t1.threadId, mode: 'morning_checkin', userMessage: '4' },
  });
  assert(turn2.status === 200, 'turno 2: 200', turn2.status);
  const t2 = turn2.json as TurnJson;
  assert(typeof t2.assistantMessage === 'string' && t2.assistantMessage.length > 0, 'turno 2: messaggio presente');
  console.log('\n[turno 2]', t2.assistantMessage, '\nQR:', JSON.stringify(t2.quickReplies));

  const qrText = JSON.stringify(t2.quickReplies ?? []).toLowerCase();
  const proposesRientro = /parti da questi/.test(qrText) || /scelgo io/.test(qrText);
  if (proposesRientro) {
    assert(true, 'turno 2: proposta di rientro con QR di conferma unica');
    const namesOverdue = /(bollette|commercialista|ricetta)/i.test(t2.assistantMessage ?? '');
    if (namesOverdue) assert(true, 'turno 2: la proposta nomina i task scaduti');
    else warn('turno 2: QR di rientro presente ma nessun task scaduto nominato nel testo');
  } else {
    // LLM reale: degradazione a WARN col dump sopra per verifica manuale.
    warn('turno 2: QR "Si\', parti da questi / No, scelgo io" non trovata — verificare il dump', t2.quickReplies);
  }
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task65-rientro-bootstrap');
