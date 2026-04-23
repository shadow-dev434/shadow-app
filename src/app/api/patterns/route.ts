import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/patterns — get user patterns
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    let patterns = await db.userPattern.findFirst({ where: { userId } });
    if (!patterns) {
      patterns = await db.userPattern.create({ data: { userId } });
    }

    return NextResponse.json({
      patterns: {
        ...patterns,
        avoidedCategories: JSON.parse(patterns.avoidedCategories),
        difficultTimeSlots: JSON.parse(patterns.difficultTimeSlots),
        problematicCategories: JSON.parse(patterns.problematicCategories),
        effectiveFormats: JSON.parse(patterns.effectiveFormats),
      },
    });
  } catch (error) {
    console.error('GET /api/patterns error:', error);
    return NextResponse.json({ error: 'Failed to fetch patterns' }, { status: 500 });
  }
}
