import { describe, it, expect } from 'vitest';
import {
  shouldForceToolChoice,
  clearConsumedAtRiskFlags,
  shouldSetTextOnlyFlag,
} from './at-risk-detection';
import type { TriageState } from '@/lib/evening-review/triage';
import type { ChatMode } from './orchestrator';

/**
 * Factory minimale per TriageState: campi obbligatori del tipo + override.
 * I 3 predicate testati qui leggono questi sottoinsiemi:
 *  - shouldForceToolChoice: firstTurnAfterResume, selfCorrectedInPreviousTurn,
 *    lastTurnWasTextOnly.
 *  - clearConsumedAtRiskFlags: selfCorrectedInPreviousTurn, lastTurnWasTextOnly.
 *  - shouldSetTextOnlyFlag: lastTurnWasTextOnly (per idempotenza).
 * Gli altri campi obbligatori sono placeholder neutri.
 */
function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-05-20T00:00:00.000Z',
    clientDate: '2026-05-20',
    ...overrides,
  };
}

describe('shouldForceToolChoice', () => {
  it('mode != evening_review -> false (anche con tutti i flag at-risk true)', () => {
    const state = makeTriageState({
      firstTurnAfterResume: true,
      selfCorrectedInPreviousTurn: true,
      lastTurnWasTextOnly: true,
    });
    const modes: ChatMode[] = [
      'morning_checkin',
      'planning',
      'focus_companion',
      'unblock',
      'general',
    ];
    for (const m of modes) {
      expect(shouldForceToolChoice(state, m)).toBe(false);
    }
  });

  it('triageState null -> false (anche su evening_review)', () => {
    expect(shouldForceToolChoice(null, 'evening_review')).toBe(false);
  });

  it('evening_review + firstTurnAfterResume=true (V1.2.2 trigger) -> true', () => {
    const state = makeTriageState({ firstTurnAfterResume: true });
    expect(shouldForceToolChoice(state, 'evening_review')).toBe(true);
  });

  it('evening_review + selfCorrectedInPreviousTurn=true (V1.3 trigger) -> true', () => {
    const state = makeTriageState({ selfCorrectedInPreviousTurn: true });
    expect(shouldForceToolChoice(state, 'evening_review')).toBe(true);
  });

  it('evening_review + lastTurnWasTextOnly=true (V1.3.2 trigger) -> true', () => {
    const state = makeTriageState({ lastTurnWasTextOnly: true });
    expect(shouldForceToolChoice(state, 'evening_review')).toBe(true);
  });

  it('evening_review + tutti 3 flag undefined -> false (triple === true rispettato)', () => {
    // Caratterizza la cicatrice "triple === true" su flag opzionali boolean:
    // undefined non e' === true. NON rilassare a truthy check.
    const state = makeTriageState({});
    expect(shouldForceToolChoice(state, 'evening_review')).toBe(false);
  });

  it('evening_review + tutti 3 flag esplicitamente false -> false', () => {
    const state = makeTriageState({
      firstTurnAfterResume: false,
      selfCorrectedInPreviousTurn: false,
      lastTurnWasTextOnly: false,
    });
    expect(shouldForceToolChoice(state, 'evening_review')).toBe(false);
  });
});

describe('clearConsumedAtRiskFlags', () => {
  it('triageState null -> { next: null, entrambi clearedX false }', () => {
    expect(clearConsumedAtRiskFlags(null)).toEqual({
      next: null,
      clearedSelfCorrected: false,
      clearedLastTurnText: false,
    });
  });

  it('entrambi flag absent (undefined) -> next equivalente, no clear marcato', () => {
    const state = makeTriageState({});
    const result = clearConsumedAtRiskFlags(state);
    expect(result.clearedSelfCorrected).toBe(false);
    expect(result.clearedLastTurnText).toBe(false);
    expect(result.next).toEqual(state);
  });

  it('solo selfCorrectedInPreviousTurn=true -> clear su quello solo', () => {
    const state = makeTriageState({ selfCorrectedInPreviousTurn: true });
    const result = clearConsumedAtRiskFlags(state);
    expect(result.clearedSelfCorrected).toBe(true);
    expect(result.clearedLastTurnText).toBe(false);
    expect(result.next?.selfCorrectedInPreviousTurn).toBe(false);
    expect(result.next?.lastTurnWasTextOnly).toBeUndefined();
  });

  it('solo lastTurnWasTextOnly=true -> clear su quello solo', () => {
    const state = makeTriageState({ lastTurnWasTextOnly: true });
    const result = clearConsumedAtRiskFlags(state);
    expect(result.clearedSelfCorrected).toBe(false);
    expect(result.clearedLastTurnText).toBe(true);
    expect(result.next?.selfCorrectedInPreviousTurn).toBeUndefined();
    expect(result.next?.lastTurnWasTextOnly).toBe(false);
  });

  it("entrambi true -> entrambi clearati, immutabilita' dell'input preservata", () => {
    const state = makeTriageState({
      selfCorrectedInPreviousTurn: true,
      lastTurnWasTextOnly: true,
    });
    // Snapshot pre-call per assert immutabilita'.
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const result = clearConsumedAtRiskFlags(state);
    expect(result.clearedSelfCorrected).toBe(true);
    expect(result.clearedLastTurnText).toBe(true);
    expect(result.next?.selfCorrectedInPreviousTurn).toBe(false);
    expect(result.next?.lastTurnWasTextOnly).toBe(false);
    // Immutabilita': l'input originale NON e' stato mutato.
    expect(state).toEqual(stateSnapshot);
  });
});

