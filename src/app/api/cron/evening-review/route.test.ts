/**
 * Task 58 — test dell'endpoint cron della review serale.
 *
 * Isola lo strato route: db, computeEveningReviewSignal e sendEveningReviewEmail
 * sono mockati. Gli helper data/ora (dates.ts) restano reali (puri). Copre:
 * auth bearer, selezione candidati, dedup giornaliero, fuori finestra, fallimento
 * invio (niente marcatore + traccia admin evening_email_failed, Task 66 C1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    settings: { findMany: vi.fn() },
    notification: { findFirst: vi.fn(), create: vi.fn() },
    // Task 71 (M/N61): gate focus — il cron salta chi ha una sessione attiva.
    strictModeSession: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/evening-review/compute-signal', () => ({
  computeEveningReviewSignal: vi.fn(),
}));

vi.mock('@/lib/evening-review/evening-email', () => ({
  sendEveningReviewEmail: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { computeEveningReviewSignal } from '@/lib/evening-review/compute-signal';
import { sendEveningReviewEmail } from '@/lib/evening-review/evening-email';

const SECRET = 'test-secret';

function cronReq(token?: string): NextRequest {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null,
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  // Task 73 (B): pacing degli invii a 1ms nei test — la logica per-utente è
  // identica, ma senza questo un test con ≥3 invii pagherebbe finestre da 1.1s.
  process.env.EVENING_EMAIL_BATCH_MS = '1';
  // Default: un candidato con email, segnale ON, mai sollecitato oggi, invio ok.
  vi.mocked(db.settings.findMany).mockResolvedValue([
    { userId: 'u1', user: { email: 'a@b.com' } },
  ] as never);
  vi.mocked(db.notification.findFirst).mockResolvedValue(null as never);
  vi.mocked(db.notification.create).mockResolvedValue({} as never);
  vi.mocked(db.strictModeSession.findFirst).mockResolvedValue(null as never); // default: nessun focus
  vi.mocked(computeEveningReviewSignal).mockResolvedValue({ shouldStart: true });
  vi.mocked(sendEveningReviewEmail).mockResolvedValue({ ok: true });
});

describe('GET /api/cron/evening-review', () => {
  it('404 senza bearer corretto, nessuna query', async () => {
    const res = await GET(cronReq('wrong'));
    expect(res.status).toBe(404);
    expect(db.settings.findMany).not.toHaveBeenCalled();
  });

  it('404 se CRON_SECRET non è configurato', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(cronReq('whatever'));
    expect(res.status).toBe(404);
  });

  it('happy path: invia email e scrive il marcatore', async () => {
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(sendEveningReviewEmail).toHaveBeenCalledWith('a@b.com');
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', type: 'evening_review_prompt' }),
      }),
    );
    expect(body).toEqual({ candidates: 1, sent: 1, skipped: 0, skippedFocus: 0, failed: 0 });
  });

  it('skip se già sollecitato oggi (dedup), nessuna email', async () => {
    vi.mocked(db.notification.findFirst).mockResolvedValue({ id: 'n1' } as never);
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(sendEveningReviewEmail).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(body).toEqual({ candidates: 1, sent: 0, skipped: 1, skippedFocus: 0, failed: 0 });
  });

  it('skip fuori finestra (shouldStart=false), nessun dedup né email', async () => {
    vi.mocked(computeEveningReviewSignal).mockResolvedValue({ shouldStart: false });
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(db.notification.findFirst).not.toHaveBeenCalled();
    expect(sendEveningReviewEmail).not.toHaveBeenCalled();
    expect(body).toEqual({ candidates: 1, sent: 0, skipped: 1, skippedFocus: 0, failed: 0 });
  });

  it('invio fallito: failed++, NESSUN marcatore, traccia evening_email_failed col motivo', async () => {
    vi.mocked(sendEveningReviewEmail).mockResolvedValue({
      ok: false,
      detail: 'HTTP 422: invalid to',
    });
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    // Una sola create: la traccia admin, mai il marcatore PROMPT_TYPE.
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        type: 'evening_email_failed',
        title: 'Invio email serale fallito',
        body: 'HTTP 422: invalid to',
        read: true,
      },
    });
    expect(body).toEqual({ candidates: 1, sent: 0, skipped: 0, skippedFocus: 0, failed: 1 });
  });

  it('invio fallito già tracciato oggi: nessuna seconda traccia (dedup giorno)', async () => {
    vi.mocked(sendEveningReviewEmail).mockResolvedValue({ ok: false, detail: 'HTTP 500' });
    // findFirst risponde per type: PROMPT_TYPE mai sollecitato, FAILED già tracciato.
    vi.mocked(db.notification.findFirst).mockImplementation((async (args: {
      where: { type: string };
    }) => (args.where.type === 'evening_email_failed' ? { id: 'nf1' } : null)) as never);
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(body).toEqual({ candidates: 1, sent: 0, skipped: 0, skippedFocus: 0, failed: 1 });
  });

  it('errore nella scrittura della traccia: il giro continua e risponde 200', async () => {
    vi.mocked(db.settings.findMany).mockResolvedValue([
      { userId: 'u1', user: { email: 'a@b.com' } },
      { userId: 'u2', user: { email: 'c@d.com' } },
    ] as never);
    // Task 73 (B): gli invii dello stesso batch sono concorrenti → i mock si
    // agganciano agli ARGOMENTI, non all'ordine di chiamata (che non è più
    // deterministico tra utenti).
    vi.mocked(sendEveningReviewEmail).mockImplementation(async (email: string) =>
      email === 'a@b.com' ? { ok: false, detail: 'HTTP 500' } : { ok: true },
    );
    vi.mocked(db.notification.create).mockImplementation((async (args: {
      data: { type: string };
    }) => {
      if (args.data.type === 'evening_email_failed') throw new Error('db down'); // traccia u1
      return {}; // marcatore u2
    }) as never);
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ candidates: 2, sent: 1, skipped: 0, skippedFocus: 0, failed: 1 });
  });

  it('Task 73 (B): crash nella valutazione di un utente non uccide il cron', async () => {
    vi.mocked(db.settings.findMany).mockResolvedValue([
      { userId: 'u1', user: { email: 'a@b.com' } },
      { userId: 'u2', user: { email: 'c@d.com' } },
    ] as never);
    // Prima del 73 questo throw produceva 500 + alert per TUTTI gli utenti.
    vi.mocked(computeEveningReviewSignal).mockImplementation(async (userId: string) => {
      if (userId === 'u1') throw new Error('signal esploso');
      return { shouldStart: true };
    });
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(sendEveningReviewEmail).toHaveBeenCalledTimes(1);
    expect(sendEveningReviewEmail).toHaveBeenCalledWith('c@d.com');
    expect(body).toEqual({ candidates: 2, sent: 1, skipped: 0, skippedFocus: 0, failed: 1 });
  });

  it('dedup per userId quando Settings ha più righe stesso utente', async () => {
    vi.mocked(db.settings.findMany).mockResolvedValue([
      { userId: 'u1', user: { email: 'a@b.com' } },
      { userId: 'u1', user: { email: 'a@b.com' } },
    ] as never);
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(body.candidates).toBe(1);
    expect(sendEveningReviewEmail).toHaveBeenCalledTimes(1);
  });

  it('Task 71 (M/N61): utente in focus → skippedFocus, niente email né marcatore', async () => {
    vi.mocked(db.strictModeSession.findFirst).mockResolvedValue({ id: 's1' } as never);
    const res = await GET(cronReq(SECRET));
    const body = await res.json();
    expect(sendEveningReviewEmail).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    // Il gate interroga solo gli stati attivi e le sessioni non scadute.
    expect(db.strictModeSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          status: { in: ['active_soft', 'active_strict', 'pending_exit'] },
          endsAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(body).toEqual({ candidates: 1, sent: 0, skipped: 0, skippedFocus: 1, failed: 0 });
  });
});
