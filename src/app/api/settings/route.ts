import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/settings
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    let settings = await db.settings.findFirst({ where: { userId } });
    if (!settings) {
      settings = await db.settings.create({ data: { userId } });
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/settings
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    let settings = await db.settings.findFirst({ where: { userId } });
    if (!settings) {
      settings = await db.settings.create({ data: { userId } });
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
