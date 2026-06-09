/**
 * S1 — verifica DETERMINISTICA della spina di raggiungibilita' (pre-reg §S1).
 * Route-level: seed con-residuo -> GET /api/chat/active-thread -> assert su
 * stato DB (archive) + risposta (activeThread/shouldStart). NESSUN modello.
 *
 * RICHIEDE il dev server su BASE_URL (route GET). NON fa chiamate LLM.
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-8c-s1.ts [userId]
 *
 * Scenari (clientTime esplicito = deterministico, non dal clock reale):
 *  - main (21:00, finestra 00:00-23:59): tutti i non-terminali -> archived;
 *    activeThread:null + shouldStart:true.
 *  - out-of-window (10:00, finestra 20:00-23:00): NESSUN archive; activeThread presente.
 *  - gap-lt-3 (21:00, residuo 1gg): NESSUN archive; activeThread presente.
 *  - most-recent-evening (21:00, evening active recente): gestito da normalize
 *    (spina NON scatta); evening resta active, activeThread.mode='evening_review'.
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { mintSessionCookie, wakePreflight } from './run-walk';
import { seedS1, type S1Scenario, type S1SeededThread } from '../seed-8c-s1';

const USER_ID = process.argv[2] ?? 'cmp1flw1g005oibvckzsenuqm';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

interface ActiveThreadResponse {
  activeThread: { threadId: string; mode: string } | null;
  eveningReview: { shouldStart: boolean };
}

async function getActiveThread(cookie: string, clientTime: string, clientDate: string): Promise<ActiveThreadResponse> {
  const url = `${BASE_URL}/api/chat/active-thread?clientTime=${encodeURIComponent(clientTime)}&clientDate=${encodeURIComponent(clientDate)}`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET active-thread -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ActiveThreadResponse;
}

async function statesOf(ids: string[]): Promise<Record<string, string>> {
  const rows = await db.chatThread.findMany({ where: { id: { in: ids } }, select: { id: true, state: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.state]));
}

type Check = {
  scenario: S1Scenario;
  clientTime: string;
  assert: (resp: ActiveThreadResponse, after: Record<string, string>, seeded: S1SeededThread[]) => { ok: boolean; detail: string };
};

const CHECKS: Check[] = [
  {
    scenario: 'main',
    clientTime: '21:00',
    assert: (resp, after, seeded) => {
      const allArchived = seeded.every((t) => after[t.id] === 'archived');
      const routed = resp.activeThread === null && resp.eveningReview.shouldStart === true;
      return {
        ok: allArchived && routed,
        detail: `archived=${seeded.map((t) => `${t.mode}/${t.state}->${after[t.id]}`).join(',')} | activeThread=${resp.activeThread ? resp.activeThread.mode : 'null'} shouldStart=${resp.eveningReview.shouldStart} (atteso: tutti archived, null, true)`,
      };
    },
  },
  {
    scenario: 'out-of-window',
    clientTime: '10:00',
    assert: (resp, after, seeded) => {
      const noneArchived = seeded.every((t) => after[t.id] !== 'archived');
      const rehydrated = resp.activeThread !== null;
      return {
        ok: noneArchived && rehydrated,
        detail: `states=${seeded.map((t) => `${t.mode}->${after[t.id]}`).join(',')} | activeThread=${resp.activeThread ? resp.activeThread.mode : 'null'} (atteso: NESSUN archive, activeThread presente)`,
      };
    },
  },
  {
    scenario: 'gap-lt-3',
    clientTime: '21:00',
    assert: (resp, after, seeded) => {
      const noneArchived = seeded.every((t) => after[t.id] !== 'archived');
      const rehydrated = resp.activeThread !== null;
      return {
        ok: noneArchived && rehydrated,
        detail: `states=${seeded.map((t) => `${t.mode}->${after[t.id]}`).join(',')} | activeThread=${resp.activeThread ? resp.activeThread.mode : 'null'} (atteso: NESSUN archive, activeThread presente)`,
      };
    },
  },
  {
    scenario: 'most-recent-evening',
    clientTime: '21:00',
    assert: (resp, after, seeded) => {
      const evening = seeded.find((t) => t.mode === 'evening_review')!;
      const eveningStillActive = after[evening.id] === 'active';
      const rehydratedEvening = resp.activeThread?.mode === 'evening_review';
      return {
        ok: eveningStillActive && rehydratedEvening,
        detail: `states=${seeded.map((t) => `${t.mode}->${after[t.id]}`).join(',')} | activeThread=${resp.activeThread ? resp.activeThread.mode : 'null'} (atteso: evening active, activeThread=evening_review; spina NON scatta)`,
      };
    },
  },
];

async function main(): Promise<void> {
  const user = await db.user.findUnique({ where: { id: USER_ID }, select: { email: true, name: true } });
  if (!user?.email) {
    console.error(`[FATAL] User ${USER_ID} non trovato o senza email.`);
    process.exitCode = 1;
    return;
  }
  await wakePreflight();
  const cookie = await mintSessionCookie({ userId: USER_ID, email: user.email, name: user.name ?? 'alberto' });
  const clientDate = formatTodayInRome();
  console.log(`[s1] target=${user.email} BASE_URL=${BASE_URL} clientDate=${clientDate}`);
  console.log('[s1] === S1 spina raggiungibilita\' (route-level, no modello) ===');

  let allOk = true;
  for (const c of CHECKS) {
    const { threads } = await seedS1(USER_ID, c.scenario);
    const resp = await getActiveThread(cookie, c.clientTime, clientDate);
    const after = await statesOf(threads.map((t) => t.id));
    const { ok, detail } = c.assert(resp, after, threads);
    if (!ok) allOk = false;
    console.log(`[s1] ${c.scenario} (clientTime=${c.clientTime}) -> ${ok ? 'OK' : 'MISMATCH'}\n     ${detail}`);
  }

  console.log(allOk ? '[s1] VERDE: tutti gli scenari della spina combaciano.' : '[s1] FALLITO: uno scenario non combacia.');
  process.exitCode = allOk ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] probe-8c-s1 failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
