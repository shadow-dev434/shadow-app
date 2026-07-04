/**
 * Collaudo 68 — J10 parte 2: GDPR con utente effimero (spec J10.5).
 * Adattato da collaudo-62/j10gdpr-lifecycle.ts.
 *
 * Piste: N23 (export JSON/CSV: include pushDevices/calendarTokens-metadati?
 * esclude password/adminNotes/token? AppConfig = tabella GLOBALE non user-scoped
 * → correttamente assente), R6 (revoca consenso → 403 consent_required su ≥6
 * route; delete → cascade + vecchia sessione 401 session_invalid).
 * Nota "ELIMINA": la conferma è SOLO client-side (già noto dal 62) — qui si
 * documenta di nuovo che DELETE /api/account non richiede alcun body.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j10-20-gdpr-lifecycle.ts
 */
import {
  preflightDb, createEphemeralUser, deleteEphemeralUser, api, postTurn,
  saveEvidence, llmSpend, assert, warn, finish, db, BASE_URL,
} from './lib';

const J = 'J10';
const out: string[] = [];
function log(line: string): void { out.push(line); console.log(line); }

/** Tutti i path di chiave del JSON (array → []) per lo scan delle esclusioni. */
function collectKeyPaths(v: unknown, prefix: string, acc: Set<string>): void {
  if (Array.isArray(v)) {
    for (const item of v.slice(0, 5)) collectKeyPaths(item, `${prefix}[]`, acc);
    return;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      collectKeyPaths(val, p, acc);
    }
  }
}

