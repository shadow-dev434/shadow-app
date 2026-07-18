/**
 * Task 74 — assemblaggio agenda settimanale, puro e testabile.
 *
 * Trasforma i dati grezzi del range (DailyPlan+DailyPlanTask, Task con
 * deadline, template RecurringTask) nella shape per-giorno consumata dalla
 * CalendarView. Nessun Prisma qui: la route passa i risultati delle query.
 *
 * Regole (spec docs/tasks/74-vista-calendario.md):
 * - plan: derivazione slots/source IDENTICA alla GET /api/daily-plan (fasce
 *   presenti → 'review'; slot 'today' → 'chat'; altrimenti 'engine').
 * - deadlines: giorno e orario in Europe/Rome (le Date sono UTC a DB).
 * - recurring: proiezione via occursOn SOLO da `today` in avanti, esclusa se
 *   il piano del giorno contiene già l'istanza materializzata del template.
 */

import { addDaysIso, formatDateInRome, hhmmInRome, ymdDeltaDays } from '@/lib/evening-review/dates';
import {
  describeRuleIt,
  isFrequency,
  normalizeWeekdays,
  occursOn,
  type RecurrenceRule,
} from '@/lib/recurring/recurrence';

export interface AgendaTaskItem {
  id: string;
  title: string;
  status: string;
  isRecurring: boolean;
}

export interface AgendaDeadlineItem {
  id: string;
  title: string;
  status: string;
  /** "HH:mm" Europe/Rome. */
  time: string;
}

export interface AgendaRecurringItem {
  templateId: string;
  title: string;
  /** Regola in italiano discorsivo (describeRuleIt). */
  rule: string;
}

export interface AgendaPlan {
  source: 'review' | 'chat' | 'engine';
  /** Presenti solo se il piano viene dalla review serale (fasce). */
  slots: { morning: AgendaTaskItem[]; afternoon: AgendaTaskItem[]; evening: AgendaTaskItem[] } | null;
  /** Piano piatto quando non ci sono fasce (chat/engine). */
  items: AgendaTaskItem[];
}

export interface AgendaDay {
  date: string; // YYYY-MM-DD
  plan: AgendaPlan | null;
  deadlines: AgendaDeadlineItem[];
  recurring: AgendaRecurringItem[];
}

// ── input grezzi (subset dei modelli, per non dipendere dai tipi Prisma) ────
export interface AgendaPlanTaskRow {
  slot: string;
  task: {
    id: string;
    title: string;
    status: string;
    userId: string;
    recurringTemplateId: string | null;
  } | null;
}

export interface AgendaPlanRow {
  date: string;
  tasks: AgendaPlanTaskRow[];
}

export interface AgendaDeadlineRow {
  id: string;
  title: string;
  status: string;
  deadline: Date;
}

export interface AgendaTemplateRow {
  id: string;
  title: string;
  frequency: string;
  weekdays: string; // JSON int[]
  monthDay: number | null;
  startDate: string;
  endDate: string | null;
}

const FASCE = ['morning', 'afternoon', 'evening'] as const;

function toItem(t: NonNullable<AgendaPlanTaskRow['task']>): AgendaTaskItem {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    isRecurring: t.recurringTemplateId !== null,
  };
}

function buildPlan(row: AgendaPlanRow, userId: string): AgendaPlan {
  const valid = row.tasks.filter(
    (pt): pt is AgendaPlanTaskRow & { task: NonNullable<AgendaPlanTaskRow['task']> } =>
      pt.task !== null && pt.task.userId === userId,
  );
  const hasFasce = valid.some((pt) => (FASCE as readonly string[]).includes(pt.slot));
  if (hasFasce) {
    const slotItems = (slot: (typeof FASCE)[number]) =>
      valid.filter((pt) => pt.slot === slot).map((pt) => toItem(pt.task));
    return {
      source: 'review',
      slots: {
        morning: slotItems('morning'),
        afternoon: slotItems('afternoon'),
        evening: slotItems('evening'),
      },
      items: [],
    };
  }
  const source = valid.some((pt) => pt.slot === 'today') ? 'chat' : 'engine';
  return { source, slots: null, items: valid.map((pt) => toItem(pt.task)) };
}

function templateRule(t: AgendaTemplateRow): RecurrenceRule | null {
  if (!isFrequency(t.frequency)) return null;
  let weekdays: number[] = [];
  try {
    weekdays = normalizeWeekdays(JSON.parse(t.weekdays));
  } catch {
    weekdays = [];
  }
  return {
    frequency: t.frequency,
    weekdays,
    monthDay: t.monthDay,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}

export function buildAgendaDays(input: {
  from: string;
  to: string;
  /** YYYY-MM-DD Europe/Rome: le proiezioni ricorrenti partono da qui. */
  today: string;
  userId: string;
  plans: AgendaPlanRow[];
  deadlineTasks: AgendaDeadlineRow[];
  templates: AgendaTemplateRow[];
}): AgendaDay[] {
  const { from, to, today, userId } = input;

  const planByDate = new Map(input.plans.map((p) => [p.date, p]));

  // Deadline raggruppate per giorno-Rome, ordinate per orario.
  const deadlinesByDate = new Map<string, AgendaDeadlineItem[]>();
  for (const t of input.deadlineTasks) {
    const day = formatDateInRome(t.deadline);
    const list = deadlinesByDate.get(day) ?? [];
    list.push({ id: t.id, title: t.title, status: t.status, time: hhmmInRome(t.deadline) });
    deadlinesByDate.set(day, list);
  }
  for (const list of deadlinesByDate.values()) {
    list.sort((a, b) => a.time.localeCompare(b.time));
  }

  const rules = input.templates
    .map((t) => ({ template: t, rule: templateRule(t) }))
    .filter((x): x is { template: AgendaTemplateRow; rule: RecurrenceRule } => x.rule !== null);

  const days: AgendaDay[] = [];
  const span = ymdDeltaDays(from, to);
  for (let offset = 0; offset <= span; offset++) {
    const date = offset === 0 ? from : addDaysIso(from, offset);
    const planRow = planByDate.get(date);
    const plan = planRow ? buildPlan(planRow, userId) : null;

    // Template già materializzati NEL PIANO del giorno: niente chip fantasma
    // (l'istanza è visibile come voce di piano; un doppione confonde).
    const templatesInPlan = new Set<string>();
    if (planRow) {
      for (const pt of planRow.tasks) {
        if (pt.task?.recurringTemplateId) templatesInPlan.add(pt.task.recurringTemplateId);
      }
    }

    const recurring: AgendaRecurringItem[] =
      date < today
        ? []
        : rules
            .filter(({ template, rule }) => occursOn(rule, date) && !templatesInPlan.has(template.id))
            .map(({ template, rule }) => ({
              templateId: template.id,
              title: template.title,
              rule: describeRuleIt(rule),
            }));

    days.push({
      date,
      plan: plan && (plan.items.length > 0 || plan.slots !== null) ? plan : null,
      deadlines: deadlinesByDate.get(date) ?? [],
      recurring,
    });
  }

  return days;
}
