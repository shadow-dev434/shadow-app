// Shadow — Memory API
// GET: Retrieve user memories by type and category
// POST: Store or update a memory entry

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildMemoryEntry } from '@/lib/engines/memory-engine';

// GET /api/memory?userId=XXX&type=XXX&category=XXX&limit=50
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const type = req.nextUrl.searchParams.get('type') ?? undefined;
  const category = req.nextUrl.searchParams.get('category') ?? undefined;
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)));

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
}

// POST /api/memory — store/update a memory entry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, memoryType, category, key, value, strength, evidence } = body;

    if (!userId || !memoryType || !category || !key || value === undefined) {
      return NextResponse.json(
        { error: 'userId, memoryType, category, key, and value are required' },
        { status: 400 }
      );
    }

    // Check if memory already exists (unique constraint on userId+memoryType+category+key)
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
      // Use buildMemoryEntry to compute the updated values
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

    // Create new memory entry
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
    console.error('Error storing memory:', error);
    return NextResponse.json({ error: 'Failed to store memory' }, { status: 500 });
  }
}
