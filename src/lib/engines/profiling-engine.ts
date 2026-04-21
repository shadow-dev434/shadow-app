// Shadow — Profiling Engine
// AI-powered user profiling and task classification based on executive function patterns

// ── Types ──────────────────────────────────────────────────────────────────

export interface RawProfileInput {
  role: string;
  occupation: string;
  age: number;
  livingSituation: string;
  hasChildren: boolean;
  householdManager: boolean;
  mainResponsibilities: string[];
  difficultAreas: string[];
  dailyRoutine: string;
}

export interface ExecutiveProfile {
  cognitiveLoad: string;
  responsibilityLoad: string;
  timeConstraints: string;
  lifeContext: string;
  executionStyle: string;
  preferredSessionLength: number;
}

export interface TaskClassificationInput {
  taskTitle: string;
  taskDescription: string;
  profile: Record<string, unknown> | null;
  energy: number;
  timeAvailable: number;
  currentContext: string;
}

export interface TaskClassification {
  category: string;
  resistance: number;
  size: number;
  importance: number;
  urgency: number;
  suggestedContext: string;
  adhdNotes: string;
  executionStrategy: string;
  estimatedMinutes: number;
}

// ── AI Prompt for Profile Synthesis ────────────────────────────────────────

const PROFILING_SYSTEM_PROMPT = `Sei un motore di profilazione per adulti ADHD. Analizzi i dati di vita dell'utente e produci un profilo esecutivo che guida come Shadow dovrebbe adattarsi alla loro vita.

Il tuo output determina come l'app aiuta questa persona — sii preciso e realistico.

REGOLE:
1. Valuta il carico cognitivo realistico (non solo numero di responsabilità, ma complessità e interruzioni)
2. Considera il carico di responsabilità pratica (bambini, casa, lavoro, studio)
3. I vincoli di tempo devono riflettere la REALTÀ — genitori con figli piccoli hanno meno tempo
4. Il contesto di vita deve essere una frase descrittiva utile per l'AI
5. Lo stile di esecuzione deve essere: "structured" (passi chiari), "flexible" (opzioni), "micro" (passi piccolissimi), o "momentum" (partire dal più facile)
6. La lunghezza sessione preferita deve essere in minuti (5, 10, 15, 25, 45)

FORMATO RICHIESTO:
Rispondi SOLO con un oggetto JSON:
{
  "cognitiveLoad": "low" | "medium" | "high" | "overwhelming",
  "responsibilityLoad": "low" | "medium" | "high" | "overwhelming",
  "timeConstraints": "minimal" | "moderate" | "significant" | "extreme",
  "lifeContext": "frase descrittiva del contesto di vita",
  "executionStyle": "structured" | "flexible" | "micro" | "momentum",
  "preferredSessionLength": numero minuti
}

NON aggiungere altro testo. Solo l'oggetto JSON.`;

const CLASSIFICATION_SYSTEM_PROMPT = `Sei un classificatore di compiti per adulti ADHD. Analizzi un compito nel contesto del profilo dell'utente e produci una classificazione che Shadow può usare per priorità ed esecuzione.

REGOLE:
1. La categoria deve essere: work, personal, health, admin, creative, study, household, general
2. La resistenza (1-5) stima quanto è difficile INIZIARE questo compito per questa persona (considera il profilo ADHD)
3. La dimensione (1-5) stima quanto tempo/cognitive effort serve
4. Importanza (1-5) e urgenza (1-5) vanno valutate nel contesto della vita dell'utente
5. Il contesto suggerito è dove è meglio fare il compito: any, home, office, phone, computer, errand
6. Le note ADHD sono suggerimenti specifici per questa persona su come affrontare il compito
7. La strategia di esecuzione dice COME iniziare: "start_small", "timebox", "body_double", "external_deadline", "remove_friction", "batch", "single_step"
8. Il tempo stimato è in minuti realistici per una persona ADHD

FORMATO RICHIESTO:
Rispondi SOLO con un oggetto JSON:
{
  "category": "string",
  "resistance": number,
  "size": number,
  "importance": number,
  "urgency": number,
  "suggestedContext": "string",
  "adhdNotes": "string",
  "executionStrategy": "string",
  "estimatedMinutes": number
}

NON aggiungere altro testo. Solo l'oggetto JSON.`;

// ── Generate Executive Profile ─────────────────────────────────────────────

