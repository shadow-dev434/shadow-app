import { describe, it, expect } from 'vitest';
import { buildSystemPromptParts, BODY_DOUBLE_OFFER_PROMPT } from './prompts';

// Task 51 (D8): il blocco "quando offrire body doubling" è iniettato da
// getModePrompt SOLO in general/planning/focus_companion (non morning_checkin —
// zona Sessione A — né evening_review/unblock). Lock di regressione sul wiring,
// così un futuro refactor di getModePrompt non sgancia (o spande) l'offerta.
describe('prompts: BODY_DOUBLE_OFFER_PROMPT wiring (Task 51)', () => {
  const injected = (mode: string) =>
    buildSystemPromptParts(mode, 'ctx').staticPrefix.includes(BODY_DOUBLE_OFFER_PROMPT);

  it('iniettato in general / planning / focus_companion', () => {
    for (const mode of ['general', 'planning', 'focus_companion']) {
      expect(injected(mode)).toBe(true);
    }
  });

  it('NON iniettato in morning_checkin (prompt di A), unblock, evening_review', () => {
    for (const mode of ['morning_checkin', 'unblock', 'evening_review']) {
      expect(injected(mode)).toBe(false);
    }
  });
});
