/**
 * Collaudo Task 62 — helper condivisi per gli script dei journey.
 *
 * Import tipico da uno script in scripts/e2e/collaudo-62/:
 *   import { mintCookie, api, postTurn, dumpThread, saveEvidence, BASE_URL } from './lib';
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/<script>.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from 'next-auth/jwt';
import { db } from '../../../src/lib/db';

export const BASE_URL = process.env.COLLAUDO_BASE_URL ?? 'http://localhost:3000';
export const EVIDENZE_DIR = join(process.cwd(), 'docs', 'tasks', '62-evidenze');

/** Cookie di sessione NextAuth mintato offline (pattern run-walk). */
export async function mintCookie(opts: {
  userId: string;
  email: string;
  name?: string;
  extraClaims?: Record<string, unknown>; // es. { isBetaTester: true } | { isAdmin: true }
  tourCompleted?: boolean;
  onboardingComplete?: boolean;
}): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (lanciare via dotenv -e .env.local)');
  const token = await encode({
    token: {
      id: opts.userId,
      sub: opts.userId,
      email: opts.email,
      name: opts.name ?? 'Collaudo',
      tourCompleted: opts.tourCompleted ?? true,
      onboardingComplete: opts.onboardingComplete ?? true,
      ...(opts.extraClaims ?? {}),
    },
    secret,
    maxAge: 60 * 60 * 24 * 30,
  });
  return `next-auth.session-token=${token}`;
}

/** Utente della coorte per ruolo (creato da seed-cohort.ts). */
export async function cohortUser(role: string): Promise<{ id: string; email: string; name: string | null }> {
  const u = await db.user.findUnique({
    where: { email: `collaudo-${role}@probe.local` },
    select: { id: true, email: true, name: true },
  });
  if (!u) throw new Error(`utente collaudo-${role} assente: lanciare seed-cohort.ts`);
  return u;
}

export interface ApiResult {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
}

/** fetch con cookie + parse tollerante (json se possibile, sempre text). */
export async function api(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

export interface TurnJson {
  threadId?: string;
  assistantMessage?: string;
  toolsExecuted?: Array<{ name: string; input?: unknown; result?: unknown }>;
  quickReplies?: Array<{ label?: string; value?: string; action?: string; taskId?: string; durationMinutes?: number }>;
  costUsd?: number;
  error?: string;
}

/** Turno chat con mode esplicito (variante probe-chat-task-tools). */
export async function postTurn(opts: {
  cookie: string;
  mode: 'general' | 'morning_checkin' | 'evening_review' | string;
  userMessage: string;
  threadId?: string | null;
  clientDate?: string;
  attachments?: Array<{ type: string; mediaType?: string; name?: string; data: string }>;
}): Promise<{ status: number; json: TurnJson }> {
  const r = await api('POST', '/api/chat/turn', {
    cookie: opts.cookie,
    body: {
      threadId: opts.threadId ?? undefined,
      mode: opts.mode,
      userMessage: opts.userMessage,
      clientDate: opts.clientDate,
      attachments: opts.attachments,
    },
  });
  return { status: r.status, json: (r.json ?? {}) as TurnJson };
}

/** Salva un'evidenza testuale in docs/tasks/62-evidenze/<journey>/<name>. */
export function saveEvidence(journey: string, name: string, content: string): string {
  const dir = join(EVIDENZE_DIR, journey);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

/** Trascrizione completa di un thread (materia per l'audit conversazionale). */
export async function dumpThread(threadId: string, journey: string, label: string): Promise<string> {
  const msgs = await db.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, payloadJson: true, createdAt: true, modelUsed: true, tokensIn: true, tokensOut: true, latencyMs: true },
  });
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { mode: true, state: true, startedAt: true, userId: true },
  });
  const lines: string[] = [
    `# Trascrizione ${label}`,
    `thread=${threadId} mode=${thread?.mode} state=${thread?.state} startedAt=${thread?.startedAt?.toISOString()}`,
    '',
  ];
  for (const m of msgs) {
    lines.push(`## [${m.role}] ${m.createdAt.toISOString()}${m.modelUsed ? ` (${m.modelUsed}, in=${m.tokensIn} out=${m.tokensOut}, ${m.latencyMs}ms)` : ''}`);
    lines.push(m.content);
    if (m.payloadJson) lines.push(`\n\`payload\`: ${m.payloadJson.slice(0, 2000)}`);
    lines.push('');
  }
  return saveEvidence(journey, `${label}.md`, lines.join('\n'));
}

/** Spesa LLM da AiUsage per un utente (tutte le taskClass, tutti i giorni). */
export async function llmSpend(userId: string): Promise<number> {
  const agg = await db.aiUsage.aggregate({ where: { userId }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export { db };
