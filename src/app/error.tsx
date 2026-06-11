'use client';

import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Bug, RefreshCw } from 'lucide-react';
import { BugReportDialog } from '@/features/beta/BugReportDialog';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center mb-4">
        <span className="text-xl font-semibold text-white">S</span>
      </div>
      <h1 className="text-lg font-semibold mb-2">Qualcosa è andato storto</h1>
      <p className="text-sm text-zinc-400 max-w-xs mb-6">
        Non sei tu, è Shadow. L&apos;errore è stato registrato automaticamente
        — puoi riprovare subito.
      </p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={() => reset()}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw size={16} /> Riprova
        </button>
        <button
          onClick={() => setReportOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 text-zinc-200 rounded-lg text-sm transition-colors"
        >
          <Bug size={16} /> Segnala il problema
        </button>
      </div>
      <BugReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        initialArea="other"
        initialDescription={`[crash] ${error.digest ? `digest ${error.digest} — ` : ''}${error.message}`}
      />
    </div>
  );
}
