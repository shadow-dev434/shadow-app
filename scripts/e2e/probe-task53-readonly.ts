/**
 * Probe e2e Task 53 (SOLO LETTURA) — verifica runtime dei nuovi endpoint
 * storici contro il DB reale, senza alcuna scrittura (sicuro su qualunque DB).
 *
 * Auto-scopre un thread con messaggi, conia un cookie next-auth per il suo
 * utente, poi via HTTP:
 *   - GET /api/chat/threads            -> 200, lista con label/mode/messageCount
 *   - GET /api/chat/threads/[id]       -> 200, { thread, messages }
 *   - GET /api/chat/threads/[bogus]    -> 404 (ownership / not found)
 *   - GET /api/chat/threads (no cookie)-> 401
 *
 * La logica di rollover/archive (scrittura) e' coperta dai test unitari
 * (turn/route.test.ts + active-thread/route.test.ts), non da questa probe.
 *
 * Uso (dal worktree, .env.local auto-caricato da bun):
 *   bun run scripts/e2e/probe-task53-readonly.ts http://localhost:3153
 */
import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';

const BASE = process.argv[2] ?? 'http://localhost:3153';
const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error('NEXTAUTH_SECRET assente: lanciare dal worktree con .env.local');
  process.exit(1);
}

const results: string[] = [];
let pass = true;
const ok = (n: string, c: boolean, d = '') => {
  results.push(`${c ? 'PASS' : 'FAIL'} — ${n}${d ? ` :: ${d}` : ''}`);
  if (!c) pass = false;
};

// Thread reale (read-only) con almeno un messaggio user/assistant.
const thread = await db.chatThread.findFirst({
  where: { messages: { some: { role: { in: ['user', 'assistant'] } } } },
  orderBy: { startedAt: 'desc' },
  select: { id: true, userId: true, state: true },
});

if (!thread) {
  console.log('NO_THREAD_DATA — il DB non ha thread con messaggi, salto la probe HTTP.');
  process.exit(0);
}

const token = await encode({
  token: { id: thread.userId, sub: thread.userId, tourCompleted: true, onboardingComplete: true },
  secret,
  maxAge: 3600,
});
const h = { Cookie: `next-auth.session-token=${token}` };

// GET /api/chat/threads
const tl = await fetch(`${BASE}/api/chat/threads`, { headers: h });
const tlj = await tl.json();
ok('GET /threads -> 200', tl.status === 200, `status=${tl.status}`);
ok('threads e\' un array', Array.isArray(tlj.threads), typeof tlj.threads);
const mine = (tlj.threads ?? []).find((x: { id: string }) => x.id === thread.id);
ok('il thread di test compare in lista', !!mine, `id=${thread.id}`);
ok(
  'voce con label+mode+state+messageCount',
  !!mine &&
    typeof mine.label === 'string' &&
    typeof mine.mode === 'string' &&
    typeof mine.state === 'string' &&
    typeof mine.messageCount === 'number' &&
    mine.messageCount > 0,
  JSON.stringify(mine),
);

// GET /api/chat/threads/[id]
const td = await fetch(`${BASE}/api/chat/threads/${thread.id}`, { headers: h });
const tdj = await td.json();
ok('GET /threads/[id] -> 200', td.status === 200, `status=${td.status}`);
ok(
  'ritorna { thread, messages[] }',
  !!tdj.thread && Array.isArray(tdj.messages),
  JSON.stringify({ thread: !!tdj.thread, msgs: tdj.messages?.length }),
);
ok('thread.id corrisponde', tdj.thread?.id === thread.id);
ok('thread.label e\' una stringa', typeof tdj.thread?.label === 'string', tdj.thread?.label);
ok(
  'messaggi in ordine crescente per createdAt',
  Array.isArray(tdj.messages) &&
    tdj.messages.every(
      (m: { createdAt: string }, i: number) =>
        i === 0 || new Date(tdj.messages[i - 1].createdAt) <= new Date(m.createdAt),
    ),
);

// GET /api/chat/threads/[bogus] -> 404
const bogus = await fetch(`${BASE}/api/chat/threads/zzz-nonexistent-id`, { headers: h });
ok('GET /threads/[bogus] -> 404', bogus.status === 404, `status=${bogus.status}`);

// GET /api/chat/threads senza cookie -> 401
const noauth = await fetch(`${BASE}/api/chat/threads`);
ok('GET /threads senza cookie -> 401', noauth.status === 401, `status=${noauth.status}`);

console.log('\n=== PROBE TASK 53 (read-only) ===');
results.forEach((r) => console.log(r));
console.log(`\nRESULT: ${pass ? 'ALL PASS ✅' : 'SOME FAIL ❌'}`);
process.exit(pass ? 0 : 1);
