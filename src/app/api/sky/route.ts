/**
 * Task 55 — GET /api/sky: stato del cielo derivato on-read. Nessun side-effect,
 * zero LLM. Coperto dal matcher middleware via il wildcard `/api/:path*`
 * (nessuna modifica a middleware.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { countLitStars } from '@/lib/sky/lit-stars';
import { computeSkyState } from '@/lib/sky/sky-state';

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  const litStars = await countLitStars(userId);
  const state = computeSkyState(litStars);

  return NextResponse.json({ state });
}
