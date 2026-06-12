'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Cap fps con frameloop="demand": un tick esterno chiama invalidate() a
 * cadenza fissa (pattern robusto in R3F v9: con frameloop="always" il render
 * seguirebbe ogni rAF a 60+). In background (visibilitychange) il tick si
 * ferma del tutto → zero render, battery-friendly (doc 37).
 */
export function useFrameLimiter(fps = 30): void {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (!id) id = setInterval(() => invalidate(), 1000 / fps);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [invalidate, fps]);
}
