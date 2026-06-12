import { describe, it, expect } from 'vitest';
import { buildCheckinUserMessage, type CheckinContext } from './checkin';

const ctx = (over: Partial<CheckinContext> = {}): CheckinContext => ({
  taskTitle: 'Scrivere la relazione',
  currentStepText: 'Apri il documento',
  nextStepText: 'Scrivi 2 frasi',
  stepsDone: 1,
  stepsTotal: 4,
  minutesElapsed: 12,
  plannedMinutes: 25,
  lastOutcome: 'none',
  trigger: 'interval',
  ...over,
});

describe('buildCheckinUserMessage', () => {
  it('include task, progresso step e minuti', () => {
    const msg = buildCheckinUserMessage(ctx());
    expect(msg).toContain('Task: Scrivere la relazione');
    expect(msg).toContain('Micro-step fatti: 1/4');
    expect(msg).toContain('Passo corrente: Apri il documento');
    expect(msg).toContain('Passo successivo: Scrivi 2 frasi');
    expect(msg).toContain('Minuti trascorsi: 12 su 25 pianificati');
  });

  it('senza micro-step dichiara che non ce ne sono', () => {
    const msg = buildCheckinUserMessage(
      ctx({ stepsTotal: 0, stepsDone: 0, currentStepText: null, nextStepText: null }),
    );
    expect(msg).toContain('Micro-step: nessuno definito');
    expect(msg).not.toContain('Passo corrente');
  });

  it('tutti gli step fatti → corrente "(tutti completati)"', () => {
    const msg = buildCheckinUserMessage(ctx({ stepsDone: 4, currentStepText: null, nextStepText: null }));
    expect(msg).toContain('Passo corrente: (tutti completati)');
  });

  it('session_start non riporta l\'esito del check-in precedente', () => {
    const msg = buildCheckinUserMessage(ctx({ trigger: 'session_start', lastOutcome: 'ok' }));
    expect(msg).not.toContain('ultimo check-in');
    expect(msg).toContain('Inizio sessione');
  });

  it('lastOutcome stuck → direttiva sul blocco', () => {
    const msg = buildCheckinUserMessage(ctx({ lastOutcome: 'stuck' }));
    expect(msg).toContain('BLOCCATO');
  });

  it('step_done → direttiva di riconoscimento concreto', () => {
    const msg = buildCheckinUserMessage(ctx({ trigger: 'step_done' }));
    expect(msg).toContain('appena stato completato');
  });
});
