// Shadow Beta — Admin: gestione segnalazioni (Task 23 Fase 2)
// GET: lista segnalazioni (filtro ?status=), con email utente
// PATCH: triage { id, status?, priority?, adminNotes? }

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdminSession } from '@/lib/beta/admin-guard';
import { db } from '@/lib/db';

const STATUSES = new Set(['new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export async function GET(req: NextRequest) {
  const { error } = await requireAdminSession(req);
  if (error) return error;

  try {
    const status = req.nextUrl.searchParams.get('status');
    const where = status && STATUSES.has(status) ? { status } : {};

    const reports = await db.bugReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { email: true, name: true } } },
    });

    return NextResponse.json({ reports });
  } catch (err) {
    console.error('GET /api/admin/beta/bug-reports error:', err);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdminSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { id, status, priority, adminNotes } = body ?? {};

    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const data: Record<string, unknown> = {};

    // resolvedAt deve essere stabile: il client confronta resolvedAt col
    // proprio "ultimo visto" per il toast "risolto". Lo impostiamo solo se
    // non già valorizzato (no re-stamp su fixed→in_progress→fixed), così il
    // toast non si ri-triggera per la stessa segnalazione.
    let existing: { resolvedAt: Date | null } | null = null;
    if (status !== undefined) {
      if (typeof status !== 'string' || !STATUSES.has(status)) {
        return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      }
      existing = await db.bugReport.findUnique({
        where: { id },
        select: { resolvedAt: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      data.status = status;
      if (status === 'fixed') {
        data.resolvedAt = existing.resolvedAt ?? new Date();
      } else {
        data.resolvedAt = null;
      }
    }

    if (priority !== undefined) {
      if (priority !== null && (typeof priority !== 'string' || !PRIORITIES.has(priority))) {
        return NextResponse.json({ error: 'invalid priority' }, { status: 400 });
      }
      data.priority = priority;
    }

    if (adminNotes !== undefined) {
      if (adminNotes !== null && typeof adminNotes !== 'string') {
        return NextResponse.json({ error: 'invalid adminNotes' }, { status: 400 });
      }
      data.adminNotes = adminNotes === null ? null : adminNotes.slice(0, 8000);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    try {
      const report = await db.bugReport.update({ where: { id }, data });
      return NextResponse.json({ report });
    } catch (err) {
      // P2025 = record inesistente (es. utente cancellato in cascade): 404, non 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      throw err;
    }
  } catch (err) {
    console.error('PATCH /api/admin/beta/bug-reports error:', err);
    return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
  }
}