export async function generateExecutiveProfile(input: RawProfileInput): Promise<ExecutiveProfile> {
  const prompt = `Dati dell'utente:
- Ruolo: ${input.role}
- Occupazione: ${input.occupation}
- Età: ${input.age}
- Situazione abitativa: ${input.livingSituation}
- Ha figli: ${input.hasChildren ? 'Sì' : 'No'}
- Gestisce la casa: ${input.householdManager ? 'Sì' : 'No'}
- Responsabilità principali: ${input.mainResponsibilities.join(', ')}
- Aree difficili: ${input.difficultAreas.join(', ')}
- Routine giornaliera: ${input.dailyRoutine}

Genera il profilo esecutivo.`;

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: PROFILING_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content || '';
    return validateAndParseProfile(raw, input);
  } catch (error) {
    console.error('AI profiling failed, using heuristics:', error);
    return heuristicProfile(input);
  }
}

// ── Classify Task with AI ──────────────────────────────────────────────────

export async function classifyTaskWithAI(input: TaskClassificationInput): Promise<TaskClassification> {
  const profileSection = input.profile
    ? `Profilo utente:
- Carico cognitivo: ${input.profile.cognitiveLoad ?? 'medium'}
- Carico responsabilità: ${input.profile.responsibilityLoad ?? 'medium'}
- Vincoli di tempo: ${input.profile.timeConstraints ?? 'moderate'}
- Contesto di vita: ${input.profile.lifeContext ?? ''}
- Stile esecuzione: ${input.profile.executionStyle ?? 'structured'}
- Sessione preferita: ${input.profile.preferredSessionLength ?? 25} min
- Aree difficili: ${JSON.stringify(input.profile.difficultAreas ?? [])}
- Responsabilità: ${JSON.stringify(input.profile.mainResponsibilities ?? [])}`
    : 'Nessun profilo utente disponibile. Classifica in modo generico.';

  const prompt = `Compito: "${input.taskTitle}"
${input.taskDescription ? `Dettagli: ${input.taskDescription}` : ''}

${profileSection}

Energia attuale: ${input.energy}/5
Tempo disponibile: ${input.timeAvailable} minuti
Contesto attuale: ${input.currentContext}

Classifica questo compito.`;

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content || '';
    return validateAndParseClassification(raw, input.taskTitle);
  } catch (error) {
    console.error('AI classification failed, using heuristics:', error);
    return heuristicClassification(input.taskTitle);
  }
}

// ── Validation & Parsing ──────────────────────────────────────────────────

function validateAndParseProfile(raw: string, input: RawProfileInput): ExecutiveProfile {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found');
    const parsed = JSON.parse(jsonMatch[0]);

    const validLoads = ['low', 'medium', 'high', 'overwhelming'];
    const validConstraints = ['minimal', 'moderate', 'significant', 'extreme'];
    const validStyles = ['structured', 'flexible', 'micro', 'momentum'];

    return {
      cognitiveLoad: validLoads.includes(parsed.cognitiveLoad) ? parsed.cognitiveLoad : heuristicCognitiveLoad(input),
      responsibilityLoad: validLoads.includes(parsed.responsibilityLoad) ? parsed.responsibilityLoad : heuristicResponsibilityLoad(input),
      timeConstraints: validConstraints.includes(parsed.timeConstraints) ? parsed.timeConstraints : heuristicTimeConstraints(input),
      lifeContext: typeof parsed.lifeContext === 'string' && parsed.lifeContext.length > 0
        ? parsed.lifeContext
        : `${input.role} ${input.hasChildren ? 'con figli' : ''}`.trim(),
      executionStyle: validStyles.includes(parsed.executionStyle) ? parsed.executionStyle : heuristicExecutionStyle(input),
      preferredSessionLength: [5, 10, 15, 25, 45].includes(parsed.preferredSessionLength)
        ? parsed.preferredSessionLength
        : 25,
    };
  } catch {
    return heuristicProfile(input);
  }
}

function validateAndParseClassification(raw: string, taskTitle: string): TaskClassification {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found');
    const parsed = JSON.parse(jsonMatch[0]);

    const validCategories = ['work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general'];
    const validContexts = ['any', 'home', 'office', 'phone', 'computer', 'errand'];
    const validStrategies = ['start_small', 'timebox', 'body_double', 'external_deadline', 'remove_friction', 'batch', 'single_step'];

    return {
      category: validCategories.includes(parsed.category) ? parsed.category : 'general',
      resistance: clamp(parsed.resistance, 1, 5),
      size: clamp(parsed.size, 1, 5),
      importance: clamp(parsed.importance, 1, 5),
      urgency: clamp(parsed.urgency, 1, 5),
      suggestedContext: validContexts.includes(parsed.suggestedContext) ? parsed.suggestedContext : 'any',
      adhdNotes: typeof parsed.adhdNotes === 'string' ? parsed.adhdNotes : '',
      executionStrategy: validStrategies.includes(parsed.executionStrategy) ? parsed.executionStrategy : 'start_small',
      estimatedMinutes: typeof parsed.estimatedMinutes === 'number' ? Math.max(5, Math.min(480, parsed.estimatedMinutes)) : 30,
    };
  } catch {
    return heuristicClassification(taskTitle);
  }
}

