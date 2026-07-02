import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

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
    captureApiError(error, 'GET /api/settings');
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

    // Task 64 (B2, D29): orario malformato ("25:99") prima veniva accettato
    // (wake/sleep) o ignorato in silenzio (finestra serale) con un 200
    // falso-successo. Contratto esplicito: 400 col campo incriminato.
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    const timeFields = ['wakeTime', 'sleepTime', 'eveningWindowStart', 'eveningWindowEnd'] as const;
    for (const field of timeFields) {
      if (body[field] !== undefined && (typeof body[field] !== 'string' || !HHMM.test(body[field]))) {
        return NextResponse.json(
          { error: `${field} non valido: atteso orario HH:MM` },
          { status: 400 },
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    // Task 65 (A3, D71): whitelist ridotta ai campi letti da logica reale
    // (wake/sleep → fasce del piano). Rimossi i campi fantasma mai letti
    // (defaultEnergy/Context/Duration/Format, productiveSlots, theme):
    // scrivibili da API ma invisibili e senza consumatori.
    const allowedFields = ['wakeTime', 'sleepTime'];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Opt-out promemoria email + finestra serale (B4): scrivibili dall'utente.
    // Senza questi, il toggle notifiche e la finestra restavano immutabili e
    // l'utente non poteva fermare le email serali (problema di controllo art.9).
    if (body.notificationsEnabled !== undefined) {
      updateData.notificationsEnabled = Boolean(body.notificationsEnabled);
    }
    for (const field of ['eveningWindowStart', 'eveningWindowEnd'] as const) {
      if (typeof body[field] === 'string' && HHMM.test(body[field])) {
        updateData[field] = body[field];
      }
    }

    const updated = await db.settings.update({
      where: { id: settings.id },
      data: updateData,
    });

    return NextResponse.json({ settings: updated });
  } catch (error) {
    captureApiError(error, 'PATCH /api/settings');
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
