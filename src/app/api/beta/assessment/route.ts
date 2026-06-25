// Shadow Beta — Questionari T0/T1 (Task 23 Fase 4, spec §C4)
// GET: le proprie risposte (per il resume multi-step)
// PATCH: salvataggio incrementale { instrument, wave, itemScores, completed? }
//        — upsert su unique(userId, instrument, wave), punteggi ricalcolati
//        server-side dagli item presenti (mai fidarsi del totale client).

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { hasGivenConsent } from '@/lib/beta/consent-guard';
import { captureApiError } from '@/lib/observability';
import {
  INSTRUMENTS,
  allAnswered,
  isValidScore,
  scoreInstrument,
  type InstrumentId,
  type ItemScores,
} from '@/lib/beta/instruments';

const WAVES = new Set(['pre', 'post']);

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const rows = await db.assessmentResponse.findMany({
      where: { userId },
      select: {
        instrument: true,
        wave: true,
        itemScores: true,
        totalScore: true,
        subscales: true,
        completedAt: true,
      },
    });

    const responses = rows.map((r) => {
      let itemScores: ItemScores = {};
      try {
        itemScores = JSON.parse(r.itemScores) as ItemScores;
      } catch {
        // bozza corrotta: si riparte dagli item vuoti
      }
      return {
        instrument: r.instrument,
        wave: r.wave,
        itemScores,
        totalScore: r.totalScore,
        completedAt: r.completedAt,
      };
    });

    return NextResponse.json({ responses });
  } catch (err) {
    captureApiError(err, 'GET /api/beta/assessment');
    return NextResponse.json({ error: 'Failed to fetch assessments' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  // Sink art.9: niente persistenza di punteggi clinici senza consenso registrato.
  if (!(await hasGivenConsent(userId))) {
    return NextResponse.json({ error: 'consent required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { instrument, wave, itemScores, completed } = body ?? {};

    // Object.hasOwn, non `in`: l'operatore `in` matcherebbe anche le chiavi
    // ereditate da Object.prototype (toString, constructor, __proto__…),
    // facendo risolvere config a un membro del prototype → 500 invece di 400.
    if (typeof instrument !== 'string' || !Object.hasOwn(INSTRUMENTS, instrument)) {
      return NextResponse.json({ error: 'invalid instrument' }, { status: 400 });
    }
    if (typeof wave !== 'string' || !WAVES.has(wave)) {
      return NextResponse.json({ error: 'invalid wave' }, { status: 400 });
    }
    const config = INSTRUMENTS[instrument as InstrumentId];

    const incoming: ItemScores = {};
    if (itemScores && typeof itemScores === 'object' && !Array.isArray(itemScores)) {
      for (const [id, raw] of Object.entries(itemScores as Record<string, unknown>)) {
        const v = Number(raw);
        if (!isValidScore(config, id, v)) {
          return NextResponse.json({ error: `invalid score for item ${id}` }, { status: 400 });
        }
        incoming[id] = v;
      }
    }

    const existing = await db.assessmentResponse.findUnique({
      where: { userId_instrument_wave: { userId, instrument, wave } },
    });

    let prev: ItemScores = {};
    if (existing) {
      try {
        prev = JSON.parse(existing.itemScores) as ItemScores;
      } catch {
        prev = {};
      }
    }

    const merged: ItemScores = { ...prev, ...incoming };
    const scored = scoreInstrument(instrument as InstrumentId, merged);
    const isComplete = allAnswered(config, merged);

    // completedAt non regredisce mai; si valorizza solo a strumento intero.
    const completedAt =
      existing?.completedAt ?? (completed === true && isComplete ? new Date() : null);

    const data = {
      itemScores: JSON.stringify(merged),
      totalScore: scored.totalScore,
      subscales: scored.subscales ? JSON.stringify(scored.subscales) : null,
      completedAt,
    };

    const saved = await db.assessmentResponse.upsert({
      where: { userId_instrument_wave: { userId, instrument, wave } },
      create: { userId, instrument, wave, ...data },
      update: data,
    });

    return NextResponse.json({
      response: {
        instrument: saved.instrument,
        wave: saved.wave,
        totalScore: saved.totalScore,
        completedAt: saved.completedAt,
        answered: Object.keys(merged).length,
        totalItems: config.items.length,
      },
    });
  } catch (err) {
    captureApiError(err, 'PATCH /api/beta/assessment');
    return NextResponse.json({ error: 'Failed to save assessment' }, { status: 500 });
  }
}
