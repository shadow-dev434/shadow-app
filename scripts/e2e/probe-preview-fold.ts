/**
 * Probe Task 40 — verifica LEGGERA del fold su un deploy Vercel protetto.
 *
 * Genera traffico reale via API (nessun accesso DB diretto: gli assert forti
 * vivono in probe-rolling-summary.ts locale); la conferma del fold si legge
 * nei runtime log del deployment (`bun x vercel logs <url>`, riga [summary]).
 *
 * Uso:
 *   VERCEL_BYPASS=<token> bun run dotenv -e .env.local -- \
 *     bun run scripts/e2e/probe-preview-fold.ts <userId> <email> <previewUrl> [turns]
 *
 * - <userId>/<email>: utente ESISTENTE nel DB puntato dal deployment (per i
 *   preview = prod: usare SOLO l'utente probe sintetico destinato a cleanup).
 * - Il cookie di sessione e' coniato in memoria con i claim middleware
 *   (tour/consent/onboarding) e mai persistito.
 * - GUARD: rifiuta il dominio di produzione — solo URL di preview
 *   (*-projects.vercel.app) o localhost.
 * - Residuo intenzionale: UN thread chat marcato PROBE-TASK40 sull'utente
 *   indicato (nessun endpoint di delete: il cleanup segue la cancellazione
 *   pianificata dell'utente probe).
 */

import { encode } from 'next-auth/jwt';

const [userId, email, baseUrl, turnsArg] = process.argv.slice(2);
const TURNS = Number(turnsArg ?? 32);
const bypass = process.env.VERCEL_BYPASS ?? '';

if (!userId || !email || !baseUrl) {
  console.error('Uso: VERCEL_BYPASS=<token> ... probe-preview-fold.ts <userId> <email> <previewUrl> [turns]');
  process.exit(1);
}
if (!/-projects\.vercel\.app$/.test(new URL(baseUrl).hostname) && !/^localhost(:\d+)?$/.test(new URL(baseUrl).host)) {
  console.error(`GUARD: ${baseUrl} non e' un URL di preview (*-projects.vercel.app) ne' localhost. Mi rifiuto.`);
  process.exit(1);
}
const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  process.exit(1);
}

const MARKER = 'PROBE-TASK40';
let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  // Cookie coniato in memoria, claim middleware inclusi (consentGiven:
  // il middleware legge i claim dal token PRIMA del fallback DB).
  const token = await encode({
    token: {
      id: userId,
      sub: userId,
      email,
      name: 'Probe Preview',
      tourCompleted: true,
      onboardingComplete: true,
      consentGiven: true,
    },
    secret,
    maxAge: 3600,
  });
  const headers = {
    'Content-Type': 'application/json',
    Cookie: `next-auth.session-token=${token}`,
    'x-vercel-protection-bypass': bypass,
  };

  // Sanity read-only: auth + middleware + DB del deployment raggiungibili.
  const sanity = await fetch(`${baseUrl}/api/chat/active-thread?clientTime=12:00&clientDate=2026-06-11`, { headers });
  check('sanity GET active-thread', sanity.status === 200, `status=${sanity.status}`);
  if (sanity.status !== 200) throw new Error('sanity fallita: stop prima di scrivere');

  let threadId: string | null = null;
  let totalCost = 0;
  let slowest = 0;

  for (let n = 1; n <= TURNS; n++) {
    const res = await fetch(`${baseUrl}/api/chat/turn`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        threadId,
        mode: 'general',
        userMessage: `${MARKER} FATTO #${n}: il codice del progetto numero ${n} e' ALFA-${n}. Rispondi in una riga.`,
      }),
    });
    if (res.status !== 200) {
      check(`turno ${n}: 200`, false, `status=${res.status}`);
      throw new Error(`turno ${n} fallito: stop`);
    }
    const json = (await res.json()) as { threadId: string; costUsd?: number; latencyMs?: number };
    threadId = json.threadId;
    totalCost += json.costUsd ?? 0;
    slowest = Math.max(slowest, json.latencyMs ?? 0);
    if (n % 5 === 0 || n === 1) {
      console.log(`  turno ${n}/${TURNS} ok (thread=${threadId}, cum=$${totalCost.toFixed(4)})`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  check(`completati ${TURNS} turni (= ${TURNS * 2} righe: oltre TRIGGER=60)`, true);
  console.log(`thread: ${threadId} | costo turni cumulativo: $${totalCost.toFixed(4)} | turno piu' lento: ${slowest}ms`);

  // Attesa: l'after() del turno oltre soglia deve aver completato il fold.
  await new Promise(r => setTimeout(r, 15_000));

  // Check behavioral: il FATTO #2 a questo punto e' fuori dalla finestra
  // (60 visibili su 64+) — se il modello risponde ALFA-2, l'ha letto dal
  // summary iniettato. WARN-only (LLM-dependent); la conferma primaria del
  // fold e' la riga [summary] nei runtime log del deployment.
  const beh = await fetch(`${baseUrl}/api/chat/turn`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      threadId,
      mode: 'general',
      userMessage: `${MARKER} domanda di verifica: qual era il codice del progetto numero 2?`,
    }),
  });
  const behJson = (await beh.json()) as { assistantMessage?: string };
  const recalled = String(behJson.assistantMessage ?? '').includes('ALFA-2');
  console.log(`${recalled ? 'PASS' : 'WARN'}  behavioral: recupero FATTO #2 dal summary — risposta: ${String(behJson.assistantMessage ?? '').slice(0, 140)}`);

  console.log(`\nVERIFICA FINALE nei log del deployment:\n  bun x vercel logs ${baseUrl} | grep "\\[summary\\]"`);
}

main()
  .catch(err => {
    console.error('Probe error:', err);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? '\nTRAFFICO OK' : `\nPROBE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
  });
