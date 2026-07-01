/**
 * Probe e2e Task 61 (Fase 3) — proposta proattiva STRICT nel morning check-in.
 *
 * Catena verificata (turni REALI su POST /api/chat/turn, mode morning_checkin):
 *   prompt MORNING_CHECKIN → il modello chiama offer_strict_mode →
 *   executeOfferStrictMode garantisce taskId/durata → l'orchestrator emette la
 *   quick reply { action: 'start_strict', taskId, durationMinutes } che
 *   ChatView traduce in enterStrictMode() lato client.
 *
 * Pattern probe-chat-task-tools: utente probe usa-e-getta + seed via DB
 * (profilo completo + 2 task + DailyPlan di oggi con top3Ids). I check di
 * meccanica (HTTP 200, shape della QR quando emessa) sono HARD (FAIL); i check
 * che dipendono dalla scelta del modello di chiamare il tool sono WARN.
 *
 * Lancio (dev server attivo su baseUrl):
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/probe-strict-proactive.ts [baseUrl]
 * Flag:
 *   --keep          NON cancella l'utente probe a fine run e stampa lo userId
 *                   (per la QA browser: mint-preview-session.ts <userId>)
 *   --cleanup-only  cancella l'utente probe (cascade) ed esce
 */

import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { wakePreflight } from './run-walk';

const PROBE_EMAIL = 'probe-task61@example.com';
const args = process.argv.slice(2);
const baseUrl = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const KEEP = args.includes('--keep');
const CLEANUP_ONLY = args.includes('--cleanup-only');
const MAX_TURNS = 5;

let failures = 0;
let warnings = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Check LLM-dependent: non blocca l'exit code. */
function warn(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) warnings++;
}

async function mintCookie(userId: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  const token = await encode({
    token: {
      id: userId,
      sub: userId,
      email: PROBE_EMAIL,
      name: 'Probe Task61',
      tourCompleted: true,
      onboardingComplete: true,
    },
    secret,
    maxAge: 3600,
  });
  return `next-auth.session-token=${token}`;
}

interface QuickReplyJson {
  label?: string;
  value?: string;
  action?: string;
  taskId?: string;
  durationMinutes?: number;
}

interface TurnJson {
  threadId?: string;
  assistantMessage?: string;
  toolsExecuted?: Array<{ name: string; result?: unknown }>;
  quickReplies?: QuickReplyJson[];
  error?: string;
}

