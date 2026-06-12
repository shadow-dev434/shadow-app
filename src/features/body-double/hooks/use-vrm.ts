'use client';

// ─── Caricamento modello VRM (v3 W7) ────────────────────────────────────────
// Loader MANUALE in useEffect, niente useLoader di R3F: la sua cache globale
// trattiene riferimenti a risorse GPU già disposte e rompe il re-mount della
// vista full-screen (un solo modello, una sola vista: la cache non serve).

import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

export function useVrm(url: string): { vrm: VRM | null; failed: boolean } {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: VRM | null = null;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      url,
      (gltf) => {
        const v = (gltf.userData as { vrm?: VRM }).vrm;
        if (!v) {
          if (!cancelled) setFailed(true);
          return;
        }
        if (cancelled) {
          // GLTFLoader non supporta abort: se il componente è già smontato,
          // si libera subito quel che è arrivato.
          VRMUtils.deepDispose(v.scene);
          return;
        }
        // One-shot raccomandati da three-vrm v3 (removeUnnecessaryJoints è
        // deprecata → combineSkeletons).
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        // I VRM 0.x guardano -Z: ruota verso la camera di default.
        VRMUtils.rotateVRM0(v);
        // Le bone animation spostano i vertici fuori dai bounds statici:
        // senza questo i mesh "poppano" via quando il bound esce dal frustum.
        v.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        loaded = v;
        setVrm(v);
      },
      undefined,
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;
      if (loaded) VRMUtils.deepDispose(loaded.scene);
      setVrm(null);
    };
  }, [url]);

  return { vrm, failed };
}
