import { describe, expect, it } from 'vitest';
import { computeBetaStatus } from './feedback-status';

const base = {
  clientDate: '2026-06-20',
  inEveningWindow: true,
  pulseDoneToday: false,
  weeklyDone: false,
  anchorYMD: '2026-06-10',
  preCompleted: true,
  postCompleted: false,
};

describe('computeBetaStatus', () => {
  it('pulse dovuto in finestra serale se non ancora fatto oggi', () => {
    const s = computeBetaStatus({ ...base });
    expect(s.pulseDue).toBe(true);
  });

  it('pulse non dovuto fuori finestra', () => {
    const s = computeBetaStatus({ ...base, inEveningWindow: false });
    expect(s.pulseDue).toBe(false);
  });

  it('pulse non dovuto se già fatto oggi', () => {
    const s = computeBetaStatus({ ...base, pulseDoneToday: true });
    expect(s.pulseDue).toBe(false);
  });

  it('betaDay è 1-based rispetto all anchor', () => {
    const s = computeBetaStatus({ ...base, clientDate: '2026-06-10' });
    expect(s.betaDay).toBe(1);
    const s2 = computeBetaStatus({ ...base, clientDate: '2026-06-20' });
    expect(s2.betaDay).toBe(11);
  });

  it('senza anchor: betaDay null, weekly e post mai dovuti', () => {
    const s = computeBetaStatus({
      ...base,
      anchorYMD: null,
      preCompleted: true,
    });
    expect(s.betaDay).toBeNull();
    expect(s.weeklyDue).toBe(false);
    expect(s.assessmentDue).toBeNull();
  });

  it('weekly dovuto da delta >= 7 e solo se mai fatto', () => {
    const d6 = computeBetaStatus({ ...base, clientDate: '2026-06-16' });
    expect(d6.weeklyDue).toBe(false);
    const d7 = computeBetaStatus({ ...base, clientDate: '2026-06-17' });
    expect(d7.weeklyDue).toBe(true);
    const done = computeBetaStatus({
      ...base,
      clientDate: '2026-06-17',
      weeklyDone: true,
    });
    expect(done.weeklyDue).toBe(false);
  });

  it('pre dovuto finché non completato, anche oltre i 14 giorni', () => {
    const s = computeBetaStatus({
      ...base,
      clientDate: '2026-07-10',
      preCompleted: false,
    });
    expect(s.assessmentDue).toBe('pre');
  });

  it('post dovuto solo da delta >= 14 con pre completato', () => {
    const d13 = computeBetaStatus({ ...base, clientDate: '2026-06-23' });
    expect(d13.assessmentDue).toBeNull();
    const d14 = computeBetaStatus({ ...base, clientDate: '2026-06-24' });
    expect(d14.assessmentDue).toBe('post');
    const done = computeBetaStatus({
      ...base,
      clientDate: '2026-06-24',
      postCompleted: true,
    });
    expect(done.assessmentDue).toBeNull();
  });

  it('attraversa i rollover di mese senza errori', () => {
    const s = computeBetaStatus({
      ...base,
      anchorYMD: '2026-05-25',
      clientDate: '2026-06-08',
    });
    expect(s.betaDay).toBe(15);
    expect(s.assessmentDue).toBe('post');
  });
});
