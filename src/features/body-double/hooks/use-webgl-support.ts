'use client';

import { useEffect, useState } from 'react';

/**
 * Probe WebGL2 client-only (three r163+ richiede WebGL2, non basta WebGL1).
 * Ritorna null finché non testato (evita flash/hydration mismatch), poi
 * true/false definitivo.
 */
export function useWebglSupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      setSupported(Boolean(canvas.getContext('webgl2')));
    } catch {
      setSupported(false);
    }
  }, []);

  return supported;
}
