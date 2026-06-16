/**
 * Task 55 — Catalogo statico delle costellazioni ("Il cielo").
 *
 * Solo dati, niente DB, niente Date.now(): puro e testabile a tavolino.
 * Ogni completamento di un task ricorrente accende una stella; le stelle
 * riempiono UNA costellazione alla volta, in ordine. Curva crescente: la prima
 * si completa in 4 accensioni (early win), l'ultima in 12 (cielo pieno).
 *
 * `positions` sono normalizzate 0..1 nel BOX della singola costellazione
 * (0,0 = alto-sinistra), non sul cielo intero: la vista le scala dove disegna
 * la figura (grande quella corrente, piccola le complete). `lines` collega
 * coppie di indici di `positions`: la figura "si disegna" man mano che le sue
 * stelle si accendono.
 *
 * Catalogo starter generato per Task 55 (rivedibile): nomi evocativi con i
 * callback affettuosi all'Albero e alla Casa richiesti nel brief.
 */

export interface ConstellationStar {
  /** x normalizzata 0..1 nel box della costellazione */
  x: number;
  /** y normalizzata 0..1 nel box (0 = alto, 1 = basso, convenzione SVG) */
  y: number;
}

export interface Constellation {
  id: string;
  /** nome italiano, evocativo */
  name: string;
  /** numero di stelle (== positions.length, esplicito per leggibilita') */
  stars: number;
  positions: ConstellationStar[];
  /** coppie di indici in positions da collegare quando entrambe accese */
  lines: [number, number][];
  /** etichetta cosmetica della "fioritura" a costellazione completa */
  reveal?: string;
}

const p = (x: number, y: number): ConstellationStar => ({ x, y });

/** Ordine = ordine di riempimento. NON riordinare senza ripensare la progressione. */
export const CONSTELLATIONS: Constellation[] = [
  {
    id: 'lucciola',
    name: 'La Lucciola',
    stars: 4,
    positions: [p(0.35, 0.55), p(0.5, 0.4), p(0.65, 0.55), p(0.5, 0.7)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]],
    reveal: 'glow',
  },
  {
    id: 'ponte',
    name: 'Il Ponte',
    stars: 5,
    positions: [p(0.1, 0.72), p(0.3, 0.46), p(0.5, 0.38), p(0.7, 0.46), p(0.9, 0.72)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    id: 'barca',
    name: 'La Barca',
    stars: 6,
    positions: [p(0.25, 0.58), p(0.75, 0.58), p(0.68, 0.78), p(0.32, 0.78), p(0.5, 0.58), p(0.5, 0.26)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]],
  },
  {
    id: 'albero',
    name: "L'Albero",
    stars: 7,
    positions: [p(0.5, 0.86), p(0.5, 0.6), p(0.5, 0.34), p(0.32, 0.5), p(0.68, 0.5), p(0.4, 0.3), p(0.6, 0.3)],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6]],
    reveal: 'foliage',
  },
  {
    id: 'gufo',
    name: 'Il Gufo',
    stars: 7,
    positions: [p(0.38, 0.42), p(0.62, 0.42), p(0.3, 0.26), p(0.7, 0.26), p(0.5, 0.54), p(0.36, 0.72), p(0.64, 0.72)],
    lines: [[2, 0], [3, 1], [0, 1], [0, 4], [1, 4], [4, 5], [4, 6], [5, 6]],
    reveal: 'eyes',
  },
  {
    id: 'chiave',
    name: 'La Chiave',
    stars: 8,
    positions: [p(0.3, 0.34), p(0.21, 0.5), p(0.3, 0.66), p(0.39, 0.5), p(0.52, 0.5), p(0.66, 0.5), p(0.8, 0.5), p(0.74, 0.64)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6], [6, 7]],
  },
  {
    id: 'casa',
    name: 'La Casa',
    stars: 8,
    positions: [p(0.25, 0.5), p(0.75, 0.5), p(0.75, 0.82), p(0.25, 0.82), p(0.5, 0.26), p(0.45, 0.6), p(0.45, 0.82), p(0.62, 0.36)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1], [4, 7], [5, 6]],
    reveal: 'window',
  },
  {
    id: 'fiume',
    name: 'Il Fiume',
    stars: 9,
    positions: [p(0.08, 0.28), p(0.22, 0.4), p(0.33, 0.32), p(0.46, 0.46), p(0.56, 0.38), p(0.68, 0.55), p(0.78, 0.46), p(0.88, 0.62), p(0.94, 0.55)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
    reveal: 'flow',
  },
  {
    id: 'vela',
    name: 'La Vela',
    stars: 9,
    positions: [p(0.5, 0.2), p(0.5, 0.7), p(0.78, 0.7), p(0.62, 0.36), p(0.69, 0.53), p(0.3, 0.72), p(0.8, 0.72), p(0.72, 0.86), p(0.38, 0.86)],
    lines: [[0, 1], [0, 3], [3, 4], [4, 2], [1, 2], [5, 6], [6, 7], [7, 8], [8, 5]],
  },
  {
    id: 'montagna',
    name: 'La Montagna',
    stars: 10,
    positions: [p(0.08, 0.82), p(0.25, 0.55), p(0.38, 0.66), p(0.52, 0.3), p(0.66, 0.58), p(0.8, 0.5), p(0.93, 0.82), p(0.52, 0.16), p(0.25, 0.4), p(0.8, 0.36)],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 7], [1, 8], [5, 9]],
    reveal: 'snow',
  },
  {
    id: 'fenice',
    name: 'La Fenice',
    stars: 11,
    positions: [p(0.5, 0.2), p(0.5, 0.45), p(0.5, 0.65), p(0.3, 0.35), p(0.18, 0.5), p(0.3, 0.6), p(0.7, 0.35), p(0.82, 0.5), p(0.7, 0.6), p(0.42, 0.8), p(0.58, 0.8)],
    lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 2], [1, 6], [6, 7], [7, 8], [8, 2], [2, 9], [2, 10]],
    reveal: 'fire',
  },
  {
    id: 'corona',
    name: 'La Corona',
    stars: 12,
    positions: [p(0.2, 0.65), p(0.5, 0.7), p(0.8, 0.65), p(0.2, 0.4), p(0.35, 0.55), p(0.5, 0.35), p(0.65, 0.55), p(0.8, 0.4), p(0.18, 0.72), p(0.82, 0.72), p(0.35, 0.62), p(0.65, 0.62)],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 2], [0, 8], [2, 9], [8, 9]],
    reveal: 'aurora',
  },
];

/** Totale stelle del cielo (derivato, non hardcoded). */
export const TOTAL_SKY_STARS: number = CONSTELLATIONS.reduce((s, c) => s + c.stars, 0);
