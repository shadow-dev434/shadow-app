'use client';

// ─── AvatarCanvas: scena R3F del companion (v3 W7) ──────────────────────────
// Montato SOLO via next/dynamic da AvatarStage: three/@react-three/fiber/
// @pixiv/three-vrm vivono in questo chunk lazy (zero impatto sul resto).
// <Canvas flat> = NoToneMapping: il toon shading MToon va reso senza tone
// mapping (l'ACESFilmic di default di R3F slava i colori dei VRM).

import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import type { AvatarState } from './types';
import { useVrm } from './hooks/use-vrm';
import { useFrameLimiter } from './hooks/use-frame-limiter';
import { AvatarModel } from './AvatarModel';

const AVATAR_URL = '/models/avatar-v1.vrm';

function FrameLimiter() {
  useFrameLimiter(30);
  return null;
}

function VrmScene({
  state,
  onReady,
  onFail,
}: {
  state: AvatarState;
  onReady: () => void;
  onFail: () => void;
}) {
  const { vrm, failed } = useVrm(AVATAR_URL);
  useEffect(() => {
    if (vrm) onReady();
  }, [vrm, onReady]);
  useEffect(() => {
    if (failed) onFail();
  }, [failed, onFail]);
  if (!vrm) return null;
  return <AvatarModel vrm={vrm} state={state} />;
}

export default function AvatarCanvas({
  state,
  onReady,
  onFail,
  onContextLost,
}: {
  state: AvatarState;
  onReady: () => void;
  onFail: () => void;
  onContextLost: () => void;
}) {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ powerPreference: 'low-power', antialias: true, alpha: true }}
      camera={{ fov: 30, position: [0, 1.35, 1.7] }}
      onCreated={({ gl, camera }) => {
        // Inquadratura mezzo busto: camera all'altezza della testa.
        camera.lookAt(0, 1.3, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          onContextLost();
        });
      }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[1, 2, 3]} intensity={1.4} />
      <FrameLimiter />
      <VrmScene state={state} onReady={onReady} onFail={onFail} />
    </Canvas>
  );
}
