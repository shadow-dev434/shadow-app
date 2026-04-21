import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/push-subscription — Save push subscription
export async function POST(req: NextRequest) {
  try {
    const { userId, endpoint, keys } = await req.json();

    if (!userId || !endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 });
    }

    // Upsert subscription (one per user)
    const existing = await db.pushSubscription.findUnique({ where: { userId } });

    if (existing) {
      await db.pushSubscription.update({
        where: { id: existing.id },
        data: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
      });
    } else {
      await db.pushSubscription.create({
        data: {
          userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push subscription error:', error);
    return NextResponse.json({ error: 'Errore nel salvataggio sottoscrizione' }, { status: 500 });
  }
}

// GET /api/push-subscription — Check if user has subscription
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ subscribed: false });
    }

    const sub = await db.pushSubscription.findUnique({ where: { userId } });
    return NextResponse.json({ subscribed: !!sub });
  } catch (error) {
    console.error('Push subscription check error:', error);
    return NextResponse.json({ error: 'Errore nella verifica sottoscrizione' }, { status: 500 });
  }
}

// DELETE /api/push-subscription — Remove push subscription
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId obbligatorio' }, { status: 400 });
    }

    await db.pushSubscription.deleteMany({ where: { userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push subscription delete error:', error);
    return NextResponse.json({ error: 'Errore nella rimozione sottoscrizione' }, { status: 500 });
  }
}
