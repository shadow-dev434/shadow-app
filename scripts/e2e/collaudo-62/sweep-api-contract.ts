/**
 * Collaudo Task 62 — Fase 2.1: contratto di OGNI route API.
 * Per ogni route GET/POST/PATCH/DELETE: (a) 401 senza cookie (tranne le pubbliche),
 * (b) input invalido → atteso 4xx pulito, MAI 500.
 *
 * SOLO letture o scritture su un utente dedicato collaudo-sweep@probe.local.
 * NON tocca gli utenti dei journey. Idempotente.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/sweep-api-contract.ts
 */
import bcrypt from 'bcryptjs';
import { db, mintCookie, api, saveEvidence } from './lib';

const results: Array<{ route: string; check: string; status: number; verdict: string; note: string }> = [];
function rec(route: string, check: string, status: number, ok: boolean, note = '') {
  results.push({ route, check, status, verdict: ok ? 'PASS' : 'FAIL', note: note.slice(0, 200) });
}
// 500 è SEMPRE un fail di contratto (mai esporre 500 su input invalido)
function noServerError(route: string, check: string, r: { status: number; text: string }) {
  rec(route, check, r.status, r.status !== 500, r.status === 500 ? `500! body=${r.text.slice(0, 120)}` : `${r.status}`);
}

