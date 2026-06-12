import { describe, it, expect } from 'vitest';
import { pickItalianVoice } from './use-speech';

const voice = (name: string, lang: string, def = false) =>
  ({ name, lang, default: def }) as SpeechSynthesisVoice;

describe('pickItalianVoice', () => {
  it('null senza voci italiane', () => {
    expect(pickItalianVoice([])).toBeNull();
    expect(pickItalianVoice([voice('Samantha', 'en-US'), voice('Anna', 'de-DE')])).toBeNull();
  });

  it('preferisce la voce Google italiana', () => {
    const v = pickItalianVoice([
      voice('Alice', 'it-IT', true),
      voice('Google italiano', 'it-IT'),
      voice('Samantha', 'en-US'),
    ]);
    expect(v?.name).toBe('Google italiano');
  });

  it('poi la default di sistema italiana', () => {
    const v = pickItalianVoice([voice('Luca', 'it-IT'), voice('Alice', 'it-IT', true)]);
    expect(v?.name).toBe('Alice');
  });

  it('altrimenti la prima italiana (match case-insensitive sul lang)', () => {
    const v = pickItalianVoice([voice('Samantha', 'en-US'), voice('Luca', 'IT-it')]);
    expect(v?.name).toBe('Luca');
  });
});
