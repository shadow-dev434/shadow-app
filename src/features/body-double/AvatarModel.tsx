'use client';

// ─── AvatarModel: rig procedurale del VRM (v3 W7) ───────────────────────────
// Scrive sui normalized bone nodes e sull'expressionManager, poi chiama
// vrm.update(delta) — SEMPRE per ultimo: copia normalized→raw, applica
// expressions, lookAt e springbones (i capelli oscillano "gratis").
// Niente file di animazione: tutto procedurale (doc 37, presenza senza costi).
//
// Fix QA Antonio 2026-06-13:
// - posa di riposo: i VRM caricano in T-pose → braccia abbassate post-load
// - inquadratura "videochiamata": camera agganciata all'altezza REALE della
//   testa del modello (niente numeri magici → regge lo swap dell'avatar)
// - labiale: se disponibile il livello RMS dell'audio TTS (getMouthLevel),
//   la bocca segue il parlato vero; altrimenti fallback al rumore procedurale
// - guard espressioni su expressionMap (il vecchio guard su expressionName
//   poteva azzerare blink/bocca su alcuni modelli)

import { useEffect, useMemo, useRef } from 'react';
import { Object3D, Vector3 } from 'three';
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

// Braccia lungo i fianchi: in T-pose il braccio sinistro punta +X; Rz(-70°)
// lo porta verso -Y (giù). Destro speculare. Avambracci leggermente flessi.
const ARM_DOWN_RAD = 1.22; // ~70°
const FOREARM_BEND_RAD = 0.18;

export function AvatarModel({
  vrm,
  state,
  getMouthLevel,
}: {
  vrm: VRM;
  state: AvatarState;
  getMouthLevel?: () => number;
}) {
  const { camera, scene } = useThree();
  const lookTarget = useMemo(() => new Object3D(), []);
  const t = useRef(0);
  const params = useRef<AnimParams>({ ...ANIMATION_PARAMS.present });
  const blinkTimer = useRef(nextBlinkDelay(ANIMATION_PARAMS.present.blinkEvery));
  const blinkPhase = useRef(0);
  const mouthSmooth = useRef(0);

  const bones = useMemo(
    () => ({
      hips: vrm.humanoid.getNormalizedBoneNode('hips'),
      spine: vrm.humanoid.getNormalizedBoneNode('spine'),
      chest: vrm.humanoid.getNormalizedBoneNode('chest'),
      neck: vrm.humanoid.getNormalizedBoneNode('neck'),
    }),
    [vrm],
  );

  // Nomi expression presenti sul modello (preset VRM0 normalizzati ai nomi v1
  // da three-vrm). expressionMap è la fonte affidabile.
  const expressions = useMemo(
    () => new Set(Object.keys(vrm.expressionManager?.expressionMap ?? {})),
    [vrm],
  );

  // Posa di riposo + lookAt target. Le rotazioni restano: il per-frame tocca
  // solo hips/spine/chest/neck.
  useEffect(() => {
    const leftUpper = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const rightUpper = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const leftLower = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
    const rightLower = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
    if (leftUpper) leftUpper.rotation.z = -ARM_DOWN_RAD;
    if (rightUpper) rightUpper.rotation.z = ARM_DOWN_RAD;
    if (leftLower) leftLower.rotation.z = -FOREARM_BEND_RAD;
    if (rightLower) rightLower.rotation.z = FOREARM_BEND_RAD;

    scene.add(lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = lookTarget;
    return () => {
      if (vrm.lookAt) vrm.lookAt.target = undefined;
      scene.remove(lookTarget);
    };
  }, [vrm, scene, lookTarget]);

  // Inquadratura videochiamata: volto al centro, mezzo busto stretto. La
  // quota della testa è letta dal modello (un update() per propagare la posa).
  useEffect(() => {
    vrm.update(0);
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    const headWorld = new Vector3();
    if (head) head.getWorldPosition(headWorld);
    const headY = head ? headWorld.y + 0.06 : 1.4; // ~occhi
    camera.position.set(0, headY, 0.9);
    camera.lookAt(0, headY - 0.04, 0);
  }, [vrm, camera]);

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

    // (c) bocca: RMS dell'audio TTS quando disponibile (labiale reale),
    // altrimenti rumore procedurale nello stato speaking. EMA per evitare
    // lo sfarfallio frame-to-frame.
    const level = getMouthLevel?.() ?? 0;
    const target =
      level > 0.015
        ? Math.min(1, level * 2.4)
        : talkMouthValue(t.current) * 0.55 * p.mouth;
    mouthSmooth.current += (target - mouthSmooth.current) * Math.min(1, delta * 18);
    setExpr('aa', mouthSmooth.current);
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