async function main() {
  const email = 'collaudo-sweep@probe.local';
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) await db.user.delete({ where: { id: existing.id } });
  const u = await db.user.create({
    data: {
      email, name: 'Collaudo Sweep', password: await bcrypt.hash('Collaudo62!pass', 12),
      profile: { create: { onboardingComplete: true, tourCompleted: true, consentGivenAt: new Date(), consentVersion: 'sweep' } },
    },
  });
  await db.settings.create({ data: { userId: u.id } });
  await db.userPattern.create({ data: { userId: u.id } });
  const task = await db.task.create({ data: { userId: u.id, title: 'sweep cavia', status: 'inbox' } });
  const cookie = await mintCookie({ userId: u.id, email });

  // ── 1. 401 senza cookie sulle route protette (GET) ──
  // Task 71: review/patterns/streaks/contacts rimosse (route inesistenti → 404, fuori dallo sweep 401)
  const protectedGets = [
    '/api/tasks', '/api/daily-plan', '/api/settings',
    '/api/adaptive-profile', '/api/profile', '/api/memory', '/api/sky',
    '/api/notifications', '/api/chat/threads', '/api/chat/bootstrap',
    '/api/chat/active-thread', '/api/chat/evening-signal', '/api/export', '/api/account',
    '/api/strict-mode', '/api/beta/feedback', '/api/beta/assessment', '/api/admin/beta/bug-reports',
    '/api/admin/beta/summary', '/api/calendar',
  ];
  for (const p of protectedGets) {
    const r = await api('GET', p);
    rec(p, 'GET senza cookie → 401', r.status, r.status === 401, r.status !== 401 ? `atteso 401, body=${r.text.slice(0, 80)}` : '');
  }

  // ── 2. Route pubbliche ──
  const health = await api('GET', '/api/health');
  rec('/api/health', 'GET pubblico → 200 ok', health.status, health.status === 200 && /ok/.test(health.text), health.text.slice(0, 60));
  const apiStub = await api('GET', '/api');
  rec('/api', 'GET stub pubblico (da rimuovere)', apiStub.status, true, `status=${apiStub.status} body=${apiStub.text.slice(0, 60)}`);

  // ── 3. Input invalidi → MAI 500 (con cookie) ──
  noServerError('/api/tasks', 'POST senza title', await api('POST', '/api/tasks', { cookie, body: {} }));
  noServerError('/api/tasks/[id]', 'PATCH status arbitrario', await api('PATCH', `/api/tasks/${task.id}`, { cookie, body: { status: 'foo_inesistente' } }));
  noServerError('/api/settings', 'PATCH orario 25:99', await api('PATCH', '/api/settings', { cookie, body: { eveningWindowStart: '25:99' } }));
  noServerError('/api/adaptive-profile', 'PATCH campo spazzatura', await api('PATCH', '/api/adaptive-profile', { cookie, body: { garbageField: 'x', cognitiveLoad: 999 } }));
  noServerError('/api/daily-plan', 'POST body vuoto', await api('POST', '/api/daily-plan', { cookie, body: {} }));
  noServerError('/api/review', 'POST body vuoto', await api('POST', '/api/review', { cookie, body: {} })); // Task 71: route rimossa → 404 (soddisfa noServerError: fallisce solo su 500)
  noServerError('/api/chat/turn', 'POST senza mode/msg', await api('POST', '/api/chat/turn', { cookie, body: {} }));
  noServerError('/api/decompose', 'POST body vuoto', await api('POST', '/api/decompose', { cookie, body: {} }));
  noServerError('/api/ai-classify', 'POST body vuoto', await api('POST', '/api/ai-classify', { cookie, body: {} }));
  noServerError('/api/micro-feedback', 'POST body vuoto', await api('POST', '/api/micro-feedback', { cookie, body: {} }));
  noServerError('/api/learning-signal', 'POST body vuoto', await api('POST', '/api/learning-signal', { cookie, body: {} }));
  noServerError('/api/contacts', 'POST body vuoto', await api('POST', '/api/contacts', { cookie, body: {} })); // Task 71: route rimossa → 404 (soddisfa noServerError: fallisce solo su 500)
  noServerError('/api/strict-mode', 'POST body vuoto', await api('POST', '/api/strict-mode', { cookie, body: {} }));
  noServerError('/api/tasks/[id]', 'PATCH id inesistente', await api('PATCH', '/api/tasks/nonexistent123', { cookie, body: { status: 'inbox' } }));
  noServerError('/api/calendar/oauth', 'GET senza env (D23)', await api('GET', '/api/calendar/oauth', { cookie }));

  // ── 4. Verifica specifica: 25:99 accettato? (D29) ──
  const settingsAfter = await api('GET', '/api/settings', { cookie });
  const sv = settingsAfter.json as { eveningWindowStart?: string } | null;
  rec('/api/settings', 'D29: 25:99 respinto (finestra NON corrotta)', settingsAfter.status,
    sv?.eveningWindowStart !== '25:99', `eveningWindowStart ora = ${sv?.eveningWindowStart}`);
  // ripristino igienico
  await api('PATCH', '/api/settings', { cookie, body: { eveningWindowStart: '20:00', eveningWindowEnd: '23:00' } });

  // ── 5. Verifica D14: POST /api/tasks senza title, che status? ──
  const noTitle = await api('POST', '/api/tasks', { cookie, body: { description: 'senza titolo' } });
  rec('/api/tasks', 'D14: POST senza title status', noTitle.status, noTitle.status !== 500, `status=${noTitle.status} (500=D14 confermato)`);

  // ── 6. PATCH status arbitrario: è finito in DB? (D14 parte 2) ──
  await api('PATCH', `/api/tasks/${task.id}`, { cookie, body: { status: 'stato_fuori_dominio' } });
  const t2 = await db.task.findUnique({ where: { id: task.id }, select: { status: true } });
  rec('/api/tasks/[id]', 'D14: PATCH status arbitrario finisce in DB?', 200,
    t2?.status !== 'stato_fuori_dominio', `status in DB = ${t2?.status} (fuori dominio = confermato)`);

  const summary = {
    tot: results.length,
    fail: results.filter((r) => r.verdict === 'FAIL').length,
    server500: results.filter((r) => r.note.includes('500!')).length,
    results,
  };
  saveEvidence('fase2-sweep', 'api-contract.json', JSON.stringify(summary, null, 2));
  console.log(`[sweep-api] tot=${summary.tot} FAIL=${summary.fail} (500 esposti=${summary.server500})`);
  for (const r of results.filter((x) => x.verdict === 'FAIL')) console.log(`  FAIL ${r.route} — ${r.check} — ${r.note}`);

  await db.user.delete({ where: { id: u.id } }).catch(() => {});
}

main().catch((e) => { console.error('[FATAL sweep-api]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
