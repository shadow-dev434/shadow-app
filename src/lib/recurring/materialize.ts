/**
 * Task 46 — Materializzazione lazy dei task ricorrenti + gestione dei template.
 *
 * Non esiste uno scheduler (cfr. docs/tasks/46): le istanze vengono create
 * on-read, nei due momenti in cui il piano del giorno si costruisce — review
 * serale (per domani) e check-in / Today (per oggi). `materializeRecurringForDate`
 * e' idempotente: la guardia unique (recurringTemplateId, occurrenceDate) sullo
 * schema impedisce doppioni anche in caso di chiamate concorrenti.
 */

import type { RecurringTask } from '@prisma/client';
import { db } from '@/lib/db';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import {
  occursOn,
  mostRecentOccurrenceInWindow,
  normalizeWeekdays,
  isFrequency,
  describeRuleIt,
  type RecurrenceRule,
  type Frequency,
} from './recurrence';

/** Ricostruisce la RecurrenceRule pura da una riga RecurringTask. */
export function ruleFromTemplate(t: RecurringTask): RecurrenceRule {
  return {
    frequency: t.frequency as Frequency,
    weekdays: parseWeekdaysJson(t.weekdays),
    monthDay: t.monthDay,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}

function parseWeekdaysJson(json: string): number[] {
  try {
    return normalizeWeekdays(JSON.parse(json));
  } catch {
    return [];
  }
}

function clampMonthDay(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

function normalizeEndDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Crea per `userId` le istanze Task dei template attivi che "scattano" in `dateYMD`,
 * saltando quelle gia' presenti (in qualunque stato: un'istanza completata o
 * archiviata non viene ricreata nello stesso giorno). Ritorna gli id creati.
 */
export async function materializeRecurringForDate(
  userId: string,
  dateYMD: string,
): Promise<string[]> {
  const templates = await db.recurringTask.findMany({ where: { userId, active: true } });
  const due = templates.filter((t) => occursOn(ruleFromTemplate(t), dateYMD));
  if (due.length === 0) return [];

  const existing = await db.task.findMany({
    where: {
      userId,
      recurringTemplateId: { in: due.map((t) => t.id) },
      occurrenceDate: dateYMD,
    },
    select: { recurringTemplateId: true },
  });
  const existingIds = new Set(existing.map((e) => e.recurringTemplateId));

  const created: string[] = [];
  for (const t of due) {
    if (existingIds.has(t.id)) continue;
    const id = await createInstanceFromTemplate(userId, t, dateYMD);
    if (id !== null) created.push(id);
  }
  return created;
}

/**
 * Task 65 (B1/B2, ADV-ricorrenti + J7): materializzazione con rollover.
 *
 * Chiamata da GET /api/tasks (il punto d'ingresso comune di inbox e Today):
 * per ogni template attivo cerca l'occorrenza piu' recente <= oggi nella
 * finestra (default 7 giorni) e crea SOLO quella, se manca. Copre due casi:
 * - il ricorrente di oggi c'e' anche senza passare dalla chat (B1);
 * - l'occorrenza saltata (app chiusa il giorno giusto, tipico dei weekly)
 *   nasce comunque alla prima apertura, con la sua occurrenceDate reale (B2).
 * Una sola istanza per template, mai la pila arretrata (anti shame-pile).
 * Idempotente come materializeRecurringForDate (guardia unique + P2002).
 */
export async function materializeRecurringWithRollover(
  userId: string,
  todayYMD: string,
  windowDays: number = 7,
): Promise<string[]> {
  const templates = await db.recurringTask.findMany({ where: { userId, active: true } });
  if (templates.length === 0) return [];

  const due: { template: RecurringTask; dateYMD: string }[] = [];
  for (const t of templates) {
    const day = mostRecentOccurrenceInWindow(ruleFromTemplate(t), todayYMD, windowDays);
    if (day !== null) due.push({ template: t, dateYMD: day });
  }
  if (due.length === 0) return [];

  // Check esistenza per coppia ESATTA (template, data-target): un'istanza di
  // domani creata dalla review serale non deve mascherare quella di oggi.
  const existing = await db.task.findMany({
    where: {
      userId,
      OR: due.map((d) => ({
        recurringTemplateId: d.template.id,
        occurrenceDate: d.dateYMD,
      })),
    },
    select: { recurringTemplateId: true, occurrenceDate: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.recurringTemplateId}|${e.occurrenceDate}`));

  const created: string[] = [];
  for (const d of due) {
    if (existingKeys.has(`${d.template.id}|${d.dateYMD}`)) continue;
    const id = await createInstanceFromTemplate(userId, d.template, d.dateYMD);
    if (id !== null) created.push(id);
  }
  return created;
}

/** Crea l'istanza Task di un template per una data; null se la guardia unique scatta. */
async function createInstanceFromTemplate(
  userId: string,
  t: RecurringTask,
  dateYMD: string,
): Promise<string | null> {
  try {
    const task = await db.task.create({
      data: {
        userId,
        title: t.title,
        description: t.description,
        category: t.category,
        urgency: t.urgency,
        importance: t.importance,
        size: t.size,
        status: 'inbox',
        source: 'recurring',
        aiClassified: true,
        aiClassificationData: JSON.stringify({
          via: 'recurring',
          templateId: t.id,
          urgency: t.urgency,
          importance: t.importance,
          category: t.category,
        }),
        recurringTemplateId: t.id,
        occurrenceDate: dateYMD,
      },
    });
    return task.id;
  } catch {
    // P2002 sulla guardia unique (template, data): un'altra chiamata concorrente
    // ha gia' materializzato l'istanza. Idempotente -> si ignora.
    return null;
  }
}

export interface SetRecurrenceInput {
  frequency: unknown;
  weekdays?: unknown;
  monthDay?: unknown;
  endDate?: unknown;
}

export type SetRecurrenceResult =
  | { ok: true; templateId: string; rule: RecurrenceRule; description: string; updated: boolean }
  | { ok: false; error: string };

/**
 * Rende ricorrente un task esistente (anche appena creato in chat): crea — o
 * aggiorna, se il task ne ha gia' uno — un RecurringTask template ereditandone
 * il contenuto, e lega il task come prima istanza (occurrenceDate = oggi).
 */
export async function setTaskRecurrence(
  userId: string,
  taskId: string,
  input: SetRecurrenceInput,
): Promise<SetRecurrenceResult> {
  const task = await db.task.findFirst({ where: { id: taskId, userId } });
  if (!task) return { ok: false, error: 'task_not_found' };

  if (!isFrequency(input.frequency)) return { ok: false, error: 'invalid_frequency' };
  const frequency = input.frequency;
  const weekdays = normalizeWeekdays(input.weekdays ?? []);
  const monthDay = clampMonthDay(input.monthDay);
  if (frequency === 'weekly' && weekdays.length === 0) {
    return { ok: false, error: 'weekly_needs_weekdays' };
  }
  if (frequency === 'monthly' && monthDay === null) {
    return { ok: false, error: 'monthly_needs_monthday' };
  }
  const endDate = normalizeEndDate(input.endDate);

  // Aggiornamento di un template gia' esistente: cambia solo la regola, non il
  // contenuto (un edit "anche il martedi'" non deve sovrascrivere il titolo).
  if (task.recurringTemplateId) {
    const tmpl = await db.recurringTask.update({
      where: { id: task.recurringTemplateId },
      data: { frequency, weekdays: JSON.stringify(weekdays), monthDay, endDate, active: true },
    });
    const rule = ruleFromTemplate(tmpl);
    return { ok: true, templateId: tmpl.id, rule, description: describeRuleIt(rule), updated: true };
  }

  const today = formatTodayInRome();
  // Atomico: creare il template e legarlo al task sono due write che devono
  // riuscire insieme. Senza transazione, un fallimento del secondo write (drop
  // di connessione, task cancellato nel frattempo) lascerebbe un template orfano
  // active=true che materializza istanze "zombie" senza che stopTaskRecurrence
  // possa raggiungerlo (nessun task lo referenzia). Stesso pattern di
  // commit-today-plan.ts / close-review.ts.
  const tmpl = await db.$transaction(async (tx) => {
    const created = await tx.recurringTask.create({
      data: {
        userId,
        title: task.title,
        description: task.description,
        category: task.category,
        urgency: task.urgency,
        importance: task.importance,
        size: task.size,
        frequency,
        weekdays: JSON.stringify(weekdays),
        monthDay,
        active: true,
        startDate: today,
        endDate,
      },
    });
    await tx.task.update({
      where: { id: task.id },
      data: {
        recurringTemplateId: created.id,
        occurrenceDate: task.occurrenceDate ?? today,
        source: task.source === 'manual' ? 'recurring' : task.source,
      },
    });
    return created;
  });
  const rule = ruleFromTemplate(tmpl);
  return { ok: true, templateId: tmpl.id, rule, description: describeRuleIt(rule), updated: false };
}

export type StopRecurrenceResult =
  | { ok: true; templateId: string; title: string }
  | { ok: false; error: string };

/**
 * Disattiva la ricorrenza a partire dall'istanza visibile: setta active=false sul
 * template. Le istanze gia' create (inclusa quella di oggi) restano. Reversibile
 * con setTaskRecurrence.
 */
export async function stopTaskRecurrence(
  userId: string,
  taskId: string,
): Promise<StopRecurrenceResult> {
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { recurringTemplateId: true },
  });
  if (!task) return { ok: false, error: 'task_not_found' };
  if (!task.recurringTemplateId) return { ok: false, error: 'not_recurring' };

  const tmpl = await db.recurringTask.update({
    where: { id: task.recurringTemplateId },
    data: { active: false },
  });
  return { ok: true, templateId: tmpl.id, title: tmpl.title };
}
