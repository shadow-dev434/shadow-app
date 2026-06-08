/**
 * E2E run-walk — esecuzione condivisa di UN walk (campagna V1.2.4).
 *
 * Estratto da driver.ts (Fase 3): mint cookie + wakePreflight + postTurn + runWalk.
 * Importato sia da driver.ts (single-run CLI) sia da campaign.ts (N-loop), cosi'
 * il replay NON e' duplicato.
 *
 * IGIENE SEGRETO: NEXTAUTH_SECRET solo da process.env, mai loggato, mai hardcoded;
 * il cookie/token non viene mai stampato. SOLA LETTURA sul DB (read RunRaw).
 */

import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';
import {
  TITLES,
  assistantTools,
  findMarkOutcome,
  findGuardFires,
  taskState,
  parsePhase,
} from '../lib/walk-reader';
import type { Cell, RunRaw } from './scoring';

const SESSION_COOKIE_NAME = 'next-auth.session-token';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 giorni, come il login route

// Utterance FISSE A-bis (07-bolletta-prereg.md). Apostrofi ASCII U+0027.
// Solo il T5 varia per cella (forzato dal flag su "Bolletta luce").
const FIXED_T1_T4: readonly string[] = ['iniziamo', '3', '3', 'ok'];
const FIXED_T6 = "vai sulla telefonata, sull'abbonamento boh vediamo";
const FIXED_T7 = 'va bene';

/**
 * Conia il cookie next-auth.session-token via encode() (Opzione B, offline),
 * mirror dei claim di src/app/api/auth/login/route.ts. Secret SOLO da env.
 */
export async function mintSessionCookie(opts: {
  userId: string;
  email: string;
  name: string;
}): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET assente da process.env. Lanciare via: ' +
        'bun run dotenv -e .env.local -- bun run <script>',
    );
  }
  const token = await encode({
    token: {
      id: opts.userId,
      sub: opts.userId,
      email: opts.email,
      name: opts.name,
      tourCompleted: true,
      onboardingComplete: true,
    },
    secret,
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

/** Wake Neon (SELECT 1) con retry su cold-start / P2028. */
export async function wakePreflight(maxAttempts = 3, delayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (attempt === maxAttempts) throw err;
      console.warn(`[run-walk] wake ${attempt}/${maxAttempts} fallito${code ? ` (${code})` : ''}, retry in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

interface TurnResponse {
  threadId: string;
  assistantMessage?: string;
  costUsd?: number;
  toolsExecuted?: unknown;
}

export async function postTurn(opts: {
  baseUrl: string;
  cookie: string;
  threadId: string | null;
  userMessage: string;
  clientDate: string;
}): Promise<TurnResponse> {
  const res = await fetch(`${opts.baseUrl}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: opts.cookie },
    body: JSON.stringify({
      threadId: opts.threadId,
      mode: 'evening_review',
      userMessage: opts.userMessage,
      clientDate: opts.clientDate,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /api/chat/turn -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TurnResponse;
}

export interface WalkResult {
  raw: RunRaw;
  threadId: string;
  totalCost: number;
  turnCosts: number[];
}

/**
 * Esegue UN walk per la cella: posta i 7 turni (T1-4 fissi, T5=cell, T6-7 fissi)
 * e legge il RunRaw (lente Bolletta) via walk-reader. Thread letto per id ESATTO
 * dalla response (fresh-thread by construction, niente "piu' recente").
 */
export async function runWalk(
  cell: Cell,
  opts: { cookie: string; baseUrl: string; userId: string; clientDate: string },
): Promise<WalkResult> {
  const sequence = [...FIXED_T1_T4, cell.utteranceT5, FIXED_T6, FIXED_T7];
  let threadId: string | null = null;
  let totalCost = 0;
  const turnCosts: number[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const resp = await postTurn({
      baseUrl: opts.baseUrl,
      cookie: opts.cookie,
      threadId,
      userMessage: sequence[i],
      clientDate: opts.clientDate,
    });
    threadId = resp.threadId;
    const cost = resp.costUsd ?? 0;
    totalCost += cost;
    turnCosts.push(cost);
  }
  if (!threadId) throw new Error('runWalk: nessun threadId dalla sequenza.');

  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  const byMessage = await assistantTools(threadId);
  const bol = await taskState(opts.userId, TITLES.Bolletta);
  const fires = findGuardFires(byMessage);
  const bolMark = bol.id ? findMarkOutcome(byMessage, bol.id) : null;
  const phase = parsePhase(thread?.contextJson ?? null);

  const raw: RunRaw = {
    bolId: bol.id,
    fires,
    bolMark: bolMark ? { outcome: bolMark.outcome } : null,
    bolPostponedCount: bol.count,
    phase,
  };
  return { raw, threadId, totalCost, turnCosts };
}
