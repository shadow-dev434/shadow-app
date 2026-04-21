// Shadow — AI Task Decomposition Engine
// Uses z-ai-web-dev-sdk to break tasks into concrete, actionable micro-steps

import type { MicroStep, ExecutionContext, UserProfile, AdaptiveProfileData } from '@/lib/types/shadow';

// ── Prompt Templates ────────────────────────────────────────────────────

const DECOMPOSITION_SYSTEM_PROMPT = `Sei un motore di scomposizione compiti per adulti ADHD. Il tuo UNICO scopo è prendere un compito e spezzarlo in micro-passi CONCRETI e IMMEDIATAMENTE eseguibili.

REGOLE ASSOLUTE:
1. Usa SOLO verbi d'azione concreti: "apri", "scrivi", "clicca", "leggi", "lava", "prepara", "invia"
2. Ogni passo deve essere completabile in 1-5 minuti
3. ZERO linguaggio motivazionale — niente "puoi farcela", "forza", "coraggio"
4. ZERO spiegazioni o contesto — solo l'azione
5. ZERO astrazioni — niente "pianifica", "organizza", "pensa a"
6. MASSIMO 8 passi, MINIMO 2
7. Ogni passo deve essere una singola azione fisica o cognitiva semplice
8. Il primo passo deve essere il più banale possibile (es. "apri il file", "vai alla pagina")
9. Adatta la granularità all'energia dell'utente: meno energia = passi più piccoli
10. Adatta al tempo disponibile: meno tempo = meno passi, più focalizzati

FORMATO RICHIESTO:
Rispondi SOLO con un array JSON di oggetti, ogni oggetto ha:
- "text": il micro-step come frase imperativa
- "estimatedSeconds": tempo stimato in secondi (30-300)

NON aggiungere altro testo, spiegazioni, o formattazione. Solo l'array JSON.`;

