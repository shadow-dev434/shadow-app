/**
 * Collaudo 62 — J10 parte 2: GDPR e ciclo di vita account (spec §7 J10, dossier D5/D28/D65/D66).
 *
 * Utenti DEDICATI (creati qui, pattern seed-cohort):
 *  - collaudo-j10gdpr@probe.local  → export, consenso, logout, forgot/reset. RESTA VIVO.
 *  - collaudo-j10del@probe.local   → eliminazione account (viene DISTRUTTO, è il suo scopo).
 *
 * Step:
 *  1. Export GDPR (JSON+CSV): contenuto, esclusioni (password/adminNotes/token), gate beta? (D66)
 *  2. Revoca consenso → rimbalzo /consent (middleware DB re-read) → API ancora aperte? → ri-consenso
 *  3. Eliminazione account: stringa ELIMINA lato server? cascade reale, cookie post-delete
 *  4. /account-deletion pubblica: testo vs UI reale (D66)
 *  5. Logout finto D5: client-only, cookie resta valido; /api/auth/signout
 *  6. Forgot/reset password: promessa email (D65), tre policy password (D28), rate limit token
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j10gdpr-lifecycle.ts
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { mintCookie, api, postTurn, dumpThread, saveEvidence, llmSpend, db, BASE_URL } from './lib';

const J = 'J10-gdpr-account';
const PASSWORD = 'Collaudo62!pass';
const EMAIL_GDPR = 'collaudo-j10gdpr@probe.local';
const EMAIL_DEL = 'collaudo-j10del@probe.local';

const out: string[] = [];
function log(line: string): void {
  out.push(line);
  console.log(line);
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function setCookies(headers: Headers): string[] {
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  return anyH.getSetCookie ? anyH.getSetCookie() : [];
}

/** Shape redatta: chiavi visibili, valori sostituiti da tipo/lunghezza. */
function redactShape(v: unknown): unknown {
  if (Array.isArray(v)) {
    return { _array: v.length, _itemShape: v.length > 0 ? redactShape(v[0]) : null };
  }
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, redactShape(val)]));
  }
  if (typeof v === 'string') return `string(${v.length})`;
  if (v === null) return null;
  return typeof v;
}

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

/** Seed utente pattern seed-cohort: profilo completo + 2 task + 1 thread con 2 messaggi. */
async function seedUser(email: string, name: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) await db.user.delete({ where: { id: existing.id } });
  const hashed = await bcrypt.hash(PASSWORD, 12);
  const u = await db.user.create({
    data: {
      email,
      name,
      password: hashed,
      profile: {
        create: {
          onboardingComplete: true,
          tourCompleted: true,
          consentGivenAt: new Date(),
          consentVersion: 'collaudo-62',
          role: 'worker',
          occupation: 'impiegato amministrativo',
          age: 34,
          mainResponsibilities: JSON.stringify(['lavoro', 'casa']),
          difficultAreas: JSON.stringify(['bureaucracy', 'admin']),
        },
      },
    },
  });
  await db.settings.create({ data: { userId: u.id } });
  await db.userPattern.create({ data: { userId: u.id } });
  const t1 = await db.task.create({
    data: { userId: u.id, title: 'Pagare la bolletta del gas (seed J10)', status: 'planned', importance: 4, urgency: 4 },
  });
  const t2 = await db.task.create({
    data: { userId: u.id, title: 'Chiamare il medico di base (seed J10)', status: 'inbox', importance: 3, urgency: 2 },
  });
  const thread = await db.chatThread.create({
    data: {
      userId: u.id,
      mode: 'general',
      state: 'active',
      messages: {
        create: [
          { role: 'user', content: 'Ciao Shadow, ho due cose da fare oggi: bolletta e medico' },
          { role: 'assistant', content: 'Segnate entrambe. Da quale partiamo?' },
        ],
      },
    },
  });
  return { id: u.id, email, taskIds: [t1.id, t2.id], threadId: thread.id };
}

