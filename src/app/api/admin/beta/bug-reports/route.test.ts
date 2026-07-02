/**
 * Task 66 (C2) — la PATCH admin che porta una segnalazione a "fixed" chiude il
 * feedback loop col tester: riga Notification type='bug_fixed' + email
 * best-effort, SOLO alla transizione reale (resolvedAt non ancora valorizzato).
 * Il salvataggio ripetuto della stessa card non deve rinotificare, e un errore
 * nella notifica non deve rompere il PATCH (lo status è già aggiornato).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/beta/admin-guard', () => ({
  requireAdminSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bugReport: { findUnique: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('@/lib/beta/bug-fixed-email', () => ({
  sendBugFixedEmail: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { requireAdminSession } from '@/lib/beta/admin-guard';
import { db } from '@/lib/db';
import { sendBugFixedEmail } from '@/lib/beta/bug-fixed-email';

function patchReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const TESTER_REPORT = {
  resolvedAt: null,
  userId: 'tester-1',
  description: 'Il bottone salva non risponde al tap',
  user: { email: 'tester@probe.local' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminSession).mockResolvedValue({
    error: null,
    userId: 'admin-1',
    email: 'admin@shadow.app',
  } as never);
  vi.mocked(db.bugReport.findUnique).mockResolvedValue(TESTER_REPORT as never);
  vi.mocked(db.bugReport.update).mockResolvedValue({ id: 'r1', status: 'fixed' } as never);
  vi.mocked(db.notification.create).mockResolvedValue({} as never);
  vi.mocked(sendBugFixedEmail).mockResolvedValue(true);
});

describe('PATCH /api/admin/beta/bug-reports — notifica fixed (Task 66 C2)', () => {
  it('prima transizione a fixed: Notification bug_fixed al tester + email', async () => {
    const res = await PATCH(patchReq({ id: 'r1', status: 'fixed' }));
    expect(res.status).toBe(200);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'tester-1',
        type: 'bug_fixed',
        title: 'Segnalazione risolta 🎉',
      }),
    });
    expect(sendBugFixedEmail).toHaveBeenCalledWith('tester@probe.local', {
      description: TESTER_REPORT.description,
    });
  });

  it('fixed ripetuto (resolvedAt già valorizzato): nessuna nuova notifica', async () => {
    vi.mocked(db.bugReport.findUnique).mockResolvedValue({
      ...TESTER_REPORT,
      resolvedAt: new Date('2026-07-01T10:00:00Z'),
    } as never);
    const res = await PATCH(patchReq({ id: 'r1', status: 'fixed' }));
    expect(res.status).toBe(200);
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendBugFixedEmail).not.toHaveBeenCalled();
  });

  it('status diverso da fixed: nessuna notifica', async () => {
    const res = await PATCH(patchReq({ id: 'r1', status: 'in_progress' }));
    expect(res.status).toBe(200);
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendBugFixedEmail).not.toHaveBeenCalled();
  });

  it('patch senza status (solo priority): nessun lookup né notifica', async () => {
    const res = await PATCH(patchReq({ id: 'r1', priority: 'P1' }));
    expect(res.status).toBe(200);
    expect(db.bugReport.findUnique).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it('errore nella creazione della notifica: il PATCH risponde comunque 200', async () => {
    vi.mocked(db.notification.create).mockRejectedValue(new Error('db down'));
    const res = await PATCH(patchReq({ id: 'r1', status: 'fixed' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toBeDefined();
  });

  it('non-admin: la route non esiste (404) e non tocca nulla', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(requireAdminSession).mockResolvedValue({
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
      userId: null,
      email: null,
    } as never);
    const res = await PATCH(patchReq({ id: 'r1', status: 'fixed' }));
    expect(res.status).toBe(404);
    expect(db.bugReport.update).not.toHaveBeenCalled();
  });
});