function buildDecompositionPrompt(
  taskTitle: string,
  taskDescription: string,
  ctx: ExecutionContext,
  userProfile?: UserProfile | null,
  adaptiveProfile?: AdaptiveProfileData | null
): string {
  const adaptiveSection = adaptiveProfile
    ? `\nProfilo adattivo: stile prompt=${adaptiveProfile.preferredPromptStyle}, granularità=${adaptiveProfile.preferredDecompositionGranularity}/5, evitamento=${adaptiveProfile.avoidanceProfile.toFixed(1)}/5, vulnerabilità interruzioni=${adaptiveProfile.interruptionVulnerability.toFixed(1)}/5, sessione ottimale=${adaptiveProfile.optimalSessionLength}min`
    : '';

  return `Compito: "${taskTitle}"
${taskDescription ? `Dettagli: ${taskDescription}` : ''}

Energia utente: ${ctx.energy}/5
Tempo disponibile: ${ctx.timeAvailable} minuti
Contesto: ${ctx.currentContext}
Fascia oraria: ${ctx.currentTimeSlot}
${userProfile ? `\nProfilo utente: ${userProfile.executionStyle}. Carico cognitivo: ${userProfile.cognitiveLoad}/5. ${userProfile.lifeContext}` : ''}
${userProfile?.hasChildren ? "ATTENZIONE: l'utente ha figli = passi più brevi, interrompibili" : ''}
${userProfile?.difficultAreas && userProfile.difficultAreas.length > 0 ? `Aree difficili per l'utente: ${userProfile.difficultAreas.join(', ')}. Scomponi questi task in passi ancora più piccoli.` : ''}
${adaptiveSection}

Scomponi in micro-passi concreti e immediatamente eseguibili.`;
}

// ── AI Call ─────────────────────────────────────────────────────────────

export async function decomposeWithAI(
  taskTitle: string,
  taskDescription: string,
  ctx: ExecutionContext,
  userProfile?: UserProfile | null
): Promise<{ steps: MicroStep[]; raw: string }> {
  // Dynamic import to avoid client-side bundling
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();

  const prompt = buildDecompositionPrompt(taskTitle, taskDescription, ctx, userProfile);

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3, // Low temperature for consistent, focused output
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content || '[]';
    const steps = validateAndParseAIOutput(raw, taskTitle, ctx, userProfile);

    return { steps, raw };
  } catch (error) {
    console.error('AI decomposition failed:', error);
    // Fallback to rule-based decomposition
    const steps = fallbackDecomposition(taskTitle, ctx, userProfile);
    return { steps, raw: '[fallback]' };
  }
}

// ── Validation ──────────────────────────────────────────────────────────

const ABSTRACT_VERBS = [
  'pianifica', 'pianifica', 'organizza', 'pensare', 'pensa',
  'considera', 'valuta', 'analizza', 'rifletti', 'decidi',
  'progetta', 'esplora', 'rivedi', 'esamina', 'prepara un piano',
  'fai una lista', 'identifica', 'determina', 'definisci',
  'plan', 'organize', 'think', 'consider', 'analyze',
  'review', 'decide', 'design', 'explore', 'prepare a plan',
  'make a list', 'identify', 'determine', 'define',
];

const MOTIVATIONAL_PHRASES = [
  'puoi farcela', 'forza', 'coraggio', 'dai il massimo',
  'sei forte', 'credi in te', 'non arrenderti', 'continua così',
  'you can do it', 'believe in yourself', 'don\'t give up',
  'keep going', 'you got this', 'stay strong',
];

function isAbstractStep(text: string): boolean {
  const lower = text.toLowerCase();
  return ABSTRACT_VERBS.some((v) => lower.startsWith(v));
}

function hasMotivationalContent(text: string): boolean {
  const lower = text.toLowerCase();
  return MOTIVATIONAL_PHRASES.some((p) => lower.includes(p));
}

function validateAndParseAIOutput(
  raw: string,
  taskTitle: string,
  ctx: ExecutionContext,
  userProfile?: UserProfile | null
): MicroStep[] {
  // Try to parse JSON
  let parsed: Array<{ text?: string; estimatedSeconds?: number }>;
  try {
    // Extract JSON array from the response (might have markdown wrapping)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return fallbackDecomposition(taskTitle, ctx, userProfile);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return fallbackDecomposition(taskTitle, ctx, userProfile);
  }

  // Validate each step
  const validSteps: MicroStep[] = [];
  let hasAbstractOrInvalid = false;

  for (const item of parsed) {
    if (!item.text || typeof item.text !== 'string') {
      hasAbstractOrInvalid = true;
      continue;
    }

    // Check for abstract verbs
    if (isAbstractStep(item.text)) {
      hasAbstractOrInvalid = true;
      continue;
    }

    // Strip motivational content
    let cleanText = item.text;
    for (const phrase of MOTIVATIONAL_PHRASES) {
      cleanText = cleanText.replace(new RegExp(phrase, 'gi'), '').trim();
    }

    // Check step is not too long (should be a single action)
    if (cleanText.length > 120) {
      hasAbstractOrInvalid = true;
      continue;
    }

    // Clamp estimated seconds — profile-aware adjustment
    let seconds = Math.max(30, Math.min(300, item.estimatedSeconds || 120));
    if (userProfile?.hasChildren) {
      seconds = Math.max(15, Math.round(seconds / 2));
    }

    validSteps.push({
      id: crypto.randomUUID(),
      text: cleanText,
      done: false,
      estimatedSeconds: seconds,
    });
  }

  // If too many steps were invalid, use fallback
  if (validSteps.length < 2 || hasAbstractOrInvalid && validSteps.length < parsed.length * 0.5) {
    return fallbackDecomposition(taskTitle, ctx, userProfile);
  }

  // Cap at 8 steps; add preparation step if high cognitive load
  const finalSteps = validSteps.slice(0, 8);
  if (userProfile && userProfile.cognitiveLoad >= 4 && !finalSteps[0]?.text.toLowerCase().includes('apri') && !finalSteps[0]?.text.toLowerCase().includes('prepara')) {
    finalSteps.unshift({
      id: crypto.randomUUID(),
      text: 'Prepara lo spazio di lavoro (chiudi distrazioni, apri ciò che serve)',
      done: false,
      estimatedSeconds: 30,
    });
    // Re-cap at 8
    return finalSteps.slice(0, 8);
  }
  return finalSteps;
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

// ── Adaptive Decomposition Prompt Builder ───────────────────────────────

/**
 * buildAdaptiveDecompositionPrompt — creates a personalized AI prompt
 * for task decomposition based on the user's adaptive profile.
 *
 * Adapts tone, granularity, step size, and motivational framing
 * to the user's learned preferences and behavioral patterns.
 */
export function buildAdaptiveDecompositionPrompt(
  taskTitle: string,
  taskDescription: string,
  ctx: ExecutionContext,
  adaptiveProfile: AdaptiveProfileData
): { systemPrompt: string; userPrompt: string } {
  const promptStyle = adaptiveProfile.preferredPromptStyle;
  const granularity = adaptiveProfile.preferredDecompositionGranularity;
  const avoidance = adaptiveProfile.avoidanceProfile;
  const interruptionVuln = adaptiveProfile.interruptionVulnerability;
  const motivation = adaptiveProfile.motivationProfile;

  // ── Tone based on prompt style ──
  let toneInstructions = '';
  if (promptStyle === 'direct') {
    toneInstructions = `TONO: Imperativo, senza fronzoli. Ogni passo è un ordine preciso. Niente incoraggiamenti, niente "puoi farcela". Solo azioni concrete e dirette. Esempi: "Apri il file", "Scrivi 3 righe", "Invia l'email".`;
  } else if (promptStyle === 'gentle') {
    toneInstructions = `TONO: Morbido ma concreto. Usa formulazioni come "Prova a...", "Inizia con...", "Ora puoi...". Non essere saccarino, ma riconosci che iniziare è difficile. Ogni passo dovrebbe sembrare raggiungibile, non intimidatorio.`;
  } else if (promptStyle === 'challenge') {
    toneInstructions = `TONO: Sfida mini. Ogni passo è una mini-sfida superabile. Esempi: "Sfida: apri il file in 10 secondi", "Vedi se riesci a scrivere 3 righe prima del timer", "Ora prova a completare questo passo". Rendi ogni step una piccola vittoria.`;
  }

  // ── Granularity adjustments ──
  let granularityInstructions = '';
  if (granularity <= 2) {
    granularityInstructions = `GRANULARITÀ: Molto dettagliata. Ogni passo deve essere banalmente piccolo (30-90 secondi). Massimo 8 passi. Se un passo sembra complesso, scomponilo ulteriormente. Il primo passo deve essere quasi ridicolo nella sua semplicità.`;
  } else if (granularity >= 4) {
    granularityInstructions = `GRANULARITÀ: Breve e concisa. Passi più ampi (2-5 minuti ciascuno). Minimo 2 passi, massimo 5. Non over-scomporre — l'utente preferisce meno passi più sostanziosi.`;
  } else {
    granularityInstructions = `GRANULARITÀ: Standard. Ogni passo 1-3 minuti. 3-6 passi totali. Bilancia dettaglio e concisione.`;
  }

  // ── Avoidance profile adjustments ──
  let avoidanceInstructions = '';
  if (avoidance >= 4) {
    avoidanceInstructions = `EVITAMENTO ALTO: Il primo passo deve essere ASSURDAMENTE banale. Tipo "apri il browser" o "guarda lo schermo per 10 secondi". L'obiettivo è azzerare la barriera di ingresso. Riduci ogni passo alla sua componente più elementare. Aggiungi un "checkpoint mentale" dopo il primo passo.`;
  } else if (avoidance >= 3) {
    avoidanceInstructions = `EVITAMENTO MODERATO: Il primo passo deve essere molto semplice ma non banale. Tipo "apri il file/documento pertinente". Riduci un po' la complessità dei passi iniziali.`;
  }

  // ── Interruption vulnerability adjustments ──
  let interruptionInstructions = '';
  if (interruptionVuln >= 4) {
    interruptionInstructions = `VULNERABILITÀ INTERRUZIONI ALTA: Ogni passo deve essere completabile in massimo 60 secondi. Aggiungi passi "salvataggio" tipo "Segna dove sei arrivato" o "Salva il lavoro" tra i passi principali. Se un passo richiede più di 2 minuti, scomponilo. Ogni passo deve essere interrompibile senza perdere progresso.`;
  } else if (interruptionVuln >= 3) {
    interruptionInstructions = `VULNERABILITÀ INTERRUZIONI MODERATA: Passi brevi ma non microscopici. Aggiungi un passo di salvataggio a metà se il task è lungo.`;
  }

  // ── Motivational framing from motivationProfile ──
  let motivationalFraming = '';
  const topMotivations = Object.entries(motivation)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([key]) => key);

  if (topMotivations.includes('reward')) {
    motivationalFraming += `Il senso di ricompensa motiva questa persona — i passi finali dovrebbero produrre qualcosa di visibile/tangibile. `;
  }
  if (topMotivations.includes('urgency')) {
    motivationalFraming += `L'urgenza motiva questa persona — se il task ha una scadenza, menzionala nel primo passo. `;
  }
  if (topMotivations.includes('identity')) {
    motivationalFraming += `L'identità motiva questa persona — i passi possono implicare "da persona organizzata, io..." senza dirlo esplicitamente. `;
  }
  if (topMotivations.includes('relief')) {
    motivationalFraming += `Il sollievo motiva questa persona — enfatizza che ogni passo completato elimina un peso. `;
  }
  if (topMotivations.includes('curiosity')) {
    motivationalFraming += `La curiosità motiva questa persona — se possibile, rendi i passi esplorativi ("scopri cosa...", "trova il..."). `;
  }
  if (topMotivations.includes('accountability')) {
    motivationalFraming += `La responsabilità motiva questa persona — i passi possono coinvolgere comunicazione o condivisione dei risultati. `;
  }

  // ── Build system prompt ──
  const systemPrompt = `Sei un motore di scomposizione compiti per adulti ADHD. Il tuo UNICO scopo è prendere un compito e spezzarlo in micro-passi CONCRETI e IMMEDIATAMENTE eseguibili.

REGOLE ASSOLUTE:
1. Usa SOLO verbi d'azione concreti: "apri", "scrivi", "clicca", "leggi", "lava", "prepara", "invia"
2. Ogni passo deve essere completabile in 1-5 minuti
3. ZERO linguaggio motivazionale — niente "puoi farcela", "forza", "coraggio"
4. ZERO spiegazioni o contesto — solo l'azione
5. ZERO astrazioni — niente "pianifica", "organizza", "pensa a"
6. MASSIMO 8 passi, MINIMO 2
7. Ogni passo deve essere una singola azione fisica o cognitiva semplice
8. Il primo passo deve essere il più banale possibile
9. Adatta la granularità all'energia dell'utente: meno energia = passi più piccoli
10. Adatta al tempo disponibile: meno tempo = meno passi, più focalizzati

${toneInstructions}

${granularityInstructions}

${avoidanceInstructions}

${interruptionInstructions}

${motivationalFraming ? `MOTIVAZIONE: ${motivationalFraming}` : ''}

FORMATO RICHIESTO:
Rispondi SOLO con un array JSON di oggetti, ogni oggetto ha:
- "text": il micro-step come frase imperativa
- "estimatedSeconds": tempo stimato in secondi (30-300)

NON aggiungere altro testo, spiegazioni, o formattazione. Solo l'array JSON.`;

  // ── Build user prompt ──
  const userPrompt = `Compito: "${taskTitle}"
${taskDescription ? `Dettagli: ${taskDescription}` : ''}

Energia utente: ${ctx.energy}/5
Tempo disponibile: ${ctx.timeAvailable} minuti
Contesto: ${ctx.currentContext}
Fascia oraria: ${ctx.currentTimeSlot}
Sessione ottimale: ${adaptiveProfile.optimalSessionLength} minuti
Evitamento: ${adaptiveProfile.avoidanceProfile.toFixed(1)}/5
Vulnerabilità interruzioni: ${adaptiveProfile.interruptionVulnerability.toFixed(1)}/5
Granularità preferita: ${adaptiveProfile.preferredDecompositionGranularity}/5

Scomponi in micro-passi concreti e immediatamente eseguibili.`;

  return { systemPrompt, userPrompt };
}
