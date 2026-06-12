'use client';

// ─── AvatarModel: rig procedurale del VRM (v3 W7) ───────────────────────────
// Scrive sui normalized bone nodes e sull'expressionManager, poi chiama
// vrm.update(delta) — SEMPRE per ultimo: copia normalized→raw, applica
// expressions, lookAt e springbones (i capelli oscillano "gratis").
// Niente file di animazione: tutto procedurale (doc 37, presenza senza costi).

import { useEffect, useMemo, useRef } from 'react';
import { Object3D } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { VRM } from '@pixiv/three-vrm';
import type { AvatarState } from './types';
import { ANIMATION_PARAMS, type AnimParams } from './lib/animation-params';
import {
  blinkValue,
  breathValue,
  dampParams,
  lookOffsets,
  nextBlinkDelay,
  swayValues,
  talkMouthValue,
} from './lib/procedural-animation';

export function AvatarModel({ vrm, state }: { vrm: VRM; state: AvatarState }) {
  const { camera, scene } = useThree();
  const lookTarget = useMemo(() => new Object3D(), []);
  const t = useRef(0);
  const params = useRef<AnimParams>({ ...ANIMATION_PARAMS.present });
  const blinkTimer = useRef(nextBlinkDelay(ANIMATION_PARAMS.present.blinkEvery));
  const blinkPhase = useRef(0);

  const bones = useMemo(
    () => ({
      hips: vrm.humanoid.getNormalizedBoneNode('hips'),
      spine: vrm.humanoid.getNormalizedBoneNode('spine'),
      chest: vrm.humanoid.getNormalizedBoneNode('chest'),
      neck: vrm.humanoid.getNormalizedBoneNode('neck'),
    }),
    [vrm],
  );

  // Nomi expression realmente presenti sul modello: i preset VRM0 vengono
  // normalizzati da three-vrm ai nomi v1 ('blink', 'aa', 'relaxed'…), ma non
  // tutti i modelli li hanno tutti — il guard evita warn per-frame.
  const expressions = useMemo(() => {
    const names = new Set<string>();
    for (const e of vrm.expressionManager?.expressions ?? []) names.add(e.expressionName);
    return names;
  }, [vrm]);

  useEffect(() => {
    scene.add(lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = lookTarget;
    return () => {
      if (vrm.lookAt) vrm.lookAt.target = undefined;
      scene.remove(lookTarget);
    };
  }, [vrm, scene, lookTarget]);

  useFrame((_, rawDelta) => {
    // Clamp anti-spike: al ritorno da tab nascosto il delta è enorme e
    // farebbe "esplodere" gli springbone.
    const delta = Math.min(rawDelta, 0.1);
    t.current += delta;
    dampParams(params.current, ANIMATION_PARAMS[state], delta);
    const p = params.current;
    const setExpr = (name: string, value: number) => {
      if (expressions.has(name)) vrm.expressionManager?.setValue(name, value);
    };

    // (a) respiro su spine + chest (fasi coerenti, ampiezze diverse)
    const breath = breathValue(t.current, p.breathHz);
    if (bones.spine) bones.spine.rotation.x = breath * p.breathAmp * 0.6;
    if (bones.chest) bones.chest.rotation.x = breath * p.breathAmp;

    // (e) sway posturale
    const sway = swayValues(t.current, p.swayAmp);
    if (bones.hips) bones.hips.rotation.z = sway.hipsZ;
    if (bones.spine) bones.spine.rotation.y = sway.spineY;
    if (bones.neck) bones.neck.rotation.z = sway.neckZ;

    // (b) blink: timer random, chiusura-apertura ~120ms
    blinkTimer.current -= delta;
    if (blinkTimer.current <= 0 && blinkPhase.current <= 0) {
      blinkPhase.current = 1;
      blinkTimer.current = nextBlinkDelay(p.blinkEvery);
    }
    if (blinkPhase.current > 0) {
      blinkPhase.current = Math.max(0, blinkPhase.current - delta / 0.12);
      setExpr('blink', blinkValue(blinkPhase.current));
    }

    // (c) bocca nello stato speaking + espressione di fondo
    setExpr('aa', talkMouthValue(t.current) * 0.55 * p.mouth);
    setExpr('relaxed', p.relaxed);

    // (d) lookAt camera con micro-saccadi; in paused lo sguardo cala
    const off = lookOffsets(t.current);
    lookTarget.position.set(
      camera.position.x + off.x,
      camera.position.y + off.y - (1 - p.lookCamera) * 0.9,
      camera.position.z,
    );

    vrm.update(delta);
  });

  return <primitive object={vrm.scene} />;
}
