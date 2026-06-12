import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsTtsProvider } from './elevenlabs';
import { TTS_MAX_CHARS } from './provider';

function audioResponse(): Response {
  return new Response(new Blob([new Uint8Array(64)]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

describe('ElevenLabsTtsProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sintetizza: header chiave, modello flash, mime e chars', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse());
    const out = await new ElevenLabsTtsProvider().synthesize('Ciao, sono Shadow.');
    expect(out.mimeType).toBe('audio/mpeg');
    expect(out.chars).toBe('Ciao, sono Shadow.'.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/text-to-speech/');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('test-key');
    expect(JSON.parse(init.body as string).model_id).toBe('eleven_flash_v2_5');
  });

  it('tronca il testo a TTS_MAX_CHARS', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse());
    const out = await new ElevenLabsTtsProvider().synthesize('x'.repeat(TTS_MAX_CHARS + 200));
    expect(out.chars).toBe(TTS_MAX_CHARS);
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent.text).toHaveLength(TTS_MAX_CHARS);
  });

  it('ritenta UNA volta su 5xx e poi riesce', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(audioResponse());
    const out = await new ElevenLabsTtsProvider().synthesize('retry');
    expect(out.chars).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('NON ritenta sui 4xx (chiave/scope/quota)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"missing_permissions"}', { status: 401 }));
    await expect(new ElevenLabsTtsProvider().synthesize('no')).rejects.toThrow('elevenlabs tts 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('esaurisce i tentativi su errori di rete ripetuti', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(new ElevenLabsTtsProvider().synthesize('net')).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fallisce subito senza chiave', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    await expect(new ElevenLabsTtsProvider().synthesize('x')).rejects.toThrow('ELEVENLABS_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
