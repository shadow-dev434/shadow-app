import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock di closeReview() PRIMA degli import che lo usano. Pattern Slice 7:
// vi.mock factory locale (convenzione "regola due non uno"). closeReview e'
// l'helper transazionale 5-step in src/lib/evening-review/close-review.ts —
// gia' unit-testato in close-review.test.ts. Qui lo stubbiamo per testare
// il wiring orchestrazionale del handler (fallback mood, aggregazione args,
// pass-through reviewId/dailyPlanId/alreadyClosed).
vi.mock('@/lib/evening-review/close-review', () => ({
  closeReview: vi.fn(),
}));

// Slice 9: stub del ricalcolo fill ratio (testato in calibration.test.ts).
// Qui verifichiamo solo il wiring fail-open post-chiusura.
vi.mock('@/lib/evening-review/calibration', () => ({
  recalibrateFillRatio: vi.fn(),
}));

import { closeReview } from '@/lib/evening-review/close-review';
import { recalibrateFillRatio } from '@/lib/evening-review/calibration';
import {
  handleConfirmCloseReview,
  type HandleConfirmCloseReviewInput,
} from './confirm-close-review-handler';
import {
  EMPTY_PREVIEW_STATE,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import type {
  BuildDailyPlanPreviewInput,
  CandidateTaskInput,
} from '@/lib/evening-review/plan-preview';
import type { SlotName } from '@/lib/evening-review/slot-allocation';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';
import { MOOD_INTAKE_FALLBACK_VALUE } from '@/lib/evening-review/config';

beforeEach(() => {
  vi.clearAllMocks();
  // Default closeReview() mock: success new close (alreadyClosed=false).
  vi.mocked(closeReview).mockResolvedValue({
    ok: true,
    reviewId: 'review-mock',
    dailyPlanId: 'plan-mock',
    alreadyClosed: false,
  });
  // Default recalibrate mock: no-op riuscito (dataset insufficiente).
  vi.mocked(recalibrateFillRatio).mockResolvedValue({
    updated: false,
    reason: 'insufficient_data',
  });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-05-14T20:00:00.000Z',
    clientDate: '2026-05-14',
    outcomes: {},
    ...overrides,
  };
}

function makeBaseInput(
  overrides: Partial<BuildDailyPlanPreviewInput> = {},
): BuildDailyPlanPreviewInput {
  const candidate: CandidateTaskInput = {
    taskId: 't1',
    title: 'Bolletta luce',
    size: 3,
    priorityScore: 50,
    deadline: null,
  };
  return {
    candidateTasks: [candidate],
    profile: {
      optimalSessionLength: 25,
      shameFrustrationSensitivity: 3,
      bestTimeWindows: [] as SlotName[],
    },
    settings: { wakeTime: '07:00', sleepTime: '23:00' },
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<HandleConfirmCloseReviewInput> = {},
): HandleConfirmCloseReviewInput {
  return {
    userId: 'user1',
    threadId: 'thread1',
    currentPhase: 'closing',
    triageState: makeTriageState(),
    previewState: EMPTY_PREVIEW_STATE,
    baseInput: makeBaseInput(),
    clientDate: '2026-05-14',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('handleConfirmCloseReview — phase guard', () => {
  it('closing -> ok=true, closeReview chiamato', async () => {
    const r = await handleConfirmCloseReview(makeInput({ currentPhase: 'closing' }));
    expect(r.ok).toBe(true);
    expect(closeReview).toHaveBeenCalledOnce();
  });

  it('per_entry -> ok=false, error "non disponibile in fase per_entry", no closeReview call', async () => {
    const r = await handleConfirmCloseReview(makeInput({ currentPhase: 'per_entry' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('per_entry');
    expect(closeReview).not.toHaveBeenCalled();
  });

  it('plan_preview -> ok=false, error "plan_preview", no closeReview call', async () => {
    const r = await handleConfirmCloseReview(makeInput({ currentPhase: 'plan_preview' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('plan_preview');
    expect(closeReview).not.toHaveBeenCalled();
  });

  it('undefined -> ok=false, error "undefined", no closeReview call', async () => {
    const r = await handleConfirmCloseReview(makeInput({ currentPhase: undefined }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('undefined');
    expect(closeReview).not.toHaveBeenCalled();
  });
});

describe('handleConfirmCloseReview — scenario 3 brief: fallback mood D1', () => {
  it('triageState.moodIntake undefined -> closeReview riceve mood=3, energyEnd=3 (MOOD_INTAKE_FALLBACK_VALUE)', async () => {
    await handleConfirmCloseReview(
      makeInput({ triageState: makeTriageState({ moodIntake: undefined }) }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.mood).toBe(MOOD_INTAKE_FALLBACK_VALUE);
    expect(call.energyEnd).toBe(MOOD_INTAKE_FALLBACK_VALUE);
    expect(MOOD_INTAKE_FALLBACK_VALUE).toBe(3); // sanity check sulla constante
  });

  it('triageState.moodIntake = {mood:4, energyEnd:4} -> closeReview riceve mood=4, energyEnd=4', async () => {
    await handleConfirmCloseReview(
      makeInput({
        triageState: makeTriageState({
          moodIntake: { mood: 4, energyEnd: 4 },
        }),
      }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.mood).toBe(4);
    expect(call.energyEnd).toBe(4);
  });

  it('triageState.moodIntake = {mood:2, energyEnd:2} -> closeReview riceve mood=2, energyEnd=2', async () => {
    await handleConfirmCloseReview(
      makeInput({
        triageState: makeTriageState({
          moodIntake: { mood: 2, energyEnd: 2 },
        }),
      }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.mood).toBe(2);
    expect(call.energyEnd).toBe(2);
  });

  it('Bug #8 split: triageState.moodIntake = {mood:4, energyEnd:2} -> closeReview riceve mood=4, energyEnd=2 (valori distinti)', async () => {
    await handleConfirmCloseReview(
      makeInput({
        triageState: makeTriageState({
          moodIntake: { mood: 4, energyEnd: 2 },
        }),
      }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.mood).toBe(4);
    expect(call.energyEnd).toBe(2);
  });
});

describe('handleConfirmCloseReview — whatBlocked pass-through', () => {
  it('triageState.whatBlocked stringa -> closeReview riceve verbatim', async () => {
    const aggregated =
      '— Bolletta luce: troppo aperto\n\n— Email avvocato: ansia';
    await handleConfirmCloseReview(
      makeInput({ triageState: makeTriageState({ whatBlocked: aggregated }) }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.whatBlocked).toBe(aggregated);
  });

  it('triageState.whatBlocked undefined -> closeReview riceve "" (empty string)', async () => {
    await handleConfirmCloseReview(
      makeInput({ triageState: makeTriageState({ whatBlocked: undefined }) }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.whatBlocked).toBe('');
  });
});

describe('handleConfirmCloseReview — date wiring', () => {
  it('clientDate -> reviewDate identico', async () => {
    await handleConfirmCloseReview(makeInput({ clientDate: '2026-05-14' }));
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.reviewDate).toBe('2026-05-14');
  });

  it('clientDate -> planDate = clientDate + 1 giorno', async () => {
    await handleConfirmCloseReview(makeInput({ clientDate: '2026-05-14' }));
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.planDate).toBe('2026-05-15');
  });

  it('clientDate fine mese -> planDate rolla al mese successivo', async () => {
    await handleConfirmCloseReview(makeInput({ clientDate: '2026-05-31' }));
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.planDate).toBe('2026-06-01');
  });
});

describe('handleConfirmCloseReview — preview + pinned wiring', () => {
  it('previewState.pinnedTaskIds -> closeReview riceve verbatim', async () => {
    const previewState: PreviewState = {
      ...EMPTY_PREVIEW_STATE,
      pinnedTaskIds: ['t1', 't2'],
    };
    await handleConfirmCloseReview(makeInput({ previewState }));
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.pinnedTaskIds).toEqual(['t1', 't2']);
  });

  it('userId + threadId pass-through', async () => {
    await handleConfirmCloseReview(
      makeInput({ userId: 'u-special', threadId: 'thr-special' }),
    );
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.userId).toBe('u-special');
    expect(call.threadId).toBe('thr-special');
  });

  it('preview costruito da applyPreviewOverrides + buildDailyPlanPreview', async () => {
    // Test che closeReview riceva un preview shape valido (non null/undefined).
    // La logica di build e' testata in plan-preview.test.ts / apply-overrides.test.ts,
    // qui verifichiamo solo il wiring.
    await handleConfirmCloseReview(makeInput());
    const call = vi.mocked(closeReview).mock.calls[0][0];
    expect(call.preview).toBeDefined();
    expect(call.preview).toHaveProperty('morning');
    expect(call.preview).toHaveProperty('afternoon');
    expect(call.preview).toHaveProperty('evening');
    expect(call.preview).toHaveProperty('fillEstimate');
  });
});

describe('handleConfirmCloseReview — closeReview result pass-through', () => {
  it('closeReview success new -> return ok=true con reviewId/dailyPlanId/alreadyClosed=false', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: true,
      reviewId: 'rev-A',
      dailyPlanId: 'plan-A',
      alreadyClosed: false,
    });
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewId).toBe('rev-A');
    expect(r.dailyPlanId).toBe('plan-A');
    expect(r.alreadyClosed).toBe(false);
  });

  it('closeReview success alreadyClosed=true (idempotenza) -> return ok=true con alreadyClosed=true', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: true,
      reviewId: 'rev-existing',
      dailyPlanId: 'plan-existing',
      alreadyClosed: true,
    });
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewId).toBe('rev-existing');
    expect(r.dailyPlanId).toBe('plan-existing');
    expect(r.alreadyClosed).toBe(true);
  });

  it('closeReview failure thread_missing -> return ok=false con error formattato', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: false,
      error: 'thread_missing',
    });
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('chiusura review fallita');
    expect(r.error).toContain('thread_missing');
  });

  it('closeReview failure validation_failed con detail -> error include detail', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: false,
      error: 'validation_failed',
      detail: 'thread userId mismatch',
    });
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('validation_failed');
    expect(r.error).toContain('thread userId mismatch');
  });
});

