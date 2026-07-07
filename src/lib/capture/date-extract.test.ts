/**
 * Task 72 (B2) — test dell'estrattore cheap di scadenze (zero LLM).
 * "Oggi" fisso: 2026-07-08 (mercoledì), iniettato per determinismo.
 */
import { describe, it, expect } from 'vitest';
import { extractDateCandidates, extractDeadline } from './date-extract';

const TODAY = '2026-07-08';

describe('extractDateCandidates — formati numerici', () => {
  it('gg/mm/aaaa con keyword: confident', () => {
    const out = extractDateCandidates('Pagare entro il 15/08/2026 la bolletta Enel', TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-08-15');
    expect(out[0].confident).toBe(true);
    expect(out[0].snippet).toContain('15/08/2026');
  });

  it('gg/mm/aaaa senza keyword: confident comunque (anno esplicito)', () => {
    const out = extractDateCandidates('riunione fissata il 15/08/2026', TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: '2026-08-15', confident: true });
  });

  it('gg/mm senza anno né keyword: candidato non-confident, anno corrente', () => {
    const out = extractDateCandidates('ci vediamo il 20/07 in ufficio', TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: '2026-07-20', confident: false });
  });

  it('gg/mm già passata: inferisce l\'anno successivo', () => {
    const out = extractDateCandidates('il 05/01 si riparte', TODAY);
    expect(out[0].date).toBe('2027-01-05');
  });

  it('gg/mm con keyword di scadenza: confident', () => {
    const out = extractDateCandidates('scadenza 20/07', TODAY);
    expect(out[0]).toMatchObject({ date: '2026-07-20', confident: true });
  });

  it('gg.mm.aaaa (punto CON anno): accettata', () => {
    const out = extractDateCandidates('AVVISO TARI — versare entro 31.07.2026', TODAY);
    expect(out[0]).toMatchObject({ date: '2026-07-31', confident: true });
  });

  it('anno a 2 cifre: 15/08/26 → 2026', () => {
    const out = extractDateCandidates('entro il 15/08/26', TODAY);
    expect(out[0]).toMatchObject({ date: '2026-08-15', confident: true });
  });

  it('separatori misti (15/08-2026): respinta', () => {
    // La backreference impone lo stesso separatore: resta solo la coppia 15/08.
    const out = extractDateCandidates('nota 15/08-2026', TODAY);
    expect(out.map((c) => c.date)).toEqual(['2026-08-15']);
    expect(out[0].confident).toBe(false);
  });
});

describe('extractDateCandidates — anti falsi positivi', () => {
  it('importo col punto (15.08 euro): nessun candidato', () => {
    expect(extractDateCandidates('importo di 15.08 euro', TODAY)).toEqual([]);
  });

  it('migliaia 1.234,56: nessun candidato', () => {
    expect(extractDateCandidates('totale 1.234,56 EUR', TODAY)).toEqual([]);
  });

  it('date impossibili (32/12, 31/06, 29/02 non bisestile): respinte', () => {
    expect(extractDateCandidates('entro il 32/12/2026', TODAY)).toEqual([]);
    expect(extractDateCandidates('entro il 31/06/2026', TODAY)).toEqual([]);
    expect(extractDateCandidates('entro il 29/02/2026', TODAY)).toEqual([]);
  });

  it('URL con path a date: strippato, nessun candidato', () => {
    const out = extractDateCandidates(
      'guarda https://esempio.it/2026/06/12/articolo-15-08 fantastico',
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('mese dentro una parola (3 maglie): nessun candidato', () => {
    expect(extractDateCandidates('comprare 3 maglie', TODAY)).toEqual([]);
  });

  it('testo vuoto o senza date', () => {
    expect(extractDateCandidates('', TODAY)).toEqual([]);
    expect(extractDateCandidates('comprare il latte', TODAY)).toEqual([]);
  });
});

describe('extractDateCandidates — formati testuali', () => {
  it('giorno + mese + anno: confident', () => {
    const out = extractDateCandidates('consegna entro il 5 agosto 2026', TODAY);
    expect(out[0]).toMatchObject({ date: '2026-08-05', confident: true });
  });

  it('giorno + mese senza anno: prossima occorrenza, non-confident', () => {
    const out = extractDateCandidates('ne parliamo il 3 marzo', TODAY);
    expect(out[0]).toMatchObject({ date: '2027-03-03', confident: false });
  });

  it('abbreviazione con keyword puntata ("scad.: 15 ago")', () => {
    const out = extractDateCandidates('scad.: 15 ago', TODAY);
    expect(out[0]).toMatchObject({ date: '2026-08-15', confident: true });
  });

  it('ordinale "1° luglio 2026"', () => {
    const out = extractDateCandidates('dal 1° luglio 2026', TODAY);
    expect(out[0].date).toBe('2026-07-01');
  });

  it('"sett" non ruba il match a "settembre"', () => {
    const out = extractDateCandidates('il 12 settembre 2026', TODAY);
    expect(out[0].date).toBe('2026-09-12');
  });
});

describe('dedupe e ordinamento', () => {
  it('stessa data due volte: un solo candidato', () => {
    const out = extractDateCandidates('15/08/2026, ripeto: 15/08/2026', TODAY);
    expect(out).toHaveLength(1);
  });

  it('duplicato confident promuove il candidato', () => {
    const out = extractDateCandidates('il 20/07 — pagare entro il 20/07', TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].confident).toBe(true);
  });

  it('più date: ordinate per posizione', () => {
    const out = extractDateCandidates('prima il 10/07/2026 e poi il 20/08/2026', TODAY);
    expect(out.map((c) => c.date)).toEqual(['2026-07-10', '2026-08-20']);
  });
});

describe('extractDeadline', () => {
  it('primo confident, saltando i non-confident', () => {
    expect(extractDeadline('il 10/07 e pagare entro il 20/07/2026', TODAY)).toBe('2026-07-20');
  });

  it('null se nessun confident (dd/mm nuda non basta)', () => {
    expect(extractDeadline('ci sentiamo il 20/07', TODAY)).toBeNull();
    expect(extractDeadline('comprare il latte', TODAY)).toBeNull();
  });
});
