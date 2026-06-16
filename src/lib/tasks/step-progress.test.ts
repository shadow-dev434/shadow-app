import { describe, it, expect } from 'vitest';
import { stepProgressFromJson } from './step-progress';

describe('stepProgressFromJson', () => {
  it('returns null when there are no micro-steps', () => {
    expect(stepProgressFromJson('[]')).toBeNull();
    expect(stepProgressFromJson('')).toBeNull();
  });

  it('returns null when steps exist but none are done', () => {
    const json = JSON.stringify([
      { id: 'a', text: 'uno', done: false },
      { id: 'b', text: 'due', done: false },
    ]);
    expect(stepProgressFromJson(json)).toBeNull();
  });

  it('returns done/total for a partially-completed task (the body-doubling case)', () => {
    const json = JSON.stringify([
      { id: 'a', text: 'uno', done: true },
      { id: 'b', text: 'due', done: false },
      { id: 'c', text: 'tre', done: false },
    ]);
    expect(stepProgressFromJson(json)).toEqual({ done: 1, total: 3 });
  });

  it('returns done===total when every step is done', () => {
    const json = JSON.stringify([
      { id: 'a', text: 'uno', done: true },
      { id: 'b', text: 'due', done: true },
    ]);
    expect(stepProgressFromJson(json)).toEqual({ done: 2, total: 2 });
  });

  it('treats missing/non-boolean done as not done', () => {
    const json = JSON.stringify([
      { id: 'a', text: 'uno' },
      { id: 'b', text: 'due', done: true },
    ]);
    expect(stepProgressFromJson(json)).toEqual({ done: 1, total: 2 });
  });

  it('returns null for malformed JSON', () => {
    expect(stepProgressFromJson('not json')).toBeNull();
    expect(stepProgressFromJson('{"not":"an array"}')).toBeNull();
  });
});
