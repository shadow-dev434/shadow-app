// Shadow — Memory API
// GET: Retrieve user memories by type and category
// POST: Store or update a memory entry

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { buildMemoryEntry } from '@/lib/engines/memory-engine';
import { captureApiError } from '@/lib/observability';

// GET /api/memory?type=XXX&category=XXX&limit=50
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const type = req.nextUrl.searchParams.get('type') ?? undefined;
    const category = req.nextUrl.searchParams.get('category') ?? undefined;
    // Task 71 (B/N50b): NaN sfuggiva a Math.min/max (?limit=abc → take: NaN →
    // Prisma throw 500 fuori telemetria). Non-finito → default 50.
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
      : 50;

    const where: Record<string, unknown> = { userId };
    if (type) where.memoryType = type;
    if (category) where.category = category;

    const memories = await db.userMemory.findMany({
      where,
      orderBy: [
        { strength: 'desc' },
        { lastSeen: 'desc' },
      ],
      take: limit,
    });

    return NextResponse.json({ memories });
  } catch (error) {
    captureApiError(error, 'GET /api/memory');
    return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 });
  }
}

// POST /api/memory — store/update a memory entry
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { memoryType, category, key, value, strength, evidence } = body;

    if (!memoryType || !category || !key || value === undefined) {
      return NextResponse.json(
        { error: 'memoryType, category, key, and value are required' },
        { status: 400 }
      );
    }

    const existing = await db.userMemory.findUnique({
      where: {
        userId_memoryType_category_key: {
          userId,
          memoryType,
          category,
          key,
        },
      },
    });

    if (existing) {
      const entry = buildMemoryEntry(
        userId,
        memoryType,
        category,
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
        existing.strength,
        existing.evidence
      );

      const updated = await db.userMemory.update({
        where: { id: existing.id },
        data: {
          value: entry.value,
          strength: entry.strength,
          evidence: entry.evidence,
          lastSeen: entry.lastSeen,
        },
      });

      return NextResponse.json({ memory: updated, created: false });
    }

    const entry = buildMemoryEntry(
      userId,
      memoryType,
      category,
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
      strength,
      evidence
    );

    const memory = await db.userMemory.create({
      data: {
        userId,
        memoryType,
        category,
        key,
        value: entry.value,
        strength: entry.strength,
        evidence: entry.evidence,
        lastSeen: entry.lastSeen,
      },
    });

    return NextResponse.json({ memory, created: true }, { status: 201 });
  } catch (error) {
    captureApiError(error, 'POST /api/memory');
    return NextResponse.json({ error: 'Failed to store memory' }, { status: 500 });
  }
}