function clamp(val: number, min: number, max: number): number {
  if (typeof val !== 'number') return 3;
  return Math.max(min, Math.min(max, Math.round(val)));
}

// ── Heuristic Fallbacks ───────────────────────────────────────────────────

function heuristicCognitiveLoad(input: RawProfileInput): string {
  let score = 0;
  if (input.mainResponsibilities.length >= 5) score += 2;
  else if (input.mainResponsibilities.length >= 3) score += 1;
  if (input.hasChildren) score += 1;
  if (input.householdManager) score += 1;
  if (input.difficultAreas.length >= 4) score += 1;
  const loads: Record<number, string> = { 0: 'low', 1: 'low', 2: 'medium', 3: 'high', 4: 'overwhelming', 5: 'overwhelming' };
  return loads[score] || 'overwhelming';
}

function heuristicResponsibilityLoad(input: RawProfileInput): string {
  let score = 0;
  if (input.mainResponsibilities.length >= 4) score += 2;
  else if (input.mainResponsibilities.length >= 2) score += 1;
  if (input.hasChildren) score += 2;
  if (input.householdManager) score += 1;
  if (input.occupation && input.occupation.length > 0) score += 1;
  const loads: Record<number, string> = { 0: 'low', 1: 'low', 2: 'medium', 3: 'high', 4: 'overwhelming', 5: 'overwhelming', 6: 'overwhelming' };
  return loads[score] || 'overwhelming';
}

function heuristicTimeConstraints(input: RawProfileInput): string {
  let score = 0;
  if (input.hasChildren) score += 2;
  if (input.householdManager) score += 1;
  if (input.mainResponsibilities.length >= 5) score += 1;
  if (input.occupation && input.occupation.toLowerCase().includes('full')) score += 1;
  const constraints: Record<number, string> = { 0: 'minimal', 1: 'moderate', 2: 'significant', 3: 'extreme', 4: 'extreme' };
  return constraints[score] || 'extreme';
}

function heuristicExecutionStyle(input: RawProfileInput): string {
  if (input.difficultAreas.some(a => a.toLowerCase().includes('inizio') || a.toLowerCase().includes('start'))) return 'micro';
  if (input.difficultAreas.some(a => a.toLowerCase().includes('organizz') || a.toLowerCase().includes('plan'))) return 'structured';
  if (input.hasChildren) return 'flexible';
  return 'momentum';
}

function heuristicProfile(input: RawProfileInput): ExecutiveProfile {
  return {
    cognitiveLoad: heuristicCognitiveLoad(input),
    responsibilityLoad: heuristicResponsibilityLoad(input),
    timeConstraints: heuristicTimeConstraints(input),
    lifeContext: `${input.role || 'Utente'} ${input.hasChildren ? 'con figli' : ''} ${input.householdManager ? 'e gestione casa' : ''}`.trim(),
    executionStyle: heuristicExecutionStyle(input),
    preferredSessionLength: input.hasChildren ? 15 : 25,
  };
}

function heuristicClassification(taskTitle: string): TaskClassification {
  const lower = taskTitle.toLowerCase();

  let category = 'general';
  if (lower.includes('lavor') || lower.includes('meet') || lower.includes('report') || lower.includes('email')) category = 'work';
  else if (lower.includes('pul') || lower.includes('cucina') || lower.includes('lav') || lower.includes('casa')) category = 'household';
  else if (lower.includes('stud') || lower.includes('legg') || lower.includes('impar')) category = 'study';
  else if (lower.includes('salute') || lower.includes('dott') || lower.includes('medic') || lower.includes('allen')) category = 'health';
  else if (lower.includes('fattur') || lower.includes('contabilit') || lower.includes('document')) category = 'admin';
  else if (lower.includes('scriv') || lower.includes('disegn') || lower.includes('creat')) category = 'creative';

  return {
    category,
    resistance: 3,
    size: 3,
    importance: 3,
    urgency: 3,
    suggestedContext: 'any',
    adhdNotes: '',
    executionStrategy: 'start_small',
    estimatedMinutes: 30,
  };
}
