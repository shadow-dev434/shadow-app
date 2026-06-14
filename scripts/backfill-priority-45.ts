/**
 * Backfill priorita' — Task 45.
 *
 * Cosa fa:
 *  - Ri-classifica col classificatore LLM SOLO i task legacy "piatti"
 *    (importance===3 && urgency===3), che sono l'output del vecchio no-op.
 *    I task con valori gia' diversi (segnale deliberato) NON vengono toccati
 *    nei loro intrinseci.
 *  - Ricalcola per TUTTI i task attivi i campi DERIVATI (quadrant /
 *    priorityScore / decision / decisionReason) con la nuova soglia >=4,
 *    via prioritizeTask su un contesto neutro.
 *
 * DRY-RUN di default (NESSUNA scrittura). Stampa il diff per ogni task.
 * Per applicare:
 *   bun run dotenv -e .env.local -- bun run scripts/backfill-priority-45.ts --apply
 * Opzioni: --limit N (processa solo i primi N, utile in dry-run di prova).
 *
 * ⚠️ E' uno script SCRIVENTE su DB. Per memoria `vercel-deploy-shadow`,
 * Preview/Dev condividono la DATABASE_URL di PROD: lanciare deliberatamente,
 * prima senza --apply, e usare --apply solo su conferma esplicita.
 */

import { db } from '../src/lib/db';
import { classifyTaskWithAI } from '../src/lib/engines/profiling-engine';
import { prioritizeTask } from '../src/lib/engines/priority-engine';
import { getCurrentTimeSlot } from '../src/lib/engines/execution-engine';
import {
  terminalTaskStatuses,
  type ExecutionContext,
  type TaskRecord,
} from '../src/lib/types/shadow';

const APPLY = process.argv.includes('--apply');

// --limit N: validazione esplicita. Number(x)||undefined trattava 0 e i valori
// non numerici (es. "--limit --apply") come "nessun limite" -> processava TUTTO.
const limitArgIdx = process.argv.indexOf('--limit');
let LIMIT: number | undefined;
if (limitArgIdx >= 0) {
  const rawLimit = process.argv[limitArgIdx + 1];
  const n = Number(rawLimit);
  if (rawLimit === undefined || rawLimit.startsWith('--') || !Number.isInteger(n) || n < 0) {
    console.error('[backfill-45] --limit richiede un intero >= 0 (es. --limit 8).');
    process.exit(1);
  }
  LIMIT = n;
}

// Costo medio stimato per chiamata Haiku di classificazione (~300 in / ~120 out).
const EST_COST_PER_CLASSIFY = 0.0008;

const NEUTRAL_CTX: ExecutionContext = {
  energy: 3 as ExecutionContext['energy'],
  timeAvailable: 480,
  currentContext: 'any' as ExecutionContext['currentContext'],
  currentTimeSlot: getCurrentTimeSlot(),
};

type DbTask = Awaited<ReturnType<typeof db.task.findMany>>[number];

