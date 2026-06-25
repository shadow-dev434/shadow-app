import { describe, it, expect, vi, beforeEach } from 'vitest';

// Modulo con stato a livello di modulo (reloginInFlight): ricarico fresco a ogni
// test con vi.resetModules + doMock, cosi' il guard non sporca i test successivi.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function load() {
  const signOut = vi.fn();
  const toast = vi.fn();
  vi.doMock('next-auth/react', () => ({ signOut }));
  vi.doMock('@/hooks/use-toast', () => ({ toast }));
  const mod = await import('./fetch');
  return { apiFetch: mod.apiFetch, signOut, toast };
}

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  it('ritorna la risposta ok senza toast ne re-login', async () => {
    const { apiFetch, signOut, toast } = await load();
    stubFetch(new Response('{"ok":true}', { status: 200 }));

    const res = await apiFetch('/api/tasks');

    expect(res.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('su 401 scatena il re-login una sola volta e NON mostra toast', async () => {
    const { apiFetch, signOut, toast } = await load();
    stubFetch(new Response('', { status: 401 }));

    await apiFetch('/api/profile');
    await apiFetch('/api/tasks'); // seconda 401 in volo

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/?auth=login' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('su errore non-ok (500) mostra il toast d errore', async () => {
    const { apiFetch, signOut, toast } = await load();
    stubFetch(new Response('', { status: 500 }));

    await apiFetch('/api/daily-plan');

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it('con skipErrorToast non mostra il toast su 500', async () => {
    const { apiFetch, toast } = await load();
    stubFetch(new Response('', { status: 500 }));

    await apiFetch('/api/tasks', { method: 'POST', skipErrorToast: true });

    expect(toast).not.toHaveBeenCalled();
  });

  it('non passa skipErrorToast a fetch (resta nelle RequestInit pulite)', async () => {
    const { apiFetch } = await load();
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    await apiFetch('/api/tasks', { method: 'POST', skipErrorToast: true, body: '{}' });

    const passedInit = fetchMock.mock.calls[0][1];
    expect(passedInit).not.toHaveProperty('skipErrorToast');
    expect(passedInit).toMatchObject({ method: 'POST', body: '{}' });
  });
});
