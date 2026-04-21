import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/settings
export async function GET() {
  try {
    let settings = await db.settings.findFirst();
    if (!settings) {
      settings = await db.settings.create({ data: {} });
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/settings
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    let settings = await db.settings.findFirst();
    if (!settings) {
      settings = await db.settings.create({ data: {} });
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'defaultEnergy', 'defaultContext', 'defaultDuration',
      'defaultFormat', 'wakeTime', 'sleepTime',
      'productiveSlots', 'theme',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await db.settings.update({
      where: { id: settings.id },
      data: updateData,
    });

    return NextResponse.json({ settings: updated });
  } catch (error) {
    console.error('PATCH /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
