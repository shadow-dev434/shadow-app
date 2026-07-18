import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleQuickAction,
  resetQuickActionDedupe,
  type NativeQuickAction,
} from './quick-action';

describe('handleQuickAction', () => {
  beforeEach(() => resetQuickActionDedupe());

  it("'inbox' naviga alla chat con input focalizzato", () => {
    const nav = vi.fn();
    const ok = handleQuickAction({ id: '1', action: 'inbox' }, nav);
    expect(ok).toBe(true);
    expect(nav).toHaveBeenCalledWith('/?action=inbox');
  });

  it("'voice' naviga all'inbox con capture=voice", () => {
    const nav = vi.fn();
    handleQuickAction({ id: '2', action: 'voice' }, nav);
    expect(nav).toHaveBeenCalledWith('/tasks?view=inbox&capture=voice');
  });

  it('dedupe per id: la stessa azione da pending + evento naviga una volta sola', () => {
    const nav = vi.fn();
    handleQuickAction({ id: 'dup', action: 'inbox' }, nav);
    handleQuickAction({ id: 'dup', action: 'inbox' }, nav);
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it('id diversi navigano entrambi', () => {
    const nav = vi.fn();
    handleQuickAction({ id: 'a', action: 'inbox' }, nav);
    handleQuickAction({ id: 'b', action: 'voice' }, nav);
    expect(nav).toHaveBeenCalledTimes(2);
  });

  it('payload malformato o azione ignota → false, nessuna navigazione', () => {
    const nav = vi.fn();
    expect(handleQuickAction(null as unknown as NativeQuickAction, nav)).toBe(false);
    expect(handleQuickAction({ id: 'x', action: 'boh' as 'inbox' }, nav)).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
});
