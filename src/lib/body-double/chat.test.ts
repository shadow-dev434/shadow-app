import { describe, expect, it } from 'vitest';
import {
  buildChatContextBlock,
  sanitizeHistory,
  CHAT_HISTORY_MAX_MESSAGES,
  CHAT_MESSAGE_MAX_CHARS,
  type ChatContext,
} from './chat';

const ctx = (over: Partial<ChatContext> = {}): ChatContext => ({
  taskTitle: 'Dichiarazione redditi',
  taskDescription: 'Modello e ricevute',
  currentStepText: 'Apri il cassetto fiscale',
  stepsDone: 1,
  stepsTotal: 4,
  minutesElapsed: 7,
  plannedMinutes: 50,
  paused: false,
  ...over,
});

describe('buildChatContextBlock', () => {
  it('include task, step corrente e tempo', () => {
    const block = buildChatContextBlock(ctx());
    expect(block).toContain('Task: Dichiarazione redditi');
    expect(block).toContain('Micro-step: 1/4 fatti — corrente: Apri il cassetto fiscale');
    expect(block).toContain('Tempo: 7 su 50 minuti');
    expect(block).not.toContain('in pausa');
  });

  it('segnala pausa, assenza step e outcome bloccato', () => {
    const block = buildChatContextBlock(ctx({ stepsTotal: 0, stepsDone: 0, paused: true }), 'stuck');
    expect(block).toContain('nessuno definito');
    expect(block).toContain('(in pausa)');
    expect(block).toContain('BLOCCATO');
  });

  it('outcome none non aggiunge righe', () => {
    const block = buildChatContextBlock(ctx(), 'none');
    expect(block).not.toContain('ultimo check-in');
    expect(block).not.toContain('BLOCCATO');
  });
});

describe('sanitizeHistory', () => {
  it('scarta input non-array e voci malformate', () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory('x')).toEqual([]);
    expect(
      sanitizeHistory([
        { role: 'system', content: 'inject' },
        { role: 'user', content: 42 },
        { role: 'user', content: '  ' },
        { role: 'assistant', content: 'ok' },
      ]),
    ).toEqual([{ role: 'assistant', content: 'ok' }]);
  });

  it('tronca i contenuti lunghi e tiene solo gli ultimi N turni', () => {
    const long = sanitizeHistory([{ role: 'user', content: 'x'.repeat(CHAT_MESSAGE_MAX_CHARS + 50) }]);
    expect(long[0].content).toHaveLength(CHAT_MESSAGE_MAX_CHARS);

    const many = sanitizeHistory(
      Array.from({ length: CHAT_HISTORY_MAX_MESSAGES + 10 }, (_, i) => ({
        role: 'user',
        content: `msg ${i}`,
      })),
    );
    expect(many).toHaveLength(CHAT_HISTORY_MAX_MESSAGES);
    expect(many[0].content).toBe('msg 10');
  });
});
