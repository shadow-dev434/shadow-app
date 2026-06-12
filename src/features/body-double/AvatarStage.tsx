'use client';

// ─── AvatarStage: entry point dell'avatar companion (v3 W7) ─────────────────
// Unico componente che la vista monta: incapsula la scelta 2D/3D.
// - gate WebGL2 (probe client-only, null finché non testato)
// - chunk 3D lazy via next/dynamic (ssr:false) SOLO qui: zero bundle altrove
// - 2D mostrato da subito (i ~15MB del VRM si sentono), cross-fade al ready
// - qualunque guasto (load, render, webglcontextlost) → 2D permanente
// data-avatar-stage="2d"|"3d" per probe/QA.

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { Avatar2DFallback } from './Avatar2DFallback';
import { AvatarErrorBoundary } from './error-boundary';
import { useWebglSupport } from './hooks/use-webgl-support';
import type { AvatarState } from './types';

const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => null,
});

export function AvatarStage({ state }: { state: AvatarState }) {
  const webgl = useWebglSupport();
  const [mode, setMode] = useState<'loading' | 'ready' | 'failed'>('loading');
  const fail = useCallback(() => setMode('failed'), []);
  const ready = useCallback(() => setMode('ready'), []);

  const try3d = webgl === true && mode !== 'failed';
  const live3d = try3d && mode === 'ready';

  return (
    <div className="relative w-[260px] h-[260px]" data-avatar-stage={live3d ? '3d' : '2d'}>
      {!live3d && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar2DFallback state={state} />
        </div>
      )}
      {try3d && (
        <AvatarErrorBoundary onError={fail}>
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${
              live3d ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <AvatarCanvas state={state} onReady={ready} onFail={fail} onContextLost={fail} />
          </div>
        </AvatarErrorBoundary>
      )}
    </div>
  );
}
