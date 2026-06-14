// Shadow — Prompt + tool schema per la classificazione LLM dei task (Task 45).
// Vive qui (non in src/lib/chat/prompts.ts) per non toccare il prefisso statico
// core-chat sotto caching. Master in italiano; il classificatore gira su Haiku
// (tier fast) con output strutturato forzato via tool `emit_classification`.

import type { LLMTool } from '@/lib/llm/client';

// Categorie allineate a heuristicClassification (fallback) e al resto dell'app.
export const TASK_CATEGORIES = [
  'general',
  'work',
  'household',
  'study',
  'health',
  'admin',
  'creative',
] as const;

export const TASK_CONTEXTS = ['any', 'home', 'work', 'outside'] as const;

// Strumento a output forzato: garantisce JSON valido senza parsing di testo.
export const EMIT_CLASSIFICATION_TOOL: LLMTool = {
  name: 'emit_classification',
  description:
    'Restituisce la classificazione strutturata del task. Chiamalo una sola volta.',
  input_schema: {
    type: 'object',
    properties: {
      importance: {
        type: 'integer',
        description:
          'Importanza 1-5. 5=cardine, conseguenze gravi/irreversibili se salti; 4=molto importante per obiettivi o persone; 3=conta ma rimandabile senza danni; 2=marginale; 1=opzionale/nice-to-have.',
      },
      urgency: {
        type: 'integer',
        description:
          'Urgenza 1-5 ancorata al tempo. 5=oggi o gia scaduto; 4=questa settimana; 3=questo mese; 2=questo trimestre; 1=quando capita. Un riferimento temporale esplicito nel testo o nella deadline domina sulla stima.',
      },
      resistance: {
        type: 'integer',
        description:
          'Resistenza 1-5: quanto attrito emotivo/cognitivo a INIZIARE (1=facile da avviare, 5=forte evitamento).',
      },
      size: {
        type: 'integer',
        description:
          'Dimensione 1-5: 1=micro (<15 min), 2=piccolo, 3=medio, 4=grande, 5=molto grande/multi-step.',
      },
      delegable: {
        type: 'boolean',
        description: 'true se il task potrebbe essere fatto da qualcun altro.',
      },
      context: {
        type: 'string',
        enum: [...TASK_CONTEXTS],
        description:
          'Dove/come si svolge: any (indifferente), home, work, outside (commissioni fuori).',
      },
      category: {
        type: 'string',
        enum: [...TASK_CATEGORIES],
        description: 'Categoria tematica del task.',
      },
      confidence: {
        type: 'number',
        description:
          'Quanto sei sicuro della classificazione, da 0 a 1 (testo vago -> bassa).',
      },
      reason: {
        type: 'string',
        description:
          'Una frase breve in italiano che motiva importanza e urgenza scelte.',
      },
    },
    required: [
      'importance',
      'urgency',
      'resistance',
      'size',
      'delegable',
      'context',
      'category',
      'confidence',
      'reason',
    ],
  },
};

// System prompt. Inietta un riassunto compatto del profilo utente quando presente,
// per tarare soprattutto l'importanza (cosa "pesa" dipende dalla vita dell'utente).
export function buildClassifySystemPrompt(profile: Record<string, unknown> | null): string {
  const base = `Sei il classificatore di priorita di Shadow, un'app per adulti con ADHD.
Ricevi un task e lo classifichi su scale 1-5 chiamando il tool emit_classification.

Principi:
- Sii onesto e differenziante: NON mettere tutto a 3. La maggior parte dei task
  reali NON e' "importante E urgente" insieme. Usa l'intera scala 1-5.
- Urgenza = solo tempo (quando va fatto), ancorata alla rubrica. Importanza = peso
  nella vita dell'utente, indipendente dal tempo.
- Se il testo e' vago, scegli valori plausibili ma abbassa confidence.
- Rispondi SOLO chiamando emit_classification, senza testo libero.`;

  if (!profile) return base;

  const parts: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) {
      if (val.length) parts.push(`${label}: ${val.join(', ')}`);
      return;
    }
    const s = String(val).trim();
    if (s) parts.push(`${label}: ${s}`);
  };
  push('Ruolo', profile.role);
  push('Occupazione', profile.occupation);
  push('Situazione', profile.livingSituation);
  push('Responsabilita principali', profile.mainResponsibilities);
  push('Aree difficili', profile.difficultAreas);

  if (!parts.length) return base;
  return `${base}\n\nProfilo dell'utente (per tarare soprattutto l'importanza):\n- ${parts.join('\n- ')}`;
}

// Messaggio utente con i dati del task da classificare.
export function buildClassifyUserMessage(input: {
  taskTitle: string;
  taskDescription: string;
  deadline?: string | null;
  energy: number;
  timeAvailable: number;
  currentContext: string;
}): string {
  const lines = [
    'Classifica questo task:',
    `- Titolo: ${input.taskTitle}`,
    `- Descrizione: ${input.taskDescription?.trim() || '(nessuna)'}`,
    `- Deadline esplicita: ${input.deadline ? input.deadline : '(nessuna)'}`,
    `Contesto attuale dell'utente: energia ${input.energy}/5, tempo disponibile ${input.timeAvailable} min, contesto "${input.currentContext}".`,
  ];
  return lines.join('\n');
}