// ─── Slice 9: ricalcolo fill ratio post-chiusura (D1, fail-open) ───────────

describe('handleConfirmCloseReview — ricalcolo calibrazione (Slice 9)', () => {
  it('chiusura ok -> recalibrateFillRatio invocato con userId + reviewDate', async () => {
    await handleConfirmCloseReview(
      makeInput({ userId: 'u-cal', clientDate: '2026-05-14' }),
    );
    expect(recalibrateFillRatio).toHaveBeenCalledTimes(1);
    expect(recalibrateFillRatio).toHaveBeenCalledWith('u-cal', '2026-05-14');
  });

  it('chiusura alreadyClosed=true -> ricalcolo invocato comunque (idempotente)', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: true,
      reviewId: 'rev-existing',
      dailyPlanId: 'plan-existing',
      alreadyClosed: true,
    });
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(true);
    expect(recalibrateFillRatio).toHaveBeenCalledTimes(1);
  });

  it('chiusura fallita -> NESSUN ricalcolo', async () => {
    vi.mocked(closeReview).mockResolvedValue({
      ok: false,
      error: 'thread_missing',
    });
    await handleConfirmCloseReview(makeInput());
    expect(recalibrateFillRatio).not.toHaveBeenCalled();
  });

  it('guard di fase fallito -> NESSUN ricalcolo', async () => {
    await handleConfirmCloseReview(makeInput({ currentPhase: 'per_entry' }));
    expect(recalibrateFillRatio).not.toHaveBeenCalled();
  });

  it('fail-open: ricalcolo che throwa NON degrada la chiusura', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(recalibrateFillRatio).mockRejectedValue(
      new Error('calibration exploded'),
    );
    const r = await handleConfirmCloseReview(makeInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewId).toBe('review-mock');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
