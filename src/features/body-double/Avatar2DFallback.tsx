'use client';

// ─── Avatar 2D "ombra" (v3 W7) ──────────────────────────────────────────────
// Companion 2D con framer-motion (già in deps): blob-ombra con respiro, blink
// e stati present/speaking/paused. Doppio ruolo (doc 37): loading state mentre
// il modello VRM (~14MB) scarica, e fallback definitivo se WebGL è assente o
// il contesto va perso. Zero asset esterni: solo SVG inline.

import { motion } from 'framer-motion';
import type { AvatarState } from './types';

const BREATH_BY_STATE: Record<AvatarState, { scale: number[]; duration: number }> = {
  present: { scale: [1, 1.03, 1], duration: 4 },
  speaking: { scale: [1, 1.04, 1], duration: 3 },
  paused: { scale: [1, 1.02, 1], duration: 6.5 },
};

export function Avatar2DFallback({ state }: { state: AvatarState }) {
  const breath = BREATH_BY_STATE[state];

  return (
    <div className="flex items-center justify-center" data-avatar-fallback="2d">
      <motion.svg
        width="220"
        height="220"
        viewBox="0 0 220 220"
        animate={{ scale: breath.scale }}
        transition={{ duration: breath.duration, repeat: Infinity, ease: 'easeInOut' }}
        aria-label="Shadow, il tuo companion"
        role="img"
      >
        {/* Corpo: blob ombra */}
        <motion.path
          d="M110 18 C160 18 196 58 196 110 C196 168 162 202 110 202 C58 202 24 168 24 110 C24 58 60 18 110 18 Z"
          fill="url(#shadowGradient)"
          animate={{
            d: [
              'M110 18 C160 18 196 58 196 110 C196 168 162 202 110 202 C58 202 24 168 24 110 C24 58 60 18 110 18 Z',
              'M110 22 C164 20 198 62 194 112 C190 170 160 200 108 200 C56 200 26 164 26 108 C26 56 56 24 110 22 Z',
              'M110 18 C160 18 196 58 196 110 C196 168 162 202 110 202 C58 202 24 168 24 110 C24 58 60 18 110 18 Z',
            ],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <defs>
          <radialGradient id="shadowGradient" cx="50%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#6d5bd0" />
            <stop offset="55%" stopColor="#4c3f99" />
            <stop offset="100%" stopColor="#27224d" />
          </radialGradient>
        </defs>

        {/* Occhi */}
        {state === 'paused' ? (
          // Occhi chiusi: due archi
          <g stroke="#e4e1ff" strokeWidth="5" strokeLinecap="round" fill="none">
            <path d="M72 102 Q83 112 94 102" />
            <path d="M126 102 Q137 112 148 102" />
          </g>
        ) : (
          // Occhi aperti con blink periodico (scaleY sul centro occhio)
          <g>
            {[83, 137].map((cx) => (
              <motion.ellipse
                key={cx}
                cx={cx}
                cy={102}
                rx={11}
                ry={15}
                fill="#e4e1ff"
                style={{ originX: `${cx}px`, originY: '102px' }}
                animate={{ scaleY: [1, 1, 1, 0.06, 1, 1] }}
                transition={{ duration: 4.4, repeat: Infinity, times: [0, 0.42, 0.46, 0.5, 0.54, 1] }}
              />
            ))}
          </g>
        )}

        {/* Bocca: parla / sorriso lieve */}
        {state === 'speaking' ? (
          <motion.ellipse
            cx={110}
            cy={146}
            rx={14}
            fill="#e4e1ff"
            animate={{ ry: [3, 9, 4, 10, 3] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <path
            d="M96 146 Q110 156 124 146"
            stroke="#e4e1ff"
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
            opacity={state === 'paused' ? 0.5 : 0.85}
          />
        )}
      </motion.svg>
    </div>
  );
}
