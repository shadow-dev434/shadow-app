import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/patterns — get user patterns
export async function GET() {
  try {
    let patterns = await db.userPattern.findFirst();
    if (!patterns) {
      patterns = await db.userPattern.create({ data: {} });
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
