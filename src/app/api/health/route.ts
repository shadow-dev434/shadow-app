// GET /api/health — endpoint pubblico per uptime monitor (audit pre-beta).
// Verifica la raggiungibilità del DB (un SELECT 1 su Neon) e ritorna la versione
// app. Pubblico by-design: nessun requireSession. Il middleware lascia passare le
// /api/* senza redirect, quindi non serve aggiungerlo alla skip-list.
//
// Gli outage da drift schema (2026-06-10/12/15) non hanno generato alcun alert:
// puntare UptimeRobot (o simile) a questo endpoint chiude quel buco.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', version });
  } catch {
    // 503: lo stato è "non sano" → l'uptime monitor lo segnala come down.
    return NextResponse.json({ status: 'error', version }, { status: 503 });
  }
}
