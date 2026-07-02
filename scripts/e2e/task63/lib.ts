/**
 * Task 63 — helper condivisi dei probe (derivati da collaudo-62/lib.ts).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task63/<probe>.ts
 * SOLO dev locale (:3000) + DB dev royal-feather: preflightDb() lo impone.
 */
import { encode, decode } from 'next-auth/jwt';
import { db } from '../../../src/lib/db';

export const BASE_URL = process.env.COLLAUDO_BASE_URL ?? 'http://localhost:3000';

export async function preflightDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL assente (lanciare via dotenv -e .env.local)');
  const host = new URL(url).host;
  if (!host.includes('royal-feather')) {
    throw new Error(`DATABASE_URL host inatteso (${host}): i probe girano SOLO sul DB dev royal-feather`);
  }
  console.log(`[preflight] DB host ok: ${host}`);
}

export async function mintCookie(opts: {
  userId: string;
  email: string;
  name?: string;
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (lanciare via dotenv -e .env.local)');
  const token = await encode({
    token: {
      id: opts.userId,
      sub: opts.userId,
      email: opts.email,
      name: opts.name ?? 'Task63',
      tourCompleted: true,
      onboardingComplete: true,
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

/** Utente effimero task63-<slug>@probe.local con profilo completo e consenso. */
export async function createEphemeralUser(slug: string): Promise<{ id: string; email: string; cookie: string }> {
  const email = `task63-${slug}@probe.local`;
  await db.user.deleteMany({ where: { email } }); // idempotenza tra run
  const user = await db.user.create({ data: { name: `T63 ${slug}`, email } });
  await db.settings.create({ data: { userId: user.id } });
  await db.userPattern.create({ data: { userId: user.id } });
  await db.userProfile.create({
    data: {
      userId: user.id,
      onboardingComplete: true,
      tourCompleted: true,
      consentGivenAt: new Date(),
      consentVersion: '0.2-draft',
      consentArt9: true,
    },
  });
  const cookie = await mintCookie({ userId: user.id, email });
  return { id: user.id, email, cookie };
}

export async function deleteEphemeralUser(email: string): Promise<void> {
  await db.user.deleteMany({ where: { email } });
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
