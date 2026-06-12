import { Suspense } from 'react';
import { FocusPageClient } from './FocusPageClient';

// ─── /focus — sessione body doubling (v3 W7, doc 37) ────────────────────────
// Route nel matcher di src/middleware.ts (gate auth completo). Il client
// component legge ?taskId=…; Suspense richiesto da useSearchParams al build.

export default function FocusPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-zinc-950" />}>
      <FocusPageClient />
    </Suspense>
  );
}