async function main(): Promise<void> {
  await preflightDb();
  log(`# J10 parte 2 — GDPR utente effimero (${new Date().toISOString()}) BASE_URL=${BASE_URL}`);

  const u = await createEphemeralUser('j10-gdpr');
  log(`utente effimero: ${u.email} id=${u.id}`);

  // Dati per dare sostanza all'export (task, thread, notifica, segnale, ricorrente).
  const t1 = await db.task.create({ data: { userId: u.id, title: 'Pagare la bolletta (seed j10-gdpr)', status: 'planned', importance: 4, urgency: 4 } });
  await db.task.create({ data: { userId: u.id, title: 'Chiamare il medico, con "virgolette", e a capo\nseconda riga (test CSV)', status: 'inbox', importance: 3, urgency: 2 } });
  const thread = await db.chatThread.create({
    data: {
      userId: u.id, mode: 'general', state: 'active',
      messages: { create: [
        { role: 'user', content: 'Ciao Shadow, oggi mi sento giù e devo pagare la bolletta' },
        { role: 'assistant', content: 'Segnata. Partiamo da lì con calma.' },
      ] },
    },
  });
  await db.notification.create({ data: { userId: u.id, type: 'test_seed', title: 'Seed', body: 'notifica seed j10-gdpr' } });
  await db.learningSignal.create({ data: { userId: u.id, signalType: 'task_completed', taskId: t1.id } });
  await db.recurringTask.create({ data: { userId: u.id, title: 'Palestra (seed export)', frequency: 'weekly', weekdays: '[1]', startDate: '2026-06-01', active: true } });
  // Righe per le collezioni "sensibili" della pista N23: PushDevice e CalendarToken
  // con valori segreti riconoscibili → NON devono comparire nell'export.
  await db.pushDevice.create({ data: { userId: u.id, platform: 'android', token: 'SEGRETO-FCM-TOKEN-COLLAUDO68', locale: 'it', appVersion: 'collaudo-68' } });
  await db.calendarToken.create({ data: { userId: u.id, provider: 'google', accessToken: 'SEGRETO-ACCESS-COLLAUDO68', refreshToken: 'SEGRETO-REFRESH-COLLAUDO68', expiresAt: new Date(Date.now() + 3600_000), scope: 'calendar.readonly' } });

  // ── STEP 1 — N23: export JSON ────────────────────────────────────────────
  log('\n## STEP N23 — export JSON: inclusioni ed esclusioni');
  const expAnon = await api('GET', '/api/export?format=json');
  assert(expAnon.status === 401, 'export senza cookie → 401', expAnon.status);
  const expJson = await api('GET', '/api/export?format=json', { cookie: u.cookie });
  assert(expJson.status === 200, 'export JSON → 200 (senza claim beta: nessun gate)', expJson.status);
  const exp = expJson.json as Record<string, unknown> | null;
  const keys = new Set<string>();
  collectKeyPaths(exp, '', keys);
  const has = (k: string) => keys.has(k);

  assert(has('tasks[].title') && has('chatThreads[].messages[].content'), 'export include task e messaggi chat');
  assert(has('recurringTasks[].title'), 'export include i template ricorrenti');
  assert(has('notifications[].type') || has('notifications[].title'), 'export include le Notification');
  assert(has('learningSignals[].signalType'), 'export include i LearningSignal');
  assert(has('pushDevices[].platform'), 'N23: export include PushDevice (metadati)');
  assert(!has('pushDevices[].token') && !has('pushDevices[].p256dh') && !has('pushDevices[].auth'), 'N23: PushDevice SENZA token/chiavi (select esplicito)');
  assert(has('calendarTokens[].provider') && has('calendarTokens[].scope'), 'N23: export include CalendarToken (metadati)');
  assert(!has('calendarTokens[].accessToken') && !has('calendarTokens[].refreshToken'), 'N23: CalendarToken SENZA accessToken/refreshToken');
  assert(!has('password'), 'N23: chiave password ASSENTE dal payload');
  assert(![...keys].some((k) => k.includes('adminNotes')), 'N23: adminNotes (note interne triage) ASSENTE');
  assert(!has('accounts') && !has('sessions') && !has('pushSubscription'), 'N23: accounts/sessions/pushSubscription esclusi');
  const rawText = expJson.text;
  assert(!rawText.includes('SEGRETO-FCM-TOKEN-COLLAUDO68') && !rawText.includes('SEGRETO-ACCESS-COLLAUDO68') && !rawText.includes('SEGRETO-REFRESH-COLLAUDO68'), 'N23: i VALORI segreti seminati non compaiono da nessuna parte nel JSON');
  log('>> AppConfig: tabella GLOBALE key-value (model_routing/pricing/budget, schema.prisma:756) senza userId → non è dato dell\'utente, correttamente fuori dall\'export.');
  log(`chiavi totali export: ${keys.size}; top-level: ${exp ? Object.keys(exp).length : 0}`);

  // CSV: solo task, escaping corretto.
  const expCsv = await api('GET', '/api/export?format=csv', { cookie: u.cookie });
  const csvLines = expCsv.text.split('\n');
  assert(expCsv.status === 200 && (expCsv.headers.get('content-type') ?? '').includes('text/csv'), 'export CSV → 200 text/csv', expCsv.status);
  assert(expCsv.text.includes('"Chiamare il medico, con ""virgolette""'), 'CSV: escaping di virgole/virgolette/a-capo corretto');
  log(`CSV: ${csvLines.length} righe fisiche, header=${csvLines[0]}`);
  log('>> NB (già noto dal 62): il CSV copre SOLO i task — non è un export GDPR completo.');

  saveEvidence(J, 'n23-export-effimero.json', JSON.stringify({
    statusAnon: expAnon.status,
    statusJson: expJson.status,
    chiaviTotali: keys.size,
    chiaviTopLevel: exp ? Object.keys(exp) : [],
    pushDevices: { presente: has('pushDevices[].platform'), tokenEscluso: !has('pushDevices[].token') },
    calendarTokens: { presente: has('calendarTokens[].provider'), segretiEsclusi: !has('calendarTokens[].accessToken') },
    passwordAssente: !has('password'),
    valoriSegretiNelTesto: rawText.includes('SEGRETO-'),
    csv: { status: expCsv.status, righe: csvLines.length, header: csvLines[0] },
  }, null, 2));

  // ── STEP 2 — R6: revoca consenso → 403 consent_required OVUNQUE ─────────
  log('\n## STEP R6a — revoca consenso → 403 consent_required su ≥6 route');
  const revoke = await api('DELETE', '/api/consent', { cookie: u.cookie });
  assert(revoke.status === 200, 'DELETE /api/consent → 200', { status: revoke.status, body: revoke.json });
  const prof = await db.userProfile.findUnique({ where: { userId: u.id }, select: { consentGivenAt: true } });
  assert(prof?.consentGivenAt == null, 'DB: consentGivenAt azzerato dopo la revoca', prof);

  const gated: Array<[string, string, unknown?]> = [
    ['GET', '/api/tasks'],
    ['GET', '/api/daily-plan'],
    ['GET', '/api/settings'],
    ['GET', '/api/notifications'],
    ['GET', '/api/chat/active-thread'],
    ['GET', '/api/recurring'],
    ['GET', '/api/streaks'],
    ['POST', '/api/tasks', { title: 'non deve nascere' }],
  ];
  const gatedResults: Record<string, { status: number; error?: unknown; header?: string | null }> = {};
  for (const [m, p, body] of gated) {
    const r = await api(m, p, { cookie: u.cookie, ...(body !== undefined ? { body } : {}) });
    const errBody = (r.json as { error?: unknown } | null)?.error;
    gatedResults[`${m} ${p}`] = { status: r.status, error: errBody, header: r.headers.get('x-consent-required') };
    assert(r.status === 403 && errBody === 'consent_required' && r.headers.get('x-consent-required') === '1',
      `R6: ${m} ${p} con consenso revocato → 403 consent_required + header`, { status: r.status, error: errBody });
  }
  // Il turno chat si ferma PRIMA dell'LLM (guard) → nessun costo.
  const turn = await postTurn({ cookie: u.cookie, mode: 'general', userMessage: 'ciao' });
  assert(turn.status === 403, 'R6: POST /api/chat/turn con consenso revocato → 403 (nessun trattamento LLM)', turn.status);
  // I diritti GDPR restano esercitabili (allowWithoutConsent).
  const expAfterRevoke = await api('GET', '/api/export?format=json', { cookie: u.cookie });
  assert(expAfterRevoke.status === 200, 'R6: /api/export resta 200 dopo la revoca (diritto art.20, allowWithoutConsent)', expAfterRevoke.status);
  const pageAfterRevoke = await fetch(`${BASE_URL}/tasks`, { headers: { Cookie: u.cookie }, redirect: 'manual' });
  assert(pageAfterRevoke.status === 307 && (pageAfterRevoke.headers.get('location') ?? '').includes('/consent'), 'R6: pagina /tasks dopo revoca → 307 /consent (middleware)', { status: pageAfterRevoke.status, location: pageAfterRevoke.headers.get('location') });

  saveEvidence(J, 'r6-consent-revocato.json', JSON.stringify({
    revoke: { status: revoke.status }, dbConsentGivenAt: prof?.consentGivenAt ?? null,
    routes: gatedResults,
    chatTurn: { status: turn.status, json: turn.json },
    exportDopoRevoca: expAfterRevoke.status,
    pagina: { status: pageAfterRevoke.status, location: pageAfterRevoke.headers.get('location') },
  }, null, 2));

  // ── STEP 3 — R6: delete account → cascade + sessione fantasma 401 ───────
  log('\n## STEP R6b — delete account: cascade + vecchia sessione 401 session_invalid');
  const preCounts = {
    user: await db.user.count({ where: { id: u.id } }),
    tasks: await db.task.count({ where: { userId: u.id } }),
    threads: await db.chatThread.count({ where: { userId: u.id } }),
    messages: await db.chatMessage.count({ where: { threadId: thread.id } }),
    notifications: await db.notification.count({ where: { userId: u.id } }),
    pushDevices: await db.pushDevice.count({ where: { userId: u.id } }),
    calendarTokens: await db.calendarToken.count({ where: { userId: u.id } }),
    recurring: await db.recurringTask.count({ where: { userId: u.id } }),
    signals: await db.learningSignal.count({ where: { userId: u.id } }),
  };
  log(`pre-delete: ${JSON.stringify(preCounts)}`);
  // Fix Task 63 (S2-PRIV2a): la conferma "ELIMINA" è ora un CONTRATTO API
  // (account/route.ts:19-27) — nel 62 era solo client-side.
  const delNoConfirm = await api('DELETE', '/api/account', { cookie: u.cookie });
  assert(delNoConfirm.status === 400 && (delNoConfirm.json as { error?: string })?.error === 'confirmation_required',
    'DELETE senza conferma → 400 confirmation_required (fix 63 regge: non elimina più incondizionatamente)', { status: delNoConfirm.status, body: delNoConfirm.json });
  const delWrong = await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm: 'elimina' } });
  assert(delWrong.status === 400, 'DELETE con conferma sbagliata ("elimina" minuscolo) → 400', { status: delWrong.status, body: delWrong.json });
  const stillThere = await db.user.count({ where: { id: u.id } });
  assert(stillThere === 1, 'utente ancora vivo dopo i due tentativi senza conferma valida', stillThere);
  const delRes = await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm: 'ELIMINA' } });
  assert(delRes.status === 200, 'DELETE con {confirm:"ELIMINA"} → 200', { status: delRes.status, body: delRes.json });
  const delSetCookies = ((delRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []);
  assert(delSetCookies.some((c) => c.startsWith('next-auth.session-token=') && (c.includes('Max-Age=0') || c.includes('01 Jan 1970'))),
    'la risposta della delete azzera il cookie di sessione', delSetCookies.map((c) => c.split(';').slice(0, 2).join(';')));

  const postCounts = {
    user: await db.user.count({ where: { id: u.id } }),
    tasks: await db.task.count({ where: { userId: u.id } }),
    threads: await db.chatThread.count({ where: { userId: u.id } }),
    messages: await db.chatMessage.count({ where: { threadId: thread.id } }),
    notifications: await db.notification.count({ where: { userId: u.id } }),
    pushDevices: await db.pushDevice.count({ where: { userId: u.id } }),
    calendarTokens: await db.calendarToken.count({ where: { userId: u.id } }),
    recurring: await db.recurringTask.count({ where: { userId: u.id } }),
    signals: await db.learningSignal.count({ where: { userId: u.id } }),
  };
  assert(Object.values(postCounts).every((n) => n === 0), 'cascade COMPLETO: tutte le tabelle a 0', postCounts);

  // Vecchia sessione (2 repro).
  const ghost1 = await api('GET', '/api/tasks', { cookie: u.cookie });
  const ghost2 = await api('GET', '/api/settings', { cookie: u.cookie });
  assert(ghost1.status === 401 && (ghost1.json as { error?: string })?.error === 'session_invalid', 'R6: vecchia sessione su /api/tasks → 401 session_invalid (repro 1)', { status: ghost1.status, body: ghost1.json });
  assert(ghost2.status === 401 && (ghost2.json as { error?: string })?.error === 'session_invalid', 'R6: vecchia sessione su /api/settings → 401 session_invalid (repro 2)', { status: ghost2.status, body: ghost2.json });

  saveEvidence(J, 'r6-delete-cascade.json', JSON.stringify({
    preCounts,
    deleteSenzaConferma: { status: delNoConfirm.status, body: delNoConfirm.json },
    deleteConfermaSbagliata: { status: delWrong.status, body: delWrong.json },
    delete: { status: delRes.status, body: delRes.json }, postCounts,
    sessioneFantasma: { tasks: { status: ghost1.status, body: ghost1.json }, settings: { status: ghost2.status, body: ghost2.json } },
  }, null, 2));

  const spend = await llmSpend(u.id); // 0: cascade ha cancellato anche AiUsage (e non c'erano turni)
  log(`\nspesa LLM utente effimero (post-cascade): ${spend} USD`);
  if (spend > 0) warn('spesa LLM inattesa', spend);
  await deleteEphemeralUser(u.email); // idempotente, l'utente è già andato

  saveEvidence(J, 'j10-parte2-log.md', out.join('\n'));
  finish('j10-20-gdpr-lifecycle');
}

main().catch(async (err) => {
  console.error('[FATAL] j10-20:', err);
  await db.$disconnect();
  process.exit(1);
});
