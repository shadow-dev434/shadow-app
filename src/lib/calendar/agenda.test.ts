import { describe, it, expect } from 'vitest';
import { buildAgendaDays, type AgendaPlanRow, type AgendaTemplateRow } from './agenda';

const USER = 'u1';

function planRow(date: string, tasks: Array<{ slot: string; id: string; title?: string; templateId?: string | null; userId?: string }>): AgendaPlanRow {
  return {
    date,
    tasks: tasks.map((t) => ({
      slot: t.slot,
      task: {
        id: t.id,
        title: t.title ?? t.id,
        status: 'planned',
        userId: t.userId ?? USER,
        recurringTemplateId: t.templateId ?? null,
      },
    })),
  };
}

function dailyTemplate(id: string, title: string, startDate = '2026-01-01'): AgendaTemplateRow {
  return { id, title, frequency: 'daily', weekdays: '[]', monthDay: null, startDate, endDate: null };
}

const BASE = {
  from: '2026-07-20',
  to: '2026-07-26',
  today: '2026-07-20',
  userId: USER,
  plans: [] as AgendaPlanRow[],
  deadlineTasks: [],
  templates: [] as AgendaTemplateRow[],
};

describe('buildAgendaDays', () => {
  it('genera un giorno per ogni data del range, inclusi gli estremi', () => {
    const days = buildAgendaDays(BASE);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-07-20');
    expect(days[6].date).toBe('2026-07-26');
  });

  it('piano con fasce → source review e slots popolati', () => {
    const days = buildAgendaDays({
      ...BASE,
      plans: [planRow('2026-07-21', [
        { slot: 'morning', id: 't1', title: 'Scrivere report' },
        { slot: 'evening', id: 't2', title: 'Palestra' },
      ])],
    });
    const day = days[1];
    expect(day.plan?.source).toBe('review');
    expect(day.plan?.slots?.morning.map((t) => t.title)).toEqual(['Scrivere report']);
    expect(day.plan?.slots?.evening.map((t) => t.title)).toEqual(['Palestra']);
    expect(day.plan?.items).toEqual([]);
  });

  it('piano senza fasce: slot today → chat, altrimenti engine; items piatti', () => {
    const days = buildAgendaDays({
      ...BASE,
      plans: [
        planRow('2026-07-20', [{ slot: 'today', id: 'a' }]),
        planRow('2026-07-21', [{ slot: 'top3', id: 'b' }]),
      ],
    });
    expect(days[0].plan?.source).toBe('chat');
    expect(days[0].plan?.slots).toBeNull();
    expect(days[0].plan?.items.map((t) => t.id)).toEqual(['a']);
    expect(days[1].plan?.source).toBe('engine');
  });

  it('scarta task di altri utenti e righe senza task; piano vuoto → null', () => {
    const row = planRow('2026-07-20', [{ slot: 'morning', id: 'x', userId: 'ALTRO' }]);
    row.tasks.push({ slot: 'morning', task: null });
    const days = buildAgendaDays({ ...BASE, plans: [row] });
    expect(days[0].plan).toBeNull();
  });

  it('deadline: giorno e orario in Europe/Rome, ordinate per orario', () => {
    // 2026-07-22T21:50Z = 23:50 Rome stesso giorno; 22:30Z = 00:30 Rome del 23.
    const days = buildAgendaDays({
      ...BASE,
      deadlineTasks: [
        { id: 'd2', title: 'Tardi', status: 'inbox', deadline: new Date('2026-07-22T21:50:00Z') },
        { id: 'd1', title: 'Pomeriggio', status: 'inbox', deadline: new Date('2026-07-22T13:00:00Z') },
        { id: 'd3', title: 'Oltre mezzanotte Rome', status: 'inbox', deadline: new Date('2026-07-22T22:30:00Z') },
      ],
    });
    const day22 = days.find((d) => d.date === '2026-07-22');
    const day23 = days.find((d) => d.date === '2026-07-23');
    expect(day22?.deadlines.map((d) => `${d.time} ${d.title}`)).toEqual([
      '15:00 Pomeriggio',
      '23:50 Tardi',
    ]);
    expect(day23?.deadlines.map((d) => d.time)).toEqual(['00:30']);
  });

  it('ricorrenti: proiettati da today in poi, mai nel passato del range', () => {
    const days = buildAgendaDays({
      ...BASE,
      today: '2026-07-23',
      templates: [dailyTemplate('r1', 'Meditazione')],
    });
    expect(days.find((d) => d.date === '2026-07-22')?.recurring).toEqual([]);
    expect(days.find((d) => d.date === '2026-07-23')?.recurring.map((r) => r.title)).toEqual(['Meditazione']);
    expect(days.find((d) => d.date === '2026-07-26')?.recurring[0]?.rule).toBe('tutti i giorni');
  });

  it('ricorrenti: weekly rispetta i giorni; finestra startDate/endDate', () => {
    const weekly: AgendaTemplateRow = {
      id: 'r2', title: 'Spesa', frequency: 'weekly', weekdays: '[1]', // lunedì
      monthDay: null, startDate: '2026-01-01', endDate: '2026-07-21',
    };
    const days = buildAgendaDays({ ...BASE, templates: [weekly] });
    // 2026-07-20 è lunedì e dentro la finestra; il lunedì successivo (27) è fuori range,
    // e comunque endDate=21 chiude la regola.
    expect(days[0].recurring.map((r) => r.title)).toEqual(['Spesa']);
    expect(days.filter((d) => d.date > '2026-07-21').every((d) => d.recurring.length === 0)).toBe(true);
  });

  it('ricorrenti: niente chip fantasma se l\'istanza è già nel piano del giorno', () => {
    const days = buildAgendaDays({
      ...BASE,
      plans: [planRow('2026-07-20', [{ slot: 'morning', id: 'i1', title: 'Meditazione', templateId: 'r1' }])],
      templates: [dailyTemplate('r1', 'Meditazione')],
    });
    expect(days[0].recurring).toEqual([]); // istanza visibile nel piano
    expect(days[1].recurring.map((r) => r.title)).toEqual(['Meditazione']); // domani solo proiezione
    expect(days[0].plan?.slots?.morning[0]?.isRecurring).toBe(true);
  });

  it('template con frequency invalida o weekdays malformati non rompono', () => {
    const days = buildAgendaDays({
      ...BASE,
      templates: [
        { id: 'bad1', title: 'Rotta', frequency: 'lunar', weekdays: '[]', monthDay: null, startDate: '2026-01-01', endDate: null },
        { id: 'bad2', title: 'JSON rotto', frequency: 'weekly', weekdays: 'non-json', monthDay: null, startDate: '2026-01-01', endDate: null },
      ],
    });
    expect(days.every((d) => d.recurring.length === 0)).toBe(true);
  });
});
