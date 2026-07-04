/**
 * Collaudo 68 — J9 error path, parte API (spec §7 J9 + piste D41, D39 server,
 * N46 lato API, R6 parziale shape 403 senza consenso).
 *
 * SOLO report: nessuna modifica al codice app. Utenti: collaudo68-errori
 * (senza consenso/onboarding, dal seed) + collaudo68-j9-api (effimero, consentito).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j9-10-api-errors.ts
 */
import {
  preflightDb, db, mintCookie, api, postTurn, saveEvidence, dumpThread,
  cohortUser, createEphemeralUser, deleteEphemeralUser, llmSpend,
  assert, warn, finish,
} from './lib';

const EV: string[] = [];
function ev(line: string) { EV.push(line); }
function evRes(label: string, r: { status: number; text: string }) {
  ev(`## ${label}\nstatus=${r.status}\nbody=${r.text.slice(0, 600)}\n`);
}

const IT_RE = /[àèéìòù]|allegat|messaggio|consenso|troppo|formato|limite|non valid|obbligator/i;

async function main() {
  await preflightDb();

  // ═══ PASSO 1 — utente SENZA consenso né onboarding: shape dei 403 ═══
  const errori = await cohortUser('errori');
  // Guardia: il seed deve averlo lasciato senza consenso
  const prof = await db.userProfile.findUnique({ where: { userId: errori.id }, select: { consentGivenAt: true, onboardingComplete: true } });
  assert(prof?.consentGivenAt == null, 'P1.0 collaudo68-errori è senza consenso (precondizione seed)', prof);
  const cErr = await mintCookie({ userId: errori.id, email: errori.email, tourCompleted: false, onboardingComplete: false });

  const routes: Array<[string, string, unknown?]> = [
    ['POST', '/api/chat/turn', { mode: 'general', userMessage: 'ciao' }],
    ['GET', '/api/tasks'],
    ['GET', '/api/daily-plan'],
  ];
  for (const [m, p, body] of routes) {
    const r = await api(m, p, { cookie: cErr, body });
    evRes(`P1 ${m} ${p} (senza consenso)`, r);
    const j = r.json as { error?: string } | null;
    assert(r.status === 403, `P1 ${m} ${p} → 403 (got ${r.status})`, r.text.slice(0, 200));
    assert(j?.error === 'consent_required', `P1 ${m} ${p} body error=consent_required`, j);
    assert(r.headers.get('x-consent-required') === '1', `P1 ${m} ${p} header x-consent-required=1`);
  }

  // /api/consent stesso: deve restare raggiungibile senza consenso (allowWithoutConsent)
  const rc0 = await api('POST', '/api/consent', { cookie: cErr, body: { acceptTerms: true, acceptArt9: false } });
  evRes('P1 POST /api/consent acceptArt9=false', rc0);
  assert(rc0.status === 400, 'P1 /api/consent parziale → 400 (non 403: route raggiungibile senza consenso)', rc0.text.slice(0, 200));
  assert(IT_RE.test((rc0.json as { error?: string })?.error ?? ''), 'P1 /api/consent 400 messaggio in italiano', rc0.json);
  // JSON malformato su /api/consent
  const rcBad = await fetch('http://localhost:3000/api/consent', { method: 'POST', headers: { Cookie: cErr, 'Content-Type': 'application/json' }, body: '{{{not json' });
  const rcBadText = await rcBad.text();
  ev(`## P1 POST /api/consent JSON malformato\nstatus=${rcBad.status}\nbody=${rcBadText.slice(0, 300)}\n`);
  assert(rcBad.status === 400, 'P1 /api/consent JSON rotto → 400', rcBadText);
  if (!IT_RE.test(rcBadText)) warn('P1 N46: /api/consent 400 "Invalid JSON" in inglese', rcBadText.slice(0, 100));

  // /api/onboarding senza consenso
  const ro1 = await api('GET', '/api/onboarding', { cookie: cErr });
  evRes('P1 GET /api/onboarding (senza consenso)', ro1);
  assert(ro1.status === 403 || ro1.status === 200, 'P1 GET /api/onboarding → mai 500', ro1.text.slice(0, 200));
  ev(`nota: GET /api/onboarding senza consenso → ${ro1.status} ${(ro1.json as { error?: string })?.error ?? ''}`);
  const ro2 = await api('PATCH', '/api/onboarding', { cookie: cErr, body: { step: 2, answers: { q1: 'x' } } });
  evRes('P1 PATCH /api/onboarding (senza consenso)', ro2);
  assert(ro2.status === 403, 'P1 PATCH /api/onboarding senza consenso → 403 (sink guard)', ro2.text.slice(0, 200));

  // ═══ PASSO 2 — utente consentito: validazioni input /api/chat/turn ═══
  const u = await createEphemeralUser('j9-api');
  try {
    // 2a. messaggio > 4000 char
    const r2a = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'a'.repeat(4100) });
    evRes('P2a msg 4100 char', { status: r2a.status, text: JSON.stringify(r2a.json) });
    assert(r2a.status === 400, 'P2a msg >4000 → 400', r2a.json);
    assert(IT_RE.test(r2a.json.error ?? ''), 'P2a errore in italiano', r2a.json.error);

    // 2b. PDF > 4MB (base64 ~5.6MB di stringa)
    const big = 'A'.repeat(Math.ceil((4.2 * 1024 * 1024 * 4) / 3));
    const r2b = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'leggi', attachments: [{ type: 'document', mediaType: 'application/pdf', data: big }] as never });
    evRes('P2b PDF 4.2MB', { status: r2b.status, text: JSON.stringify(r2b.json).slice(0, 400) });
    assert(r2b.status === 400 || r2b.status === 413, 'P2b PDF >4MB → 4xx', r2b.status);
    assert(IT_RE.test(r2b.json.error ?? ''), 'P2b errore in italiano', r2b.json.error);

    // 2c. 5 allegati (cap = 4)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
    const five = Array.from({ length: 5 }, () => ({ kind: 'image', mediaType: 'image/png', data: tinyPng }));
    const r2c = await api('POST', '/api/chat/turn', { cookie: u.cookie, body: { mode: 'general', userMessage: 'x', attachments: five } });
    evRes('P2c 5 allegati', r2c);
    assert(r2c.status === 400, 'P2c 5 allegati → 400 (il 5° rifiutato, tutto il messaggio)', r2c.text.slice(0, 200));
    assert(IT_RE.test((r2c.json as { error?: string })?.error ?? ''), 'P2c errore in italiano', r2c.json);

    // 2d. .docx → rifiuto esplicito o scarto silenzioso? (D41 lato API)
    const r2d = await api('POST', '/api/chat/turn', { cookie: u.cookie, body: { mode: 'general', userMessage: 'x', attachments: [{ kind: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: tinyPng }] } });
    evRes('P2d .docx', r2d);
    assert(r2d.status === 400, 'P2d .docx → 400 esplicito lato API (D41: il silenzio è solo in UI)', r2d.text.slice(0, 200));
    assert(IT_RE.test((r2d.json as { error?: string })?.error ?? ''), 'P2d errore in italiano', r2d.json);

    // ═══ PASSO 5 — attachments malformati: MAI 500 ═══
    const malformed: Array<[string, unknown]> = [
      ['attachments non-array', 'x'],
      ['item non-oggetto', [42]],
      ['data vuota', [{ kind: 'image', mediaType: 'image/png', data: '' }]],
      ['data non-string', [{ kind: 'image', mediaType: 'image/png', data: 123 }]],
      ['kind sconosciuto', [{ kind: 'audio', mediaType: 'audio/mp3', data: tinyPng }]],
      ['mediaType finto', [{ kind: 'image', mediaType: 'image/bmp', data: tinyPng }]],
    ];
    for (const [label, att] of malformed) {
      const r = await api('POST', '/api/chat/turn', { cookie: u.cookie, body: { mode: 'general', userMessage: 'x', attachments: att } });
      evRes(`P5 ${label}`, r);
      assert(r.status === 400, `P5 ${label} → 400, mai 500 (got ${r.status})`, r.text.slice(0, 150));
    }
    // base64 corrotto MA mediaType valido: passa la validazione? (nessun check base64 in route)
    // → repro x2 (potenziale 500 dall'API Anthropic)
    for (let i = 1; i <= 2; i++) {
      const r = await api('POST', '/api/chat/turn', { cookie: u.cookie, body: { mode: 'general', userMessage: 'descrivi questa immagine', attachments: [{ kind: 'image', mediaType: 'image/png', data: '%%%non-base64-###!!!' }] } });
      evRes(`P5 base64 corrotto (run ${i})`, r);
      assert(r.status < 500, `P5 base64 corrotto run ${i} → mai 500 (got ${r.status})`, r.text.slice(0, 200));
    }
    // JSON body malformato su /api/chat/turn
    const rjBad = await fetch('http://localhost:3000/api/chat/turn', { method: 'POST', headers: { Cookie: u.cookie, 'Content-Type': 'application/json' }, body: 'non-json{{{' });
    const rjText = await rjBad.text();
    ev(`## P5 /api/chat/turn JSON malformato\nstatus=${rjBad.status}\nbody=${rjText.slice(0, 300)}\n`);
    assert(rjBad.status < 500, `P5 /api/chat/turn body non-JSON → 4xx atteso (got ${rjBad.status})`, rjText.slice(0, 150));

    // ═══ PASSO 3 — doppio submit identico in parallelo ═══
    const first = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'Ciao, oggi devo comprare il latte.' });
    assert(first.status === 200, 'P3.0 primo turno ok', first.json);
    const threadId = first.json.threadId!;
    const dupMsg = 'Aggiungi alla lista: chiamare il dentista per fissare la visita';
    const [d1, d2] = await Promise.all([
      postTurn({ cookie: u.cookie, mode: 'general', userMessage: dupMsg, threadId }),
      postTurn({ cookie: u.cookie, mode: 'general', userMessage: dupMsg, threadId }),
    ]);
    evRes('P3 doppio submit A', { status: d1.status, text: JSON.stringify(d1.json).slice(0, 500) });
    evRes('P3 doppio submit B', { status: d2.status, text: JSON.stringify(d2.json).slice(0, 500) });
    assert(d1.status < 500 && d2.status < 500, `P3 nessun 500 nella race (${d1.status}/${d2.status})`);
    const userMsgs = await db.chatMessage.count({ where: { threadId, role: 'user', content: dupMsg } });
    const dentistTasks = await db.task.findMany({ where: { userId: u.id, title: { contains: 'dentista', mode: 'insensitive' } }, select: { id: true, title: true, status: true } });
    ev(`## P3 esito DB\nmessaggi utente duplicati nel thread=${userMsgs}\ntask "dentista"=${JSON.stringify(dentistTasks)}\n`);
    assert(userMsgs === 2, `P3 entrambi i messaggi scritti (=${userMsgs}) — la race NON deduplica lato server`, userMsgs);
    if (dentistTasks.length > 1) {
      warn(`P3 DOPPIO TASK dalla race: ${dentistTasks.length} task "dentista" creati`, dentistTasks);
    } else {
      ev(`P3 dedup task: ${dentistTasks.length} task creato/i`);
    }
    await dumpThread(threadId, 'J9', 'j9-doppio-submit-thread');

    // ═══ PASSO 4 — threadId inesistente / altrui ═══
    const rInv = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'turno su thread inesistente', threadId: 'thread-che-non-esiste-123' });
    evRes('P4 threadId inesistente', { status: rInv.status, text: JSON.stringify(rInv.json).slice(0, 500) });
    // Comportamento a codice (orchestrator.ts:199-259): not-found → CREA un thread nuovo, niente 404
    assert(rInv.status < 500, `P4 threadId inesistente → mai 500 (got ${rInv.status})`);
    if (rInv.status === 200) {
      const newTid = rInv.json.threadId;
      assert(!!newTid && newTid !== 'thread-che-non-esiste-123', 'P4 risposta con thread NUOVO (fork silenzioso, non 404)', newTid);
      warn('P4 design: threadId invalido NON dà 404/403 — l\'API forka un thread nuovo in silenzio e spende comunque un turno LLM', { sent: 'thread-che-non-esiste-123', got: newTid });
      if (newTid) await dumpThread(newTid, 'J9', 'j9-thread-forkato-da-id-invalido');
    }

    // threadId ALTRUI: il thread del primo utente (errori non ha thread → creo un victim effimero)
    const victim = await createEphemeralUser('j9-victim');
    try {
      const vTurn = await postTurn({ cookie: victim.cookie, mode: 'general', userMessage: 'thread della vittima, contenuto privato' });
      const victimThread = vTurn.json.threadId!;
      const before = await db.chatMessage.count({ where: { threadId: victimThread } });
      const rFor = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'provo a scrivere nel thread altrui', threadId: victimThread });
      evRes('P4 threadId altrui', { status: rFor.status, text: JSON.stringify(rFor.json).slice(0, 500) });
      const after = await db.chatMessage.count({ where: { threadId: victimThread } });
      assert(after === before, `P4 thread altrui: NESSUN messaggio scritto nel thread della vittima (${before}→${after})`);
      assert(rFor.status < 500, `P4 thread altrui → mai 500 (got ${rFor.status})`);
      if (rFor.status === 200) {
        assert(rFor.json.threadId !== victimThread, 'P4 thread altrui: risposta su thread NUOVO del chiamante (no leak)', rFor.json.threadId);
        // leak check: la risposta non contiene il contenuto della vittima
        assert(!(rFor.json.assistantMessage ?? '').includes('contenuto privato'), 'P4 nessun leak di contenuto della vittima nella risposta');
      }
      await dumpThread(victimThread, 'J9', 'j9-victim-thread');
    } finally {
      await deleteEphemeralUser(victim.email);
    }

    // ═══ PASSO 6 — D39 lato server: il messaggio del turno è in DB? ═══
    // (a) su 400 di validazione: NIENTE scritto (validazione prima di orchestrate)
    const msgs400 = await db.chatMessage.count({ where: { thread: { userId: u.id }, content: { startsWith: 'aaaaaaaaaa' } } });
    assert(msgs400 === 0, 'P6a msg respinto con 400 NON è in DB (perso lato server, resta solo nel client)', msgs400);
    // (b) su turno accettato: il messaggio utente è persistito PRIMA della chiamata LLM
    //     (orchestrator.ts:503) → su un 500 a metà turno resterebbe recuperabile dal thread.
    const invMsg = await db.chatMessage.findFirst({ where: { thread: { userId: u.id }, content: 'turno su thread inesistente' }, select: { threadId: true } });
    assert(invMsg != null, 'P6b messaggio del turno con threadId invalido PERSISTITO nel thread forkato (recuperabile)', invMsg);
    ev('## P6 D39 lato server\n400 di validazione: messaggio MAI scritto in DB.\nTurno accettato: user message scritto PRIMA della callLLM (orchestrator.ts:503) → un 500 a metà turno lo lascia in DB, recuperabile dallo storico thread.\n');

    const spend = await llmSpend(u.id);
    ev(`\n## Spesa LLM collaudo68-j9-api: $${spend.toFixed(4)}`);
    console.log(`[spend j9-api] $${spend.toFixed(4)}`);
  } finally {
    // NON cancello j9-api: le evidenze DB (thread fork, task dentista) devono restare ispezionabili
    saveEvidence('J9', 'j9-10-api-errors.md', `# J9 — error path API (${new Date().toISOString()})\n\n${EV.join('\n')}`);
  }

  finish('j9-10-api-errors');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
