/**
 * Collaudo 68 — harness condiviso (fusione di task63/lib + collaudo-62/lib + task67/lib,
 * come da spec docs/tasks/68-collaudo-finale-pre-rilascio.md §5).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/<script>.ts
 * SOLO dev locale (:3000) + DB dev royal-feather: preflightDb() è OBBLIGATORIA
 * in ogni script (§2.2) — chiamarla PRIMA di qualunque accesso al DB.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode, decode } from 'next-auth/jwt';
import { db } from '../../../src/lib/db';
import { nowHHMMInRome } from '../../../src/lib/evening-review/dates';

export const BASE_URL = process.env.COLLAUDO_BASE_URL ?? 'http://localhost:3000';
export const EVIDENZE_DIR = join(process.cwd(), 'docs', 'tasks', '68-evidenze');
export const COHORT_PASSWORD = 'Collaudo68!pass';

// ── guardia DB (obbligatoria, §2.2) ─────────────────────────────────────────
export async function preflightDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL assente (lanciare via dotenv -e .env.local)');
  const host = new URL(url).host;
  if (!host.includes('royal-feather')) {
    throw new Error(`DATABASE_URL host inatteso (${host}): i probe girano SOLO sul DB dev royal-feather`);
  }
  console.log(`[preflight] DB host ok: ${host}`);
}

// ── cookie di sessione ──────────────────────────────────────────────────────
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
      name: opts.name ?? 'Collaudo68',
      tourCompleted: opts.tourCompleted ?? true,
      onboardingComplete: opts.onboardingComplete ?? true,
      ...(opts.extraClaims ?? {}),
    },
    secret,
    maxAge: 60 * 60 * 24 * 30,
  });
  return `next-auth.session-token=${token}`;
}

export async function decodeSessionCookie(cookieValue: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente');
  const decoded = await decode({ token: cookieValue, secret });
  return decoded as Record<string, unknown> | null;
}

// ── fetch API ───────────────────────────────────────────────────────────────
export interface ApiResult {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
}

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

// ── evidenze ────────────────────────────────────────────────────────────────
/** Salva un'evidenza testuale in docs/tasks/68-evidenze/<journey>/<name>. */
export function saveEvidence(journey: string, name: string, content: string): string {
  const dir = join(EVIDENZE_DIR, journey);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

/** Trascrizione completa di un thread (materia per l'audit conversazionale §9.3). */
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

/** Spesa LLM totale della coorte collaudo68-*. */
export async function llmSpendCohort(): Promise<number> {
  const users = await db.user.findMany({
    where: { email: { startsWith: 'collaudo68-', endsWith: '@probe.local' } },
    select: { id: true },
  });
  const agg = await db.aiUsage.aggregate({
    where: { userId: { in: users.map((u) => u.id) } },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ?? 0;
}

// ── coorte / utenti ─────────────────────────────────────────────────────────
/** Utente della coorte 68 per ruolo (creato da seed-cohort.ts). */
export async function cohortUser(role: string): Promise<{ id: string; email: string; name: string | null }> {
  const u = await db.user.findUnique({
    where: { email: `collaudo68-${role}@probe.local` },
    select: { id: true, email: true, name: true },
  });
  if (!u) throw new Error(`utente collaudo68-${role} assente: lanciare seed-cohort.ts`);
  return u;
}

/**
 * Utente effimero collaudo68-<slug>@probe.local. Di default profilo completo e
 * consenso dato; opts per gli scenari J9 (senza consenso / senza onboarding).
 */
export async function createEphemeralUser(
  slug: string,
  opts: { consent?: boolean; onboarded?: boolean; tourDone?: boolean } = {},
): Promise<{ id: string; email: string; cookie: string }> {
  const consent = opts.consent ?? true;
  const onboarded = opts.onboarded ?? true;
  const tourDone = opts.tourDone ?? true;
  const email = `collaudo68-${slug}@probe.local`;
  await db.user.deleteMany({ where: { email } }); // idempotenza tra run
  const user = await db.user.create({ data: { name: `C68 ${slug}`, email } });
  await db.settings.create({ data: { userId: user.id } });
  await db.userPattern.create({ data: { userId: user.id } });
  await db.userProfile.create({
    data: {
      userId: user.id,
      onboardingComplete: onboarded,
      tourCompleted: tourDone,
      ...(consent
        ? { consentGivenAt: new Date(), consentVersion: '0.2-draft', consentArt9: true }
        : {}),
    },
  });
  const cookie = await mintCookie({
    userId: user.id,
    email,
    tourCompleted: tourDone,
    onboardingComplete: onboarded,
  });
  return { id: user.id, email, cookie };
}

export async function deleteEphemeralUser(email: string): Promise<void> {
  await db.user.deleteMany({ where: { email } });
}

// ── finestra serale con RIPRISTINO esplicito (§2.12) ────────────────────────
function hhmmShift(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Apre la finestra della review serale (larga, centrata su adesso) e RESTITUISCE
 * la funzione di ripristino. Ogni script che la usa DEVE chiamare il restore in
 * un blocco finally (lezione §2.12: openEveningWindow del 67 non ripristinava).
 */
export async function openEveningWindow(userId: string): Promise<() => Promise<void>> {
  const prev = await db.settings.findFirst({
    where: { userId },
    select: { id: true, eveningWindowStart: true, eveningWindowEnd: true },
  });
  const nowRome = nowHHMMInRome();
  await db.settings.updateMany({
    where: { userId },
    data: {
      eveningWindowStart: hhmmShift(nowRome, -60),
      eveningWindowEnd: hhmmShift(nowRome, 120),
    },
  });
  return async () => {
    if (prev) {
      await db.settings.update({
        where: { id: prev.id },
        data: {
          eveningWindowStart: prev.eveningWindowStart,
          eveningWindowEnd: prev.eveningWindowEnd,
        },
      });
    }
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── mini assert con contatori ───────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
let warnCount = 0;

export function assert(cond: boolean, label: string, detail?: unknown): void {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.error(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
}

export function warn(label: string, detail?: unknown): void {
  warnCount++;
  console.warn(`  WARN  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
}

export function finish(probeName: string): never {
  console.log(`\n[${probeName}] PASS=${passCount} FAIL=${failCount} WARN=${warnCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

export { db };
