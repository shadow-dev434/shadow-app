/**
 * Task 56 (fix beta body doubling): progresso micro-step di un task a partire
 * dal campo `microSteps` (JSON serializzato di MicroStep[]).
 *
 * Usato dalla schermata tasks per (1) tenere in inbox un task già pianificato ma
 * INIZIATO (almeno 1 step fatto, es. lasciato a metà in body doubling) finché
 * non è completato, e (2) il badge "completato X/Y step" in inbox e Today.
 *
 * Ritorna { done, total } solo se ci sono step e almeno uno è fatto; null
 * altrimenti (nessuno step, JSON malformato, o zero step completati) — così un
 * task senza progresso reale non viene mai trattenuto in inbox.
 */
export interface StepProgress {
  done: number;
  total: number;
}

export function stepProgressFromJson(microStepsJson: string): StepProgress | null {
  let steps: Array<{ done?: boolean }>;
  try {
    const parsed: unknown = JSON.parse(microStepsJson || '[]');
    steps = Array.isArray(parsed) ? (parsed as Array<{ done?: boolean }>) : [];
  } catch {
    return null;
  }
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s && s.done === true).length;
  return done > 0 ? { done, total: steps.length } : null;
}
