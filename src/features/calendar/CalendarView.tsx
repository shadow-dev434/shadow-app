'use client';

/**
 * Task 74 — Agenda settimanale (vista `calendar` della TasksApp).
 *
 * Visualizzazione immediata di impegni e scadenze: 7 giorni (lun→dom), per
 * ogni giorno le fasce del piano (review serale), le scadenze con orario
 * Europe/Rome e i ricorrenti proiettati (chip tratteggiati, non interattivi).
 * Niente griglia oraria: i dati di Shadow pianificano per fasce, non per
 * orologio (spec docs/tasks/74-vista-calendario.md).
 *
 * "Oggi" e i confini della settimana usano l'orologio del device, come il
 * resto del client (utenti target it-IT ≈ Europe/Rome).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, Repeat } from 'lucide-react';
import { apiFetch } from '@/lib/api/fetch';
import { addDaysIso } from '@/lib/evening-review/dates';
import { WEEKDAY_NAMES_IT, weekdayOf } from '@/lib/recurring/recurrence';
import type { AgendaDay, AgendaTaskItem } from '@/lib/calendar/agenda';

const MONTH_NAMES_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
] as const;

/** YYYY-MM-DD locale del device (stessa convenzione del resto del client). */
function todayLocalYmd(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Lunedì della settimana che contiene la data (lun→dom, convenzione it). */
function mondayOf(ymd: string): string {
  const dow = weekdayOf(ymd); // 0=domenica .. 6=sabato
  return addDaysIso(ymd, -((dow + 6) % 7));
}

function dayNumber(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

function monthLabel(ymd: string): string {
  return MONTH_NAMES_IT[Number(ymd.slice(5, 7)) - 1] ?? '';
}

/** "14–20 luglio" oppure "28 luglio – 3 agosto" a cavallo di mese. */
function weekLabel(monday: string): string {
  const sunday = addDaysIso(monday, 6);
  if (monday.slice(0, 7) === sunday.slice(0, 7)) {
    return `${dayNumber(monday)}–${dayNumber(sunday)} ${monthLabel(monday)}`;
  }
  return `${dayNumber(monday)} ${monthLabel(monday)} – ${dayNumber(sunday)} ${monthLabel(sunday)}`;
}

const SLOT_LABELS: Array<{ key: 'morning' | 'afternoon' | 'evening'; label: string }> = [
  { key: 'morning', label: 'Mattina' },
  { key: 'afternoon', label: 'Pomeriggio' },
  { key: 'evening', label: 'Sera' },
];

function TaskChip({ task, onOpen }: { task: AgendaTaskItem; onOpen: (id: string) => void }) {
  const done = task.status === 'completed';
  return (
    <button
      onClick={() => onOpen(task.id)}
      className="w-full flex items-center gap-2 rounded-lg bg-zinc-800/80 border border-zinc-700/60 px-2.5 py-1.5 text-left active:bg-zinc-700 transition-colors"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${done ? 'bg-emerald-500' : 'bg-amber-500'}`}
      />
      <span className={`text-sm truncate ${done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
        {task.title}
      </span>
      {task.isRecurring && <Repeat className="w-3 h-3 text-zinc-500 shrink-0" />}
    </button>
  );
}

function DayCard({
  day,
  isToday,
  onOpenTask,
}: {
  day: AgendaDay;
  isToday: boolean;
  onOpenTask: (id: string) => void;
}) {
  const weekdayName = WEEKDAY_NAMES_IT[weekdayOf(day.date)];
  const planItems = day.plan
    ? day.plan.slots
      ? SLOT_LABELS.map(({ key, label }) => ({ label, tasks: day.plan!.slots![key] })).filter(
          (s) => s.tasks.length > 0,
        )
      : day.plan.items.length > 0
        ? [{ label: 'Piano', tasks: day.plan.items }]
        : []
    : [];
  const isEmpty = planItems.length === 0 && day.deadlines.length === 0 && day.recurring.length === 0;

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 ${
        isToday ? 'border-amber-600/70 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-bold ${isToday ? 'text-amber-500' : 'text-zinc-200'}`}>
          {dayNumber(day.date)}
        </span>
        <span className={`text-xs capitalize ${isToday ? 'text-amber-500/90' : 'text-zinc-500'}`}>
          {weekdayName}
        </span>
        {isToday && <span className="text-[10px] uppercase tracking-wide text-amber-500">oggi</span>}
      </div>

      {isEmpty && <p className="text-xs text-zinc-600">Niente in agenda</p>}

      {day.deadlines.length > 0 && (
        <div className="space-y-1">
          {day.deadlines.map((d) => (
            <button
              key={d.id}
              onClick={() => onOpenTask(d.id)}
              className="w-full flex items-center gap-2 rounded-lg bg-red-950/40 border border-red-900/50 px-2.5 py-1.5 text-left active:bg-red-950/70 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="text-xs font-mono text-red-300 shrink-0">{d.time}</span>
              <span className="text-sm text-zinc-200 truncate">{d.title}</span>
            </button>
          ))}
        </div>
      )}

      {planItems.map((section) => (
        <div key={section.label} className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">{section.label}</p>
          {section.tasks.map((t) => (
            <TaskChip key={t.id} task={t} onOpen={onOpenTask} />
          ))}
        </div>
      ))}

      {day.recurring.length > 0 && (
        <div className="space-y-1">
          {day.recurring.map((r) => (
            <div
              key={r.templateId}
              className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-2.5 py-1.5"
              title={r.rule}
            >
              <Repeat className="w-3 h-3 text-zinc-500 shrink-0" />
              <span className="text-sm text-zinc-400 truncate">{r.title}</span>
              <span className="text-[10px] text-zinc-600 truncate shrink-0">{r.rule}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CalendarView({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const today = useMemo(() => todayLocalYmd(), []);
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocalYmd()));
  const [days, setDays] = useState<AgendaDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadWeek = useCallback(async (monday: string) => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch(
        `/api/calendar?from=${monday}&to=${addDaysIso(monday, 6)}`,
        { skipErrorToast: true },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { days?: AgendaDay[] };
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch {
      setDays(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Agenda</h2>
            <p className="text-xs text-zinc-500">{weekLabel(weekStart)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart((w) => addDaysIso(w, -7))}
            aria-label="Settimana precedente"
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-800"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setWeekStart(mondayOf(today))}
            className="px-2.5 py-1.5 rounded-lg text-xs text-amber-500 border border-zinc-700 active:bg-zinc-800"
          >
            Oggi
          </button>
          <button
            onClick={() => setWeekStart((w) => addDaysIso(w, 7))}
            aria-label="Settimana successiva"
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-800"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center space-y-2">
          <p className="text-sm text-zinc-400">Non riesco a caricare l&apos;agenda.</p>
          <button
            onClick={() => void loadWeek(weekStart)}
            className="text-xs text-amber-500 underline"
          >
            Riprova
          </button>
        </div>
      )}

      {!loading && !error && days && (
        <div className="space-y-2">
          {days.map((day) => (
            <DayCard key={day.date} day={day} isToday={day.date === today} onOpenTask={onOpenTask} />
          ))}
        </div>
      )}
    </div>
  );
}
