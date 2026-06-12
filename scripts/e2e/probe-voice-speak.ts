/**
 * Probe E2E /api/voice/speak (Task 27 v1.1 — TTS ElevenLabs).
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-voice-speak.ts
 *
 * Precondizioni: dev server su E2E_BASE_URL (default :3000) con
 * ELEVENLABS_API_KEY configurata. Verifica: 401 senza cookie, 400 senza testo,
 * 200 audio/mpeg con bytes>0, upsert AiUsage taskClass voice_tts.
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { mintSessionCookie, wakePreflight } from './run-walk';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const USER_ID = process.env.E2E_USER_ID ?? 'cmp1flw1g005oibvckzsenuqm'; // alberto

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log(`[probe-voice] BASE_URL=${BASE_URL} user=${USER_ID}`);
  await wakePreflight();
  const user = await db.user.findUnique({ where: { id: USER_ID }, select: { email: true, name: true } });
  if (!user?.email) throw new Error(`User ${USER_ID} non trovato.`);
  const cookie = await mintSessionCookie({ userId: USER_ID, email: user.email, name: user.name ?? 'e2e' });

  // 1) Senza sessione → 401
  const noAuth = await fetch(`${BASE_URL}/api/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ciao' }),
  });
  check('senza cookie → 401', noAuth.status === 401, `status=${noAuth.status}`);

  // 2) Testo mancante → 400
  const noText = await fetch(`${BASE_URL}/api/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({}),
  });
  check('testo mancante → 400', noText.status === 400, `status=${noText.status}`);

  // 3) Sintesi reale
  const day = formatTodayInRome();
  const before = await db.aiUsage.findUnique({
    where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'voice_tts' } },
    select: { calls: true },
  });
  const baseCalls = before?.calls ?? 0;

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ text: 'Ciao, sono Shadow. Sono qui con te mentre lavori.' }),
  });
  const latencyMs = Date.now() - t0;
  check('sintesi → 200', res.status === 200, `status=${res.status}`);
  check('content-type audio', (res.headers.get('content-type') ?? '').includes('audio'), res.headers.get('content-type') ?? '');
  check('X-Voice-Provider elevenlabs', res.headers.get('x-voice-provider') === 'elevenlabs');
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  check('audio bytes > 1000', bytes > 1000, `bytes=${bytes} latency=${latencyMs}ms`);

  // 4) Telemetria AiUsage (recordAiUsage è fire-and-forget: piccola attesa)
  await new Promise((r) => setTimeout(r, 1500));
  const after = await db.aiUsage.findUnique({
    where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'voice_tts' } },
  });
  check('AiUsage voice_tts calls +1', (after?.calls ?? 0) >= baseCalls + 1, `calls=${after?.calls}`);
  check('AiUsage modelMix elevenlabs', (after?.modelMix ?? '').includes('elevenlabs'), after?.modelMix);

  console.log(failures === 0 ? '[probe-voice] VERDICT: PASS' : `[probe-voice] VERDICT: FAIL (${failures} check falliti)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[FATAL] probe-voice-speak failed:', err);
  process.exitCode = 1;
});