describe('shouldSetTextOnlyFlag', () => {
  // Args di default = predicate fires (true). Ogni test override il singolo
  // componente sotto esame.
  function makeArgs(
    overrides: Partial<{
      mode: ChatMode;
      pendingTriageState: TriageState | null;
      effectivePhase: 'per_entry' | 'plan_preview' | 'closing' | undefined;
      toolsExecutedCount: number;
    }> = {},
  ) {
    return {
      mode: 'evening_review' as ChatMode,
      pendingTriageState: makeTriageState({}),
      effectivePhase: 'per_entry' as const,
      toolsExecutedCount: 0,
      ...overrides,
    };
  }

  it('mode != evening_review -> false (anche con altri 4 componenti soddisfatti)', () => {
    expect(shouldSetTextOnlyFlag(makeArgs({ mode: 'morning_checkin' }))).toBe(false);
  });

  it('pendingTriageState null -> false', () => {
    expect(shouldSetTextOnlyFlag(makeArgs({ pendingTriageState: null }))).toBe(false);
  });

  it('effectivePhase in non-per_entry (plan_preview, closing, undefined) -> false', () => {
    for (const phase of ['plan_preview', 'closing', undefined] as const) {
      expect(shouldSetTextOnlyFlag(makeArgs({ effectivePhase: phase }))).toBe(false);
    }
  });

  it('toolsExecutedCount > 0 -> false (modello ha chiamato tool, non e\' text-only)', () => {
    expect(shouldSetTextOnlyFlag(makeArgs({ toolsExecutedCount: 1 }))).toBe(false);
  });

  it('lastTurnWasTextOnly gia\' === true -> false (cicatrice idempotenza V1.3.2)', () => {
    expect(
      shouldSetTextOnlyFlag(
        makeArgs({
          pendingTriageState: makeTriageState({ lastTurnWasTextOnly: true }),
        }),
      ),
    ).toBe(false);
  });

  it(
    "caratterizza Known Issue 2 V1.3.2: predicate fires su turno text-only in per_entry indipendentemente dallo stato del walk (bug aperto, NON regressione)",
    () => {
      // ANTI-TRAPPOLA per sessione futura:
      // Known Issue 2 V1.3.2 e' un bug APERTO documentato in deploy-notes
      // sezione "Known issue 2 -- V1.3.2 SET su turno 1 opening", rivalutato
      // come dannoso in deploy-notes sezione "Slice 7 V1.x -- sessione
      // 2026-05-16 Bug #1 + Bug #3" (riferimento "Strada A perEntryWalkStarted").
      //
      // La radice del bug e' la CECITA' del predicate attuale: legge solo
      // mode, pendingTriageState (e di quest'ultimo solo lastTurnWasTextOnly
      // per idempotenza), effectivePhase, toolsExecutedCount. NON legge
      // currentEntryId ne' outcomes. Quindi NON distingue il turno 1 opening
      // (text-only by design, walk non ancora iniziato: currentEntryId=null
      // o undefined + outcomes vuoti) da un turno N text-only patologico
      // (walk in corso ma modello ignora i tool).
      //
      // Strada A aggiungera' un sesto componente al predicate, un derivato
      // tipo `perEntryWalkStarted = currentEntryId !== null || outcomes
      // non vuoti`, che esclude il turno 1 opening dal SET. Quando la fix
      // sara' applicata, questo test FALLIRA' come segnale ATTESO del fix:
      // gli stessi args minimi (walk non iniziato) NON faranno piu'
      // ritornare true. Aggiornare questo test come parte del fix
      // Strada A, NON ripristinare il comportamento attuale.
      //
      // Comportamento ATTUALE caratterizzato (2026-05-20, commit Tech debt #18):
      // pendingTriageState con campi opzionali tutti default (currentEntryId
      // undefined, outcomes undefined = walk non iniziato) + altre 4
      // condizioni soddisfatte -> predicate fires.
      const result = shouldSetTextOnlyFlag(
        makeArgs({
          // currentEntryId, outcomes lasciati undefined nel makeTriageState.
          // Volutamente NON forniti come override per documentare che il
          // predicate attuale li ignora completamente.
          pendingTriageState: makeTriageState({}),
        }),
      );
      expect(result).toBe(true);
    },
  );
});
