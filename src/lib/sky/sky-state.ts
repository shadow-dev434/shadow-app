/**
 * Task 55 — Stato derivato del cielo + sorprese cosmetiche. Funzioni PURE
 * (no DB, no Date.now(), no RNG salvato): mappano un conteggio di stelle accese
 * nello stato che la vista disegna.
 *
 * Loss-free per costruzione: il conteggio cresce, non decresce; `computeSkyState`
 * fa CLAMP al totale (mai overflow, mai errore, mai regressione).
 */

import { CONSTELLATIONS, type Constellation } from './constellations';

export interface ConstellationProgress {
  id: string;
  name: string;
  index: number;
  totalStars: number;
  /** stelle accese DENTRO questa costellazione (0..totalStars) */
  litStars: number;
  complete: boolean;
  reveal?: string;
}

export interface SkyState {
  /** conteggio grezzo in ingresso (per telemetria; puo' superare il totale) */
  rawLitStars: number;
  /** conteggio effettivo, clampato a [0, totalStars] */
  litStars: number;
  totalStars: number;
  /** vero quando ogni stella e' accesa */
  skyFull: boolean;
  completedCount: number;
  /** indice della costellazione che si sta riempiendo ora; null se cielo pieno */
  currentIndex: number | null;
  /** indice globale della stella appena accesa (litStars-1); null se 0 accese */
  freshStarGlobalIndex: number | null;
  /** indice della stella appena accesa DENTRO la sua costellazione; null se 0 */
  freshStarLocalIndex: number | null;
  /** progressione per ogni costellazione del catalogo */
  constellations: ConstellationProgress[];
}

/**
 * Mappa il conteggio di stelle accese nello stato del cielo. Robusta a input
 * fuori range: clampa a [0, totale], floor sui non interi, 0 sui non finiti.
 */
export function computeSkyState(
  litStars: number,
  catalog: readonly Constellation[] = CONSTELLATIONS,
): SkyState {
  const totalStars = catalog.reduce((s, c) => s + c.stars, 0);
  const raw = Number.isFinite(litStars) ? Math.floor(litStars) : 0;
  const lit = Math.max(0, Math.min(raw, totalStars));

  let acc = 0;
  let currentIndex: number | null = null;
  const constellations: ConstellationProgress[] = catalog.map((c, i) => {
    const litHere = Math.max(0, Math.min(lit - acc, c.stars));
    const complete = litHere >= c.stars;
    if (!complete && currentIndex === null) currentIndex = i;
    acc += c.stars;
    return {
      id: c.id,
      name: c.name,
      index: i,
      totalStars: c.stars,
      litStars: litHere,
      complete,
      reveal: c.reveal,
    };
  });

  const skyFull = totalStars > 0 && lit >= totalStars;
  const completedCount = constellations.filter((c) => c.complete).length;

  const freshStarGlobalIndex = lit > 0 ? lit - 1 : null;
  let freshStarLocalIndex: number | null = null;
  if (freshStarGlobalIndex !== null) {
    let a = 0;
    for (const c of catalog) {
      if (freshStarGlobalIndex < a + c.stars) {
        freshStarLocalIndex = freshStarGlobalIndex - a;
        break;
      }
      a += c.stars;
    }
  }

  return {
    rawLitStars: raw,
    litStars: lit,
    totalStars,
    skyFull,
    completedCount,
    currentIndex,
    freshStarGlobalIndex,
    freshStarLocalIndex,
    constellations,
  };
}

export interface Surprise {
  /** stella cadente accanto a questo indice (raro, ~8%) */
  shootingStar: boolean;
  /** stella gemella accanto (saltuario, ~11%) */
  twin: boolean;
  /** stella piu' brillante della media (~25%) */
  brighter: boolean;
}

/** Hash intero deterministico (Murmur-like a 32 bit), niente RNG salvato. */
function hashIndex(i: number): number {
  let x = (Math.floor(i) + 1) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

/**
 * Fioriture VARIABILI ma DETERMINISTICHE per indice di stella: stesso indice →
 * stesso esito (niente persistenza). Solo cosmetiche — non influenzano mai se
 * il progresso conta. Distribuzione non uniforme: battono l'assuefazione
 * restando leggibili.
 */
export function surpriseForStar(globalStarIndex: number): Surprise {
  const h = hashIndex(globalStarIndex);
  return {
    shootingStar: h % 13 === 0,
    twin: (h >>> 4) % 9 === 0,
    brighter: (h >>> 8) % 4 === 0,
  };
}