async function postTurn(
  cookie: string,
  userMessage: string,
  threadId: string | null,
): Promise<{ status: number; json: TurnJson }> {
  const res = await fetch(`${baseUrl}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ threadId: threadId ?? undefined, mode: 'morning_checkin', userMessage }),
  });
  const json = (await res.json().catch(() => ({}))) as TurnJson;
  return { status: res.status, json };
}

async function deleteProbeUser(): Promise<void> {
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) await db.user.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  await wakePreflight();
  if (CLEANUP_ONLY) {
    await deleteProbeUser();
    console.log('[probe-t61] utente probe cancellato.');
    return;
  }

  console.log(`[probe-t61] baseUrl=${baseUrl} keep=${KEEP}`);
  await deleteProbeUser();

  // ── Seed: utente + profilo completo (gate middleware per la QA browser) ──
  const user = await db.user.create({
    data: {
      email: PROBE_EMAIL,
      name: 'Probe Task61',
      password: 'not-a-real-login-61!',
      profile: {
        create: {
          onboardingComplete: true,
          tourCompleted: true,
          consentGivenAt: new Date(),
          consentVersion: 'probe',
          blockedApps: JSON.stringify(['com.instagram.android', 'com.zhiliaoapp.musically']),
        },
      },
    },
  });
  const userId = user.id;

  try {
    // 2 task attivi + piano di OGGI già committato (top3): è lo scenario in cui
    // il prompt autorizza la proposta (dopo il commit, invitando a partire).
    const t1 = await db.task.create({
      data: { userId, title: 'Scrivere la relazione per il direttivo', status: 'inbox', importance: 4, urgency: 4, sessionDuration: 45 },
    });
    const t2 = await db.task.create({
      data: { userId, title: 'Rispondere alle mail arretrate', status: 'inbox', importance: 3, urgency: 3 },
    });
    await db.dailyPlan.create({
      data: {
        userId,
        date: formatTodayInRome(),
        top3Ids: JSON.stringify([t1.id, t2.id]),
        energyLevel: 4,
      },
    });

    const cookie = await mintCookie(userId);

    // ── Turni reali: al più MAX_TURNS, stop appena compare la QR start_strict.
    // I messaggi seguono il flusso del check-in (umore/energia → tempo →
    // conferma piano → partenza), così il modello arriva al commit — il punto
    // dopo il quale il prompt autorizza la proposta strict.
    const scriptedMessages = [
      'Buongiorno Shadow! Energia 4, umore buono.',
      'Oggi ho circa 4-6 ore disponibili.',
      'Sì, confermo il piano così com\'è. Partirei subito con la prima cosa.',
      'Sì, mi aiuterebbe qualcosa per restare concentrato senza distrarmi col telefono.',
      'Sì dai, attiviamo la modalità strict.',
    ];

    let threadId: string | null = null;
    let strictQr: QuickReplyJson | null = null;
    let qrTurn: TurnJson | null = null;
    let offerToolCalled = false;

    for (let i = 0; i < MAX_TURNS && !strictQr; i++) {
      const { status, json } = await postTurn(cookie, scriptedMessages[i], threadId);
      check(`turno ${i + 1} → 200`, status === 200, `status=${status} err=${json.error ?? ''}`);
      if (status !== 200) break;
      check(`turno ${i + 1} assistantMessage non vuoto`, (json.assistantMessage ?? '').length > 0);
      threadId = json.threadId ?? threadId;

      const tools = (json.toolsExecuted ?? []).map((t) => t.name);
      if (tools.includes('offer_strict_mode')) offerToolCalled = true;
      const found = (json.quickReplies ?? []).find((r) => r.action === 'start_strict');
      if (found) {
        strictQr = found;
        qrTurn = json;
      }
      console.log(`  [turno ${i + 1}] tools=[${tools.join(', ')}] qr=${JSON.stringify(json.quickReplies ?? [])}`);
    }

    // LLM-dipendente: il modello deve scegliere di proporre (entro MAX_TURNS,
    // con un utente che lo chiede quasi esplicitamente al 3° turno).
    warn(`offer_strict_mode chiamato entro ${MAX_TURNS} turni`, offerToolCalled);
    warn(`quick reply start_strict emessa entro ${MAX_TURNS} turni`, strictQr !== null);

    // Meccanica (HARD): se il tool è stato chiamato, la QR DEVE esserci
    // (contratto orchestrator: cattura risultato → push quick-action).
    if (offerToolCalled) {
      check('tool chiamato ⇒ QR start_strict presente', strictQr !== null);
    }
    if (strictQr) {
      check(
        'QR.taskId è uno dei task del piano',
        strictQr.taskId === t1.id || strictQr.taskId === t2.id,
        `taskId=${strictQr.taskId}`,
      );
      check(
        'QR.durationMinutes numerica > 0',
        typeof strictQr.durationMinutes === 'number' && strictQr.durationMinutes > 0,
        `durationMinutes=${strictQr.durationMinutes}`,
      );
      check('QR.label non vuota', (strictQr.label ?? '').length > 0, `label=${strictQr.label}`);
      // Prompt: in quel turno il bottone è la sola QR (niente [[QR:]] testuali).
      const others = (qrTurn?.quickReplies ?? []).filter((r) => r.action !== 'start_strict');
      warn('nel turno della proposta non ci sono altre QR testuali', others.length === 0, JSON.stringify(others));
    }
  } finally {
    if (KEEP) {
      console.log(`[probe-t61] KEEP: utente probe conservato. userId=${userId}`);
      console.log(`[probe-t61] QA browser: node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/mint-preview-session.ts ${userId}`);
    } else {
      await db.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }

  console.log(
    failures === 0
      ? `[probe-t61] VERDICT: PASS${warnings > 0 ? ` (con ${warnings} WARN da leggere)` : ''}`
      : `[probe-t61] VERDICT: FAIL (${failures} check falliti)`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] probe-strict-proactive failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
