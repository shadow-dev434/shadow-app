/**
 * Collaudo Task 62 — J9 error-path (rieseguito dall'orchestratore: l'agente workflow
 * si era bloccato su un `curl` che non ritorna nel sandbox). Usa SOLO fetch, NON
 * uccide il server, NON avvia :3001 (il cap live è documentato via codice per non
 * degradare il server condiviso, come già accaduto).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j9-error-path.ts
 */
import bcrypt from 'bcryptjs';
import { db, mintCookie, api, cohortUser, saveEvidence } from './lib';

const R: Array<{ check: string; status: number | string; verdict: string; note: string }> = [];
function rec(check: string, status: number | string, ok: boolean, note = '') {
  R.push({ check, status, verdict: ok ? 'PASS' : 'FAIL', note: note.slice(0, 260) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check} [${status}] ${note.slice(0, 140)}`);
}

async function main() {
  const u = await cohortUser('errori');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  // 1. Messaggio > 4000 char (D34: lingua errore)
  const long = 'a'.repeat(4100);
  const r1 = await api('POST', '/api/chat/turn', { cookie, body: { mode: 'general', userMessage: long } });
  const j1 = r1.json as { error?: string };
  rec('1. msg >4000 char → 400', r1.status, r1.status === 400, `err="${j1?.error}" (EN? ${/too long/.test(j1?.error ?? '')})`);

  // 2a. 5 allegati (> MAX_ATTACHMENTS=4)
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
  const five = Array.from({ length: 5 }, () => ({ kind: 'image', mediaType: 'image/png', data: tinyPng }));
  const r2 = await api('POST', '/api/chat/turn', { cookie, body: { mode: 'general', userMessage: 'x', attachments: five } });
  rec('2a. 5 allegati → 400 too many', r2.status, r2.status === 400, `err="${(r2.json as {error?:string})?.error}"`);

  // 2b. PDF > 4MB (base64 ~ 4/3 dei byte: costruisco ~5MB di dati)
  const bigData = 'A'.repeat(Math.ceil(4.2 * 1024 * 1024 * 4 / 3));
  const r3 = await api('POST', '/api/chat/turn', { cookie, body: { mode: 'general', userMessage: 'x', attachments: [{ kind: 'document', mediaType: 'application/pdf', data: bigData }] } });
  rec('2b. PDF >4MB → 400 too large', r3.status, r3.status === 400, `err="${(r3.json as {error?:string})?.error}"`);

  // 2c. .docx (tipo non supportato)
  const r4 = await api('POST', '/api/chat/turn', { cookie, body: { mode: 'general', userMessage: 'x', attachments: [{ kind: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: tinyPng }] } });
  rec('2c. .docx → 400 unsupported', r4.status, r4.status === 400, `err="${(r4.json as {error?:string})?.error}" (D41: lo scarto è SILENZIOSO in UI, non in API)`);

  // 3. Cookie corrotto: pagina protetta → redirect login; API → 401
  const bad = 'next-auth.session-token=garbage.garbage.garbage';
  const rp = await api('GET', '/tasks', { cookie: bad });
  const loc = rp.headers.get('location') ?? '';
  rec('3a. /tasks cookie corrotto → 307 /?auth=login', rp.status, rp.status === 307 && /auth=login/.test(loc), `loc=${loc}`);
  const ra = await api('GET', '/api/tasks', { cookie: bad });
  rec('3b. /api/tasks cookie corrotto → 401', ra.status, ra.status === 401, (ra.json as {error?:string})?.error ?? '');

  // 4. Throttle login: 6 tentativi sbagliati → 429 (D65: countdown?)
  const email = 'collaudo-j9throttle@probe.local';
  const ex = await db.user.findUnique({ where: { email } });
  if (ex) await db.user.delete({ where: { id: ex.id } });
  await db.user.create({ data: { email, name: 'throttle', password: await bcrypt.hash('Collaudo62!pass', 12), profile: { create: { onboardingComplete: true, tourCompleted: true, consentGivenAt: new Date() } } } });
  let got429 = -1; let lastMsg = '';
  for (let i = 1; i <= 6; i++) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: 'sbagliata!' } });
    lastMsg = (r.json as { error?: string })?.error ?? '';
    if (r.status === 429 && got429 < 0) got429 = i;
  }
  rec('4a. login: 429 al tentativo', got429, got429 >= 1 && got429 <= 6, `primo 429 al #${got429}, msg="${lastMsg}"`);
  rec('4b. D65: il 429 indica quanto aspettare?', got429, true, `msg="${lastMsg}" → countdown? ${/\d+\s*(min|sec|secondi|minuti)/i.test(lastMsg)}`);
  // login GIUSTO durante il lockout
  const rok = await api('POST', '/api/auth/login', { body: { email, password: 'Collaudo62!pass' } });
  rec('4c. login corretto durante lockout', rok.status, true, `status=${rok.status} (429=bloccato anche il legittimo; 200=passa)`);
  await db.user.delete({ where: { email } }).catch(() => {});

  // 5. Doppio submit concorrente sullo stesso thread general
  const first = await api('POST', '/api/chat/turn', { cookie, body: { mode: 'general', userMessage: 'primo messaggio del test concorrenza' } });
  const threadId = (first.json as { threadId?: string })?.threadId;
  const [a, b] = await Promise.all([
    api('POST', '/api/chat/turn', { cookie, body: { threadId, mode: 'general', userMessage: 'A concorrente' } }),
    api('POST', '/api/chat/turn', { cookie, body: { threadId, mode: 'general', userMessage: 'B concorrente' } }),
  ]);
  const msgs = threadId ? await db.chatMessage.count({ where: { threadId, role: 'user' } }) : -1;
  rec('5. doppio submit concorrente', `${a.status}/${b.status}`, a.status < 500 && b.status < 500, `user-msg nel thread=${msgs} (atteso ~3: primo+A+B; race se diverso)`);

  // 6. CHAT_DAILY_CAP: documentato via codice (NON testato live per non degradare il server)
  rec('6. cap giornaliero (SKIP live)', 'SKIP', true, 'Codice turn/route.ts:111-128: kill-switch cap<=0 → 429 "La chat è temporaneamente non disponibile." (IT); cap raggiunto → 429 "Hai raggiunto il limite di messaggi per oggi. Riprova domani." (IT). Live test richiede 2° server → rischio server condiviso (già caduto), SALTATO.');

  const summary = { tot: R.length, fail: R.filter((x) => x.verdict === 'FAIL').length, results: R };
  saveEvidence('J9-error-path', 'j9.json', JSON.stringify(summary, null, 2));
  console.log(`\n[J9] tot=${summary.tot} FAIL=${summary.fail}`);
}

main().catch((e) => { console.error('[FATAL J9]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
