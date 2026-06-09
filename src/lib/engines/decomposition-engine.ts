// Shadow — AI Task Decomposition Engine
// GLM/Z.ai rimosso (2026-06-09): decomposizione su euristiche rule-based in-house.

import type { MicroStep, ExecutionContext, UserProfile } from '@/lib/types/shadow';

// ── Decomposition entry point (rule-based) ──────────────────────────────

export async function decomposeWithAI(
  taskTitle: string,
  taskDescription: string,
  ctx: ExecutionContext,
  userProfile?: UserProfile | null
): Promise<{ steps: MicroStep[]; raw: string }> {
  // GLM rimosso: decomposizione rule-based (era il ramo fallback, ora unico).
  // raw='[fallback]' preserva il source-detection di /api/decompose (route:47).
  const steps = fallbackDecomposition(taskTitle, ctx, userProfile);
  return { steps, raw: '[fallback]' };
}

// ── Fallback Rule-Based Decomposition ───────────────────────────────────

export function fallbackDecomposition(
  taskTitle: string,
  ctx: ExecutionContext,
  userProfile?: UserProfile | null
): MicroStep[] {
  const lower = taskTitle.toLowerCase();

  // Pattern-based decomposition for common task types
  if (lower.includes('scriv') || lower.includes('write') || lower.includes('tesi') || lower.includes('article') || lower.includes('report')) {
    return applyProfileToSteps(writingDecomposition(taskTitle, ctx), userProfile);
  }
  if (lower.includes('fattur') || lower.includes('invoic') || lower.includes('contabilit') || lower.includes('contabilità')) {
    return applyProfileToSteps(adminDecomposition(taskTitle, ctx), userProfile);
  }
  if (lower.includes('studi') || lower.includes('stud') || lower.includes('legg') || lower.includes('read') || lower.includes('impar')) {
    return applyProfileToSteps(studyDecomposition(taskTitle, ctx, userProfile), userProfile);
  }
  if (lower.includes('pul') || lower.includes('clean') || lower.includes('ordina') || lower.includes('casa') || lower.includes('cucina') || lower.includes('bagno')) {
    return applyProfileToSteps(cleaningDecomposition(taskTitle, ctx), userProfile);
  }
  if (lower.includes('email') || lower.includes('mail') || lower.includes('messagg')) {
    return applyProfileToSteps(emailDecomposition(taskTitle, ctx), userProfile);
  }
  if (lower.includes('chiam') || lower.includes('call') || lower.includes('telefon')) {
    return applyProfileToSteps(callDecomposition(taskTitle, ctx), userProfile);
  }

  // Generic decomposition
  return applyProfileToSteps(genericDecomposition(taskTitle, ctx), userProfile);
}

function writingDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  const energyFactor = ctx.energy <= 2 ? 0.5 : 1;
  return [
    { id: crypto.randomUUID(), text: 'Apri il documento/file', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Scrivi 3 punti chiave come bullet', done: false, estimatedSeconds: Math.round(120 * energyFactor) },
    { id: crypto.randomUUID(), text: 'Scegli il punto più facile', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Scrivi 2 frasi su quel punto', done: false, estimatedSeconds: Math.round(180 * energyFactor) },
  ];
}

function adminDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  return [
    { id: crypto.randomUUID(), text: 'Apri il gestionale/software', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Individua il primo elemento da processare', done: false, estimatedSeconds: 60 },
    { id: crypto.randomUUID(), text: 'Compila i dati del primo elemento', done: false, estimatedSeconds: 120 },
  ];
}

function studyDecomposition(title: string, ctx: ExecutionContext, userProfile?: UserProfile | null): MicroStep[] {
  const energyFactor = ctx.energy <= 2 ? 0.5 : 1;
  const isStudent = userProfile?.role === 'student';
  const steps: MicroStep[] = [
    { id: crypto.randomUUID(), text: 'Apri il materiale di studio', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Leggi solo il primo paragrafo', done: false, estimatedSeconds: Math.round(90 * energyFactor) },
  ];
  if (isStudent) {
    // More granular cognitive steps for students
    steps.push({ id: crypto.randomUUID(), text: 'Sottolinea o evidenzia i concetti chiave del paragrafo', done: false, estimatedSeconds: Math.round(45 * energyFactor) });
    steps.push({ id: crypto.randomUUID(), text: 'Scrivi 1 frase riassuntiva con parole tue', done: false, estimatedSeconds: Math.round(60 * energyFactor) });
    steps.push({ id: crypto.randomUUID(), text: 'Rileggi la frase e verifica che sia chiara', done: false, estimatedSeconds: Math.round(20 * energyFactor) });
  } else {
    steps.push({ id: crypto.randomUUID(), text: 'Scrivi 1 frase riassuntiva di quello che hai letto', done: false, estimatedSeconds: Math.round(60 * energyFactor) });
  }
  return steps;
}

function cleaningDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  return [
    { id: crypto.randomUUID(), text: 'Vai nello spazio da pulire', done: false, estimatedSeconds: 15 },
    { id: crypto.randomUUID(), text: 'Prendi 3 cose fuori posto e mettile a posto', done: false, estimatedSeconds: 120 },
    { id: crypto.randomUUID(), text: 'Pulisci una superficie piccola', done: false, estimatedSeconds: 120 },
  ];
}

function emailDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  return [
    { id: crypto.randomUUID(), text: 'Apri la posta/email', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Identifica la prima email da gestire', done: false, estimatedSeconds: 60 },
    { id: crypto.randomUUID(), text: 'Scrivi la risposta o fai l\'azione richiesta', done: false, estimatedSeconds: 180 },
  ];
}

function callDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  return [
    { id: crypto.randomUUID(), text: 'Scrivi su un foglio cosa devi dire/chiedere', done: false, estimatedSeconds: 60 },
    { id: crypto.randomUUID(), text: 'Trova il numero di telefono', done: false, estimatedSeconds: 30 },
    { id: crypto.randomUUID(), text: 'Fai la chiamata', done: false, estimatedSeconds: 180 },
  ];
}

function genericDecomposition(title: string, ctx: ExecutionContext): MicroStep[] {
  const energyFactor = ctx.energy <= 2 ? 0.5 : 1;
  return [
    {
      id: crypto.randomUUID(),
      text: `Apri/prepara quello che serve per "${title}"`,
      done: false,
      estimatedSeconds: 30,
    },
    {
      id: crypto.randomUUID(),
      text: `Fai la prima cosa più ovvia e semplice`,
      done: false,
      estimatedSeconds: Math.round(120 * energyFactor),
    },
    {
      id: crypto.randomUUID(),
      text: 'Fai un secondo piccolo passo',
      done: false,
      estimatedSeconds: Math.round(120 * energyFactor),
    },
  ];
}

// ── Profile-Aware Step Adjustment ────────────────────────────────────────

function applyProfileToSteps(steps: MicroStep[], userProfile?: UserProfile | null): MicroStep[] {
  if (!userProfile) return steps;

  let adjusted = steps.map((step) => {
    let sec = step.estimatedSeconds;

    // Children = shorter, interruptible steps
    if (userProfile.hasChildren) {
      sec = Math.max(15, Math.round(sec / 2));
    }

    return { ...step, estimatedSeconds: sec };
  });

  // High cognitive load = add a preparation step at the beginning
  if (userProfile.cognitiveLoad >= 4) {
    const hasPrepStep = adjusted[0]?.text.toLowerCase().includes('apri') ||
                        adjusted[0]?.text.toLowerCase().includes('prepara');
    if (!hasPrepStep) {
      adjusted = [
        {
          id: crypto.randomUUID(),
          text: 'Prepara lo spazio di lavoro (chiudi distrazioni, apri ciò che serve)',
          done: false,
          estimatedSeconds: 30,
        },
        ...adjusted,
      ];
    }
  }

  // Cap at 8 steps
  return adjusted.slice(0, 8);
}
