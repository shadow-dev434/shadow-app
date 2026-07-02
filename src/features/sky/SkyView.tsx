'use client';

/**
 * Task 55 — "Il tuo cielo": schermata watch-only. Nessuna azione, nessun
 * pulsante: il visual celebra cio' che hai fatto (stelle accese coi task
 * ricorrenti), mai rinfaccia cio' che hai saltato. Niente percentuale globale
 * "quanto manca" (sa di debito): solo il nome della costellazione corrente e
 * "X / Y stelle" dentro quella (piccoli traguardi).
 *
 * Lo stato arriva derivato da GET /api/sky; la geometria dal catalogo statico
 * (single source of truth condivisa col conteggio server-side).
 */

import { useEffect, useState } from 'react';
import { CONSTELLATIONS } from '@/lib/sky/constellations';
import { surpriseForStar, type SkyState } from '@/lib/sky/sky-state';

const PAD = 14;
const SPAN = 100 - PAD * 2;
const sx = (x: number) => PAD + x * SPAN;
const sy = (y: number) => PAD + y * SPAN;

/** Localizza una stella globale (indice catalogo cumulativo) nel suo box. */
function locateStar(globalIndex: number | null): { ci: number; li: number } | null {
  if (globalIndex === null) return null;
  let acc = 0;
  for (let i = 0; i < CONSTELLATIONS.length; i++) {
    const n = CONSTELLATIONS[i].stars;
    if (globalIndex < acc + n) return { ci: i, li: globalIndex - acc };
    acc += n;
  }
  return null;
}

export function SkyView() {
  const [state, setState] = useState<SkyState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/sky')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { state: SkyState }) => {
        if (alive) setState(data.state);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-hidden rounded-2xl">
      <SkyStyles />
      {/* Cielo notturno + nebulosa tenue */}
      <div className="skyview-bg absolute inset-0" aria-hidden />

      <div className="relative z-10 flex flex-col items-center px-4 py-8">
        {!state && !error && <p className="mt-16 text-sm text-zinc-400">Sto guardando il cielo…</p>}
        {error && (
          <p className="mt-16 text-sm text-zinc-400">
            Il cielo è coperto per un attimo. Riprova più tardi.
          </p>
        )}
        {state && <Sky state={state} />}
      </div>
    </div>
  );
}