function toTaskRecord(t: DbTask): TaskRecord {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    importance: t.importance,
    urgency: t.urgency,
    deadline: t.deadline ? t.deadline.toISOString() : null,
    resistance: t.resistance,
    size: t.size,
    delegable: t.delegable,
    category: t.category,
    context: t.context,
    avoidanceCount: t.avoidanceCount,
    lastAvoidedAt: t.lastAvoidedAt ? t.lastAvoidedAt.toISOString() : null,
    quadrant: t.quadrant as TaskRecord['quadrant'],
    priorityScore: t.priorityScore,
    decision: t.decision as TaskRecord['decision'],
    decisionReason: t.decisionReason,
    status: t.status as TaskRecord['status'],
    microSteps: t.microSteps,
    microStepsRaw: t.microStepsRaw,
    currentStepIdx: t.currentStepIdx,
    executionMode: t.executionMode as TaskRecord['executionMode'],
    sessionFormat: t.sessionFormat as TaskRecord['sessionFormat'],
    sessionDuration: t.sessionDuration,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    aiClassified: t.aiClassified,
    aiClassificationData: t.aiClassificationData,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

const profileCache = new Map<string, Record<string, unknown> | null>();
async function loadProfile(userId: string): Promise<Record<string, unknown> | null> {
  if (profileCache.has(userId)) return profileCache.get(userId) ?? null;
  const p = await db.userProfile.findUnique({ where: { userId } });
  const result: Record<string, unknown> | null = p
    ? {
        role: p.role,
        occupation: p.occupation,
        livingSituation: p.livingSituation,
        mainResponsibilities: safeParse(p.mainResponsibilities),
        difficultAreas: safeParse(p.difficultAreas),
      }
    : null;
  profileCache.set(userId, result);
  return result;
}

async function main(): Promise<void> {
  // Guard anti-scrittura accidentale: --apply scrive in massa e (memoria
  // vercel-deploy-shadow) Preview/Dev puntano alla DATABASE_URL di PROD.
  if (APPLY) {
    const masked = (process.env.DATABASE_URL ?? '(non impostata)').replace(/\/\/[^@]*@/, '//***@');
    if (process.env.BACKFILL_CONFIRM !== 'yes') {
      console.error('[backfill-45] --apply richiede BACKFILL_CONFIRM=yes (doppia conferma esplicita).');
      console.error(`[backfill-45] DB target: ${masked}`);
      console.error('[backfill-45] Rilancia con: BACKFILL_CONFIRM=yes bun run dotenv -e .env.local -- bun run scripts/backfill-priority-45.ts --apply');
      process.exit(1);
    }
    console.log(`[backfill-45] APPLY confermato (BACKFILL_CONFIRM=yes). DB target: ${masked}`);
  }

  const tasks = await db.task.findMany({
    where: { status: { notIn: terminalTaskStatuses() } },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT !== undefined ? { take: LIMIT } : {}),
  });

  console.log(
    `[backfill-45] ${tasks.length} task attivi${LIMIT ? ` (limite ${LIMIT})` : ''}. ` +
      `Modalita': ${APPLY ? 'APPLY (scrive)' : 'DRY-RUN (sola lettura)'}.`,
  );

  let reclassified = 0;
  let derivedOnly = 0;
  let errors = 0;
  let estCost = 0;

  for (const t of tasks) {
    // "Flat" = il segnale di ranking (importance/urgency) e' al default no-op 3/3,
    // quindi privo di significato e da ri-derivare. NON restringiamo anche a
    // resistance/size/context al default: lo farebbe saltare i veri task legacy
    // che hanno quei campi non-default (visto in dry-run). La protezione contro
    // la sovrascrittura di segnali deliberati (finding review) e' sotto, nel
    // ramo reclassify: i campi secondari non-default vengono PRESERVATI.
    const isFlat = t.importance === 3 && t.urgency === 3;

    let importance = t.importance;
    let urgency = t.urgency;
    let resistance = t.resistance;
    let size = t.size;
    let delegable = t.delegable;
    let category = t.category;
    let context = t.context;

    if (isFlat) {
      try {
        const profile = await loadProfile(t.userId);
        const cls = await classifyTaskWithAI({
          taskTitle: t.title,
          taskDescription: t.description,
          profile,
          energy: 3,
          timeAvailable: 480,
          currentContext: 'any',
          deadline: t.deadline ? t.deadline.toISOString() : null,
        });
        // importance/urgency: sempre dall'LLM (erano il 3/3 no-op da rifare).
        importance = cls.importance;
        urgency = cls.urgency;
        // Campi secondari: adotta l'LLM solo se erano al default (= probabilmente
        // mai impostati); altrimenti PRESERVA il valore esistente, che potrebbe
        // essere un segnale deliberato dell'utente o dell'era pre-no-op.
        resistance = t.resistance === 3 ? cls.resistance : t.resistance;
        size = t.size === 3 ? cls.size : t.size;
        delegable = t.delegable === true ? true : cls.delegable;
        category = t.category === 'general' ? cls.category : t.category;
        context = t.context === 'any' ? cls.suggestedContext : t.context;
        reclassified++;
        estCost += EST_COST_PER_CLASSIFY;
      } catch (e) {
        errors++;
        console.warn(
          `[backfill-45] classify FALLITA per ${t.id} ("${t.title.slice(0, 40)}"): ` +
            `${e instanceof Error ? e.message : e} — lascio intrinseci, ricalcolo solo derivati.`,
        );
      }
    } else {
      derivedOnly++;
    }

    const rec: TaskRecord = {
      ...toTaskRecord(t),
      importance,
      urgency,
      resistance,
      size,
      delegable,
      category,
      context,
    };
    const p = prioritizeTask(rec, NEUTRAL_CTX, [rec]);

    const tag = isFlat ? 'RECLASS' : 'derive ';
    console.log(
      `[backfill-45] ${tag} "${t.title.slice(0, 40)}" | ` +
        `imp ${t.importance}->${importance} urg ${t.urgency}->${urgency} | ` +
        `quad ${t.quadrant}->${p.quadrant} score ${t.priorityScore.toFixed(1)}->${p.finalScore.toFixed(1)} ` +
        `dec ${t.decision}->${p.decision}`,
    );

    if (APPLY) {
      await db.task.update({
        where: { id: t.id },
        data: {
          importance,
          urgency,
          resistance,
          size,
          delegable,
          category,
          context,
          quadrant: p.quadrant,
          priorityScore: p.finalScore,
          decision: p.decision,
          decisionReason: p.reason,
          aiClassified: true,
          aiClassificationData: JSON.stringify({
            via: 'backfill-45',
            importance,
            urgency,
            resistance,
            size,
            delegable,
            category,
            context,
          }),
        },
      });
    }
  }

  console.log(
    `[backfill-45] FATTO. reclass=${reclassified} derive-only=${derivedOnly} ` +
      `errori=${errors} costo_LLM_stimato~$${estCost.toFixed(3)} — ` +
      `${APPLY ? 'SCRITTURE APPLICATE' : 'DRY-RUN: nessuna scrittura'}.`,
  );

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error('[backfill-45] errore fatale:', e);
  await db.$disconnect();
  process.exit(1);
});