async function main(): Promise<void> {
  log(`# J10 parte 2 — GDPR e ciclo di vita account (${new Date().toISOString()})`);
  log(`BASE_URL=${BASE_URL}`);

  const gdpr = await seedUser(EMAIL_GDPR, 'Collaudo J10gdpr');
  const del = await seedUser(EMAIL_DEL, 'Collaudo J10del');
  log(`seed: gdpr=${gdpr.id} (tasks=${gdpr.taskIds.length} thread=${gdpr.threadId})`);
  log(`seed: del=${del.id} (tasks=${del.taskIds.length} thread=${del.threadId})`);
  await dumpThread(gdpr.threadId, J, 'seed-thread-j10gdpr');

  const gdprCookie = await mintCookie({ userId: gdpr.id, email: gdpr.email, name: 'Collaudo J10gdpr' });
  const delCookie = await mintCookie({ userId: del.id, email: del.email, name: 'Collaudo J10del' });

  // ────────────────────────────────────────────────────────────────────
  // STEP 1 — EXPORT GDPR (JSON + CSV) — gate beta? (D66)
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 1 — export GDPR');
  const expAnon = await api('GET', '/api/export?format=json');
  log(`GET /api/export senza cookie → ${expAnon.status} (atteso 401)`);

  let expJson = await api('GET', '/api/export?format=json', { cookie: gdprCookie });
  log(`GET /api/export?format=json (cookie SENZA claim beta) → ${expJson.status}`);
  let usedBetaClaim = false;
  if (expJson.status === 403) {
    // D66: diritto GDPR dietro gate beta — riprova con claim.
    const betaCookie = await mintCookie({
      userId: gdpr.id, email: gdpr.email, extraClaims: { isBetaTester: true },
    });
    expJson = await api('GET', '/api/export?format=json', { cookie: betaCookie });
    usedBetaClaim = true;
    log(`RETRY con extraClaims {isBetaTester:true} → ${expJson.status} (PARADOSSO D66: export API gate beta)`);
  }

  const exp = expJson.json as Record<string, unknown> | null;
  const expTasks = (exp?.tasks as Array<{ id: string; title: string }> | undefined) ?? [];
  const expThreads = (exp?.chatThreads as Array<{ id: string; messages?: unknown[] }> | undefined) ?? [];
  const expProfile = exp?.profile as Record<string, unknown> | null | undefined;
  const myTasksInExport = gdpr.taskIds.filter((id) => expTasks.some((t) => t.id === id)).length;
  const myThread = expThreads.find((t) => t.id === gdpr.threadId);
  log(`contenuto: tasks=${expTasks.length} (dei miei 2 seed: ${myTasksInExport}/2), ` +
    `chatThreads=${expThreads.length} (il mio thread c'e'=${myThread != null}, messaggi=${myThread?.messages?.length}), ` +
    `profile presente=${expProfile != null} (occupation=${typeof expProfile?.occupation})`);

  const keyPaths = new Set<string>();
  collectKeyPaths(exp, '', keyPaths);
  const forbiddenPattern = /password|adminnote|secret|apikey|credential|(^|\.|\[\]\.)token$|accesstoken|refreshtoken/i;
  const forbiddenHits = [...keyPaths].filter((p) => forbiddenPattern.test(p));
  // 'calendarTokens' come NOME di collezione è metadato (select senza valori token): valutato a parte.
  const containerOnly = forbiddenHits.filter((p) => p === 'calendarTokens' || p.startsWith('calendarTokens[]'));
  log(`chiavi totali nell'export: ${keyPaths.size}; match pattern sensibile: ${JSON.stringify(forbiddenHits)}`);
  log(`di cui solo-contenitore calendarTokens (metadati, senza valori token): ${JSON.stringify(containerOnly)}`);
  log(`chiave 'password' presente: ${keyPaths.has('password')}; 'adminNotes' presente: ${[...keyPaths].some((p) => p.includes('adminNotes'))}`);

  const expCsv = await api('GET', '/api/export?format=csv', { cookie: gdprCookie });
  const csvLines = expCsv.text.split('\n');
  log(`GET /api/export?format=csv → ${expCsv.status} content-type=${expCsv.headers.get('content-type')} ` +
    `righe=${csvLines.length} (header + ${csvLines.length - 1} task) header=${csvLines[0]}`);
  log(`>> NB: il CSV copre SOLO i task, non e' un export GDPR completo (route export/route.ts:72-100).`);
  log(`>> Gate UI: la card "Esporta dati" in Impostazioni e' beta-only (tasks/page.tsx:3394 isBetaTester), ` +
    `ma l'API /api/export richiede solo la sessione → il diritto e' esercitabile solo via API o da tester (D66).`);

  saveEvidence(J, 'step1-export-shape-redatta.json', JSON.stringify({
    statusSenzaCookie: expAnon.status,
    statusJson: expJson.status,
    usatoClaimBeta: usedBetaClaim,
    contenuto: {
      tasksTotali: expTasks.length, mieiTaskPresenti: myTasksInExport,
      threadPresente: myThread != null, messaggiNelThread: myThread?.messages?.length ?? 0,
      profilePresente: expProfile != null,
    },
    chiaviSensibiliMatch: forbiddenHits,
    shapeRedatta: redactShape(exp),
    csv: { status: expCsv.status, contentType: expCsv.headers.get('content-type'), righe: csvLines.length, header: csvLines[0] },
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 2 — REVOCA CONSENSO → rimbalzo /consent → API aperte? → ri-consenso
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 2 — revoca consenso');
  // Pre: /tasks passa (il token mintato NON ha claim consentGiven → se passa, il middleware legge dal DB).
  const prePage = await fetch(`${BASE_URL}/tasks`, { headers: { Cookie: gdprCookie }, redirect: 'manual' });
  log(`GET /tasks PRIMA della revoca → ${prePage.status} (token senza claim consentGiven: se 200, il middleware rilegge dal DB — middleware.ts:114-131)`);

  const revoke = await api('DELETE', '/api/consent', { cookie: gdprCookie });
  const profAfterRevoke = await db.userProfile.findUnique({
    where: { userId: gdpr.id },
    select: { consentGivenAt: true, consentArt9: true, consentVersion: true },
  });
  log(`DELETE /api/consent → ${revoke.status} body=${JSON.stringify(revoke.json)}`);
  log(`DB dopo revoca: consentGivenAt=${String(profAfterRevoke?.consentGivenAt)} consentArt9=${String(profAfterRevoke?.consentArt9)} consentVersion=${profAfterRevoke?.consentVersion} (resta come record storico)`);

  const postPage = await fetch(`${BASE_URL}/tasks`, { headers: { Cookie: gdprCookie }, redirect: 'manual' });
  log(`GET /tasks DOPO la revoca (redirect:manual) → ${postPage.status} location=${postPage.headers.get('location')} (atteso 307 → /consent)`);

  // Le API sono gated sul consenso? (il middleware NON applica il gate alle /api/*)
  const apiAfterRevoke = await api('GET', '/api/tasks', { cookie: gdprCookie });
  const apiTasksCount = ((apiAfterRevoke.json as { tasks?: unknown[] })?.tasks ?? []).length;
  log(`GET /api/tasks con consenso REVOCATO → ${apiAfterRevoke.status} tasks=${apiTasksCount} (se 200: API non gated sul consenso)`);

  // La chat (trattamento art.9-adiacente) processa ancora?
  const turnRevoked = await postTurn({ cookie: gdprCookie, mode: 'general', userMessage: 'ciao, come funziona Shadow?' });
  log(`POST /api/chat/turn con consenso REVOCATO → ${turnRevoked.status} threadId=${turnRevoked.json.threadId} ` +
    `(se 200: il trattamento LLM continua dopo la revoca — la UI promette "ferma l'app")`);
  if (turnRevoked.json.threadId) {
    await dumpThread(turnRevoked.json.threadId, J, 'step2-turn-con-consenso-revocato');
  }

  // Ri-consenso: prima parziale (atteso 400), poi completo.
  const partial = await api('POST', '/api/consent', { cookie: gdprCookie, body: { acceptTerms: true } });
  log(`POST /api/consent {acceptTerms:true} (parziale) → ${partial.status} (atteso 400, entrambe obbligatorie)`);
  const regrant = await api('POST', '/api/consent', { cookie: gdprCookie, body: { acceptTerms: true, acceptArt9: true } });
  const profAfterRegrant = await db.userProfile.findUnique({
    where: { userId: gdpr.id },
    select: { consentGivenAt: true, consentArt9: true, consentVersion: true },
  });
  log(`POST /api/consent completo → ${regrant.status}; DB: consentGivenAt=${String(profAfterRegrant?.consentGivenAt)} ` +
    `consentArt9=${String(profAfterRegrant?.consentArt9)} consentVersion=${profAfterRegrant?.consentVersion} ` +
    `(nota: la versione ora e' quella del copy corrente — '0.2-draft' = consenso legale ancora in bozza)`);
  const pageAfterRegrant = await fetch(`${BASE_URL}/tasks`, { headers: { Cookie: gdprCookie }, redirect: 'manual' });
  log(`GET /tasks dopo ri-consenso → ${pageAfterRegrant.status} (utente di nuovo usabile)`);

  saveEvidence(J, 'step2-consenso.json', JSON.stringify({
    prePage: { status: prePage.status },
    revoke: { status: revoke.status, body: revoke.json },
    dbDopoRevoca: {
      consentGivenAt: profAfterRevoke?.consentGivenAt, consentArt9: profAfterRevoke?.consentArt9,
      consentVersion: profAfterRevoke?.consentVersion,
    },
    postPage: { status: postPage.status, location: postPage.headers.get('location') },
    apiConConsensoRevocato: { status: apiAfterRevoke.status, tasks: apiTasksCount },
    chatTurnConConsensoRevocato: { status: turnRevoked.status, threadId: turnRevoked.json.threadId ?? null, error: turnRevoked.json.error ?? null },
    riconsensoParziale: { status: partial.status, body: partial.json },
    riconsensoCompleto: { status: regrant.status, body: regrant.json },
    dbDopoRiconsenso: {
      consentGivenAt: profAfterRegrant?.consentGivenAt, consentArt9: profAfterRegrant?.consentArt9,
      consentVersion: profAfterRegrant?.consentVersion,
    },
    pageDopoRiconsenso: { status: pageAfterRegrant.status },
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 3 — ELIMINAZIONE ACCOUNT (collaudo-j10del: VERRA' DISTRUTTO)
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 3 — eliminazione account (j10del)');
  const preDelSanity = await api('GET', '/api/tasks', { cookie: delCookie });
  const preDelCount = ((preDelSanity.json as { tasks?: unknown[] })?.tasks ?? []).length;
  const preCounts = {
    user: await db.user.count({ where: { id: del.id } }),
    tasks: await db.task.count({ where: { userId: del.id } }),
    threads: await db.chatThread.count({ where: { userId: del.id } }),
    messages: await db.chatMessage.count({ where: { threadId: del.threadId } }),
    profile: await db.userProfile.count({ where: { userId: del.id } }),
    settings: await db.settings.count({ where: { userId: del.id } }),
    patterns: await db.userPattern.count({ where: { userId: del.id } }),
  };
  log(`sanity pre-delete: GET /api/tasks → ${preDelSanity.status} tasks=${preDelCount}; DB=${JSON.stringify(preCounts)}`);
  await dumpThread(del.threadId, J, 'seed-thread-j10del-pre-delete');

  // "Senza la stringa ELIMINA": l'API DELETE /api/account non prevede ALCUN corpo
  // di conferma (account/route.ts:11-25) — la stringa e' solo client-side
  // (tasks/page.tsx:3282). Questa chiamata senza conferma quindi ELIMINA davvero.
  const delRes = await api('DELETE', '/api/account', { cookie: delCookie });
  log(`DELETE /api/account SENZA stringa di conferma → ${delRes.status} body=${JSON.stringify(delRes.json)} ` +
    `(spec attendeva 4xx: la conferma "ELIMINA" e' SOLO client-side — il server elimina incondizionatamente)`);

  const postCounts = {
    user: await db.user.count({ where: { id: del.id } }),
    tasks: await db.task.count({ where: { userId: del.id } }),
    threads: await db.chatThread.count({ where: { userId: del.id } }),
    messages: await db.chatMessage.count({ where: { threadId: del.threadId } }),
    profile: await db.userProfile.count({ where: { userId: del.id } }),
    settings: await db.settings.count({ where: { userId: del.id } }),
    patterns: await db.userPattern.count({ where: { userId: del.id } }),
  };
  log(`cascade DB post-delete: ${JSON.stringify(postCounts)} (atteso tutto 0)`);

  // Cookie post-delete: invalidato?
  const ghostApi = await api('GET', '/api/tasks', { cookie: delCookie });
  const ghostTasks = ((ghostApi.json as { tasks?: unknown[] })?.tasks ?? []).length;
  const ghostSession = await api('GET', '/api/auth/session', { cookie: delCookie });
  const ghostPage = await fetch(`${BASE_URL}/tasks`, { headers: { Cookie: delCookie }, redirect: 'manual' });
  log(`cookie POST-delete su /api/tasks → ${ghostApi.status} tasks=${ghostTasks} (401 atteso se invalidato; 200 = sessione fantasma)`);
  log(`cookie POST-delete su /api/auth/session → ${ghostSession.status} body=${JSON.stringify(ghostSession.json).slice(0, 200)}`);
  log(`cookie POST-delete su /tasks (pagina) → ${ghostPage.status} location=${ghostPage.headers.get('location')} ` +
    `(il middleware non trova il profilo → tourCompleted false → rimbalzo /tour da utente INESISTENTE)`);
  log(`>> La UI mitiga chiamando signOut() dopo la delete (tasks/page.tsx:3287), ma il JWT in se' resta ` +
    `decodificabile e accettato da requireSession (auth-guard.ts: nessun check di esistenza utente).`);

  saveEvidence(J, 'step3-delete-account.json', JSON.stringify({
    preCounts, sanityPreDelete: { status: preDelSanity.status, tasks: preDelCount },
    deleteSenzaConferma: { status: delRes.status, body: delRes.json },
    postCounts,
    cookieFantasma: {
      apiTasks: { status: ghostApi.status, tasks: ghostTasks },
      session: { status: ghostSession.status, body: ghostSession.json },
      pagina: { status: ghostPage.status, location: ghostPage.headers.get('location') },
    },
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 4 — /account-deletion PUBBLICA vs UI reale (D66)
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 4 — /account-deletion pubblica');
  const adPage = await fetch(`${BASE_URL}/account-deletion`, { redirect: 'manual' });
  const adHtml = await adPage.text();
  const mentionsElimina = adHtml.includes('ELIMINA');
  const mentionsExport = adHtml.includes('Esporta JSON');
  const mentionsImpost = adHtml.includes('Impost.');
  log(`GET /account-deletion SENZA cookie → ${adPage.status} bytes=${adHtml.length} ` +
    `(cita ELIMINA=${mentionsElimina}, cita "Esporta JSON"=${mentionsExport}, cita scheda "Impost."=${mentionsImpost})`);
  log(`>> Confronto col codice: la card "Elimina account e dati" (Account) NON e' beta-gated → Metodo 1 vale per tutti. ` +
    `La sezione §5 pero' istruisce "Esporta dati → Esporta JSON": quella card e' SOLO beta (tasks/page.tsx:3394) → ` +
    `un utente non-beta segue le istruzioni e NON trova la sezione (D66).`);
  saveEvidence(J, 'step4-account-deletion-page.html', adHtml);
  saveEvidence(J, 'step4-account-deletion.json', JSON.stringify({
    status: adPage.status, bytes: adHtml.length,
    citaElimina: mentionsElimina, citaEsportaJson: mentionsExport, citaImpost: mentionsImpost,
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 5 — LOGOUT FINTO (D5) + /api/auth/signout
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 5 — logout finto D5');
  log(`codice: tasks/page.tsx:614-625 handleLogout = SOLO store Zustand + localStorage.removeItem + ` +
    `setCurrentView('auth') — NESSUNA chiamata server, NESSUN signOut(): il cookie httpOnly next-auth resta intatto.`);
  // Simulazione: dopo il "logout" client il cookie e' immutato per definizione → basta riusarlo.
  const afterFakeLogout = await api('GET', '/api/tasks', { cookie: gdprCookie });
  const afterFakeCount = ((afterFakeLogout.json as { tasks?: unknown[] })?.tasks ?? []).length;
  log(`GET /api/tasks col cookie dopo il "logout" client → ${afterFakeLogout.status} tasks=${afterFakeCount} ` +
    `(200 = D5 CONFERMATO: chiunque riapra il browser rientra senza credenziali per 30gg)`);

  // Esiste una route di signout NextAuth utilizzabile?
  const soGet = await fetch(`${BASE_URL}/api/auth/signout`, { headers: { Cookie: gdprCookie }, redirect: 'manual' });
  const soGetHtml = await soGet.text();
  log(`GET /api/auth/signout → ${soGet.status} (pagina HTML di conferma NextAuth, bytes=${soGetHtml.length})`);

  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: { Cookie: gdprCookie } });
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = setCookies(csrfRes.headers).map((c) => c.split(';')[0]).join('; ');
  const soPost = await fetch(`${BASE_URL}/api/auth/signout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `${gdprCookie}; ${csrfCookie}`,
    },
    body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE_URL}/`, json: 'true' }).toString(),
    redirect: 'manual',
  });
  const soSetCookies = setCookies(soPost.headers);
  const clearsSession = soSetCookies.some((c) => c.startsWith('next-auth.session-token=') && (c.includes('Max-Age=0') || c.includes('01 Jan 1970')));
  log(`POST /api/auth/signout (con csrfToken) → ${soPost.status} — Set-Cookie azzera il session-token: ${clearsSession}`);
  // JWT strategy: il token VECCHIO resta valido anche dopo il signout (nessuna revoca server-side).
  const replayOld = await api('GET', '/api/tasks', { cookie: gdprCookie });
  log(`replay del VECCHIO cookie dopo il signout → ${replayOld.status} ` +
    `(200 = il signout pulisce solo il browser; il JWT non e' revocabile server-side — strategy jwt)`);

  saveEvidence(J, 'step5-logout-d5.json', JSON.stringify({
    codice: 'tasks/page.tsx:614-625 — client-only (store+localStorage), nessun signOut()',
    apiTasksDopoLogoutClient: { status: afterFakeLogout.status, tasks: afterFakeCount },
    signoutGet: { status: soGet.status, bytes: soGetHtml.length },
    signoutPost: { status: soPost.status, setCookie: soSetCookies.map((c) => c.split(';')[0].split('=')[0] + '=<redatto>' + c.slice(c.indexOf(';'))), azzeraSessionToken: clearsSession },
    replayVecchioCookie: { status: replayOld.status },
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 6 — FORGOT / RESET PASSWORD (D65, D28)
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 6 — forgot/reset password');
  const resendPresent = Boolean(process.env.RESEND_API_KEY);
  log(`RESEND_API_KEY presente nell'ambiente dev: ${resendPresent} (valore mai letto/stampato)`);

  const forgot = await api('POST', '/api/auth/forgot-password', { body: { email: EMAIL_GDPR } });
  log(`POST forgot-password (email esistente) → ${forgot.status} body=${JSON.stringify(forgot.json)}`);
  const forgotUnknown = await api('POST', '/api/auth/forgot-password', { body: { email: 'collaudo-mai-esistito@probe.local' } });
  log(`POST forgot-password (email INESISTENTE) → ${forgotUnknown.status} body=${JSON.stringify(forgotUnknown.json)} (anti-enumeration: identica?)`);
  const forgotInvalid = await api('POST', '/api/auth/forgot-password', { body: { email: 'non-una-email' } });
  log(`POST forgot-password (email sintatticamente invalida) → ${forgotInvalid.status} body=${JSON.stringify(forgotInvalid.json)}`);
  log(`>> D65: la risposta promette "riceverai un link" INCONDIZIONATAMENTE (forgot-password/route.ts:12-16,38-44): ` +
    `stessa risposta se Resend manca, fallisce (sandbox consegna solo al titolare: probe.local NON riceve nulla) o il rate limit scatta.`);

  const identifier = `password-reset:${EMAIL_GDPR}`;
  const tokensAfterForgot = await db.verificationToken.count({ where: { identifier } });
  log(`token di reset in DB per ${EMAIL_GDPR}: ${tokensAfterForgot} (in DB c'e' solo lo sha256: il raw viaggia SOLO nell'email)`);

  // Il raw token non e' recuperabile dal DB (hash) → ne fabbrichiamo uno valido
  // con la stessa pipeline (identifier + sha256), da manipolazione dati sul NOSTRO utente.
  const rawToken = randomBytes(32).toString('base64url');
  await db.verificationToken.create({
    data: { identifier, token: sha256hex(rawToken), expires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  log(`token di reset FABBRICATO via DB (stessa pipeline sha256) per completare il flusso`);

  const resetShort = await api('POST', '/api/auth/reset-password', { body: { token: rawToken, password: '12345' } });
  log(`POST reset-password con password di 5 char → ${resetShort.status} body=${JSON.stringify(resetShort.json)} (atteso 400 "almeno 6")`);
  const reset6 = await api('POST', '/api/auth/reset-password', { body: { token: rawToken, password: 'sei123' } });
  log(`POST reset-password con password di 6 char → ${reset6.status} body=${JSON.stringify(reset6.json)} (D28: il reset accetta 6)`);
  const tokensAfterReset = await db.verificationToken.count({ where: { identifier } });
  log(`token residui per l'email dopo il reset: ${tokensAfterReset} (atteso 0: monouso, brucia tutti)`);

  const loginNew = await api('POST', '/api/auth/login', { body: { email: EMAIL_GDPR, password: 'sei123' } });
  log(`POST /api/auth/login con la NUOVA password di 6 char → ${loginNew.status} (200 = una password che il register rifiuterebbe e' ora valida end-to-end)`);

  const regShort = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'collaudo-j10reg@probe.local', password: 'sette77' } });
  log(`POST register con password di 7 char → ${regShort.status} body=${JSON.stringify(regShort.json)} ` +
    `(server: min 8, register/route.ts:18; il CLIENT valida min 6, tasks/page.tsx:781; il reset accetta 6, reset-password/route.ts:19 → D28 CONFERMATO: tre policy diverse)`);
  const regUserCreated = await db.user.count({ where: { email: 'collaudo-j10reg@probe.local' } });
  log(`utente collaudo-j10reg creato dal 400? ${regUserCreated} (atteso 0)`);

  // Rate limit token: max 3 attivi per email, oltre → richiesta ignorata in silenzio, risposta identica.
  const rl: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/auth/forgot-password', { body: { email: EMAIL_GDPR } });
    rl.push(r.status);
  }
  const tokensAfterFlood = await db.verificationToken.count({ where: { identifier } });
  log(`4 forgot consecutivi → status=${JSON.stringify(rl)} — token attivi in DB: ${tokensAfterFlood} (cap atteso 3; la 4a e' ignorata in silenzio, risposta identica)`);

  // Ripristino: password standard di collaudo + pulizia token residui (l'utente resta VIVO e usabile).
  const restoredHash = await bcrypt.hash(PASSWORD, 12);
  await db.user.update({ where: { id: gdpr.id }, data: { password: restoredHash } });
  await db.verificationToken.deleteMany({ where: { identifier } });
  const loginRestored = await api('POST', '/api/auth/login', { body: { email: EMAIL_GDPR, password: PASSWORD } });
  log(`ripristino password standard collaudo + purge token → login di verifica ${loginRestored.status} (j10gdpr VIVO)`);

  saveEvidence(J, 'step6-forgot-reset.json', JSON.stringify({
    resendKeyPresente: resendPresent,
    forgotEsistente: { status: forgot.status, body: forgot.json },
    forgotInesistente: { status: forgotUnknown.status, body: forgotUnknown.json },
    forgotInvalida: { status: forgotInvalid.status, body: forgotInvalid.json },
    tokenInDbDopoForgot: tokensAfterForgot,
    reset5char: { status: resetShort.status, body: resetShort.json },
    reset6char: { status: reset6.status, body: reset6.json },
    tokenDopoReset: tokensAfterReset,
    loginConPassword6: { status: loginNew.status },
    registerConPassword7: { status: regShort.status, body: regShort.json, utenteCreato: regUserCreated },
    floodForgot: { status: rl, tokenAttiviDopo: tokensAfterFlood },
    ripristino: { loginStatus: loginRestored.status },
  }, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // Stato finale + spesa
  // ────────────────────────────────────────────────────────────────────
  const gdprAlive = await db.user.count({ where: { id: gdpr.id } });
  const delGone = await db.user.count({ where: { id: del.id } });
  log(`\nstato finale: collaudo-j10gdpr VIVO=${gdprAlive === 1}; collaudo-j10del ELIMINATO=${delGone === 0}`);
  const spendGdpr = await llmSpend(gdpr.id);
  const spendDel = await llmSpend(del.id); // 0: AiUsage cascade-cancellata con l'utente
  log(`spendUsd: gdpr=${spendGdpr} del=${spendDel} (le righe AiUsage di j10del sono state cancellate in cascade) totale=${spendGdpr + spendDel}`);

  saveEvidence(J, 'j10-parte2-log.md', out.join('\n'));
  console.log('\n[j10-gdpr] fatto. Evidenze in docs/tasks/62-evidenze/' + J);
}

main()
  .catch((err) => {
    console.error('[FATAL] j10-gdpr:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