function Sky({ state }: { state: SkyState }) {
  const fresh = locateStar(state.freshStarGlobalIndex);
  const heroIndex = fresh ? fresh.ci : 0;
  const hero = CONSTELLATIONS[heroIndex];
  const heroProgress = state.constellations[heroIndex];
  const heroLit = heroProgress?.litStars ?? 0;
  const freshLocal = fresh && fresh.ci === heroIndex ? fresh.li : null;
  const completed = state.constellations.filter((c) => c.complete);
  const surprise =
    state.freshStarGlobalIndex !== null ? surpriseForStar(state.freshStarGlobalIndex) : null;

  return (
    <>
      {/* Galleria delle costellazioni complete (cumulo permanente, niente perdita) */}
      {completed.length > 0 && (
        <div className="mb-6 flex max-w-md flex-wrap justify-center gap-2">
          {completed.map((c) => (
            <span
              key={c.id}
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200/90"
            >
              ✦ {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Costellazione protagonista (corrente, o l'ultima a cielo pieno) */}
      <div className={`relative w-full max-w-[360px] ${state.skyFull ? 'skyview-aurora-host' : ''}`}>
        <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label={`Costellazione ${hero.name}`}>
          {/* linee: solo tra stelle entrambe accese → la figura "si disegna" */}
          {hero.lines.map(([a, b], i) =>
            a < heroLit && b < heroLit ? (
              <line
                key={`l${i}`}
                x1={sx(hero.positions[a].x)}
                y1={sy(hero.positions[a].y)}
                x2={sx(hero.positions[b].x)}
                y2={sy(hero.positions[b].y)}
                stroke="rgba(251, 191, 36, 0.45)"
                strokeWidth={0.5}
                strokeLinecap="round"
              />
            ) : null,
          )}

          {/* stelle */}
          {hero.positions.map((pos, i) => {
            const lit = i < heroLit;
            const isFresh = i === freshLocal;
            const cx = sx(pos.x);
            const cy = sy(pos.y);
            if (!lit) {
              return <circle key={`s${i}`} cx={cx} cy={cy} r={0.7} fill="rgba(226, 232, 240, 0.18)" />;
            }
            return (
              <g key={`s${i}`}>
                {isFresh && (
                  <circle className="skyview-pulse" cx={cx} cy={cy} r={2.4} fill="none" stroke="rgba(251, 191, 36, 0.6)" strokeWidth={0.5} />
                )}
                <circle
                  className="skyview-twinkle"
                  style={{ animationDelay: `${(i % 5) * 0.6}s` }}
                  cx={cx}
                  cy={cy}
                  r={isFresh ? 2 : surprise?.brighter && i === heroLit - 1 ? 1.8 : 1.5}
                  fill="#fde68a"
                />
              </g>
            );
          })}

          {/* sorpresa: stella cadente accanto alla stella fresca (cosmetica) */}
          {surprise?.shootingStar && freshLocal !== null && (
            <line
              className="skyview-shooting"
              x1={sx(hero.positions[freshLocal].x) - 8}
              y1={sy(hero.positions[freshLocal].y) - 8}
              x2={sx(hero.positions[freshLocal].x)}
              y2={sy(hero.positions[freshLocal].y)}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={0.4}
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>

      {/* Sottotitolo gentile — mai una percentuale globale */}
      <div className="mt-6 text-center">
        {state.skyFull ? (
          <>
            <p className="text-base font-medium text-amber-200">Il cielo è pieno ✦</p>
            <p className="mt-1 text-xs text-zinc-400">Ogni costellazione è accesa. Resta qui quando vuoi.</p>
          </>
        ) : heroProgress?.complete ? (
          <>
            <p className="text-base font-medium text-amber-200">Hai completato {hero.name} ✦</p>
            <p className="mt-1 text-xs text-zinc-400">Una nuova costellazione ti aspetta.</p>
          </>
        ) : state.litStars === 0 ? (
          // Task 64 (A3, D48): a cielo spento la vista si spiega — da dove
          // arrivano le stelle e come accenderne una, con ingresso diretto in
          // chat (input precompilato, non inviato: decide l'utente).
          <>
            <p className="text-base font-medium text-amber-100">{hero.name}</p>
            <p className="mx-auto mt-2 max-w-[300px] text-xs leading-relaxed text-zinc-400">
              Le stelle si accendono completando i task ricorrenti — creane uno in
              chat («ogni lunedì palestra»).
            </p>
            <button
              type="button"
              onClick={() => {
                window.location.href =
                  '/?draft=' + encodeURIComponent('Voglio un task ricorrente: ogni ');
              }}
              className="mt-4 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
            >
              ✦ Creane uno in chat
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-medium text-amber-100">{hero.name}</p>
            <p className="mt-1 text-xs text-zinc-400">
              {heroLit} / {hero.stars} stelle
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** Keyframes + nebulosa, con rispetto di prefers-reduced-motion. */
function SkyStyles() {
  return (
    <style>{`
      .skyview-bg {
        background:
          radial-gradient(120% 80% at 50% 0%, rgba(76, 29, 149, 0.35), transparent 60%),
          radial-gradient(90% 60% at 80% 100%, rgba(30, 64, 175, 0.30), transparent 55%),
          linear-gradient(180deg, #0b1026 0%, #070a18 100%);
      }
      .skyview-aurora-host::before {
        content: '';
        position: absolute; inset: -10%;
        background: radial-gradient(60% 50% at 50% 40%, rgba(45, 212, 191, 0.18), transparent 70%);
        animation: skyview-aurora 9s ease-in-out infinite;
        pointer-events: none;
      }
      .skyview-twinkle { animation: skyview-twinkle 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      .skyview-pulse { animation: skyview-pulse 2.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
      .skyview-shooting { animation: skyview-shooting 2.8s ease-in-out infinite; }
      @keyframes skyview-twinkle { 0%,100% { opacity: 0.85; } 50% { opacity: 1; } }
      @keyframes skyview-pulse { 0% { opacity: 0.8; transform: scale(0.7); } 100% { opacity: 0; transform: scale(1.6); } }
      @keyframes skyview-shooting { 0%,70% { opacity: 0; } 80% { opacity: 0.9; } 100% { opacity: 0; } }
      @keyframes skyview-aurora { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .skyview-twinkle, .skyview-pulse, .skyview-shooting { animation: none; }
        .skyview-aurora-host::before { animation: none; opacity: 0.7; }
        .skyview-pulse { display: none; }
      }
    `}</style>
  );
}
