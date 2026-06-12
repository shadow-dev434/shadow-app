'use client';

// ─── AvatarStage: entry point dell'avatar companion (v3 W7) ─────────────────
// Unico componente che la vista monta: incapsula la scelta 2D/3D.
//
// STATO BETA: renderizza il fallback 2D. Il ramo 3D (three + @react-three/fiber
// + @pixiv/three-vrm, modello Vita.vrm CC0 in /public/models) si innesta QUI
// quando le dipendenze sono installate (bun add sotto conferma — contratto
// Workflow v2), senza toccare i consumer:
//   1. gate WebGL2 (probe in useEffect, null finché non testato)
//   2. ErrorBoundary → fallback 2D
//   3. next/dynamic(() => import('./AvatarCanvas'), { ssr: false,
//      loading: Avatar2DFallback }) — chunk lazy solo su /focus
//   4. webglcontextlost → fallback 2D permanente per la sessione
// Design completo in docs/tasks/37-v3-w7-body-doubling.md (sezione beta web).

import { Avatar2DFallback } from './Avatar2DFallback';
import type { AvatarState } from './types';

export function AvatarStage({ state }: { state: AvatarState }) {
  return <Avatar2DFallback state={state} />;
}
