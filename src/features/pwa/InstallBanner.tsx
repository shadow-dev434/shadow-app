'use client';

/**
 * Banner "Installa Shadow" (Task 70, N29).
 *
 * Estratto da tasks/page.tsx per montarlo anche sulla chat (/) — la home
 * dell'app e la superficie più frequentata: prima il banner appariva solo
 * su /tasks e la maggior parte delle sessioni non lo vedeva mai.
 *
 * L'evento beforeinstallprompt fila UNA volta per page load, spesso prima
 * che una vista specifica monti: la cattura vive a livello di modulo
 * (capturedPrompt) così qualunque superficie montata dopo lo ritrova.
 * Anche il dismiss è module-level: chiuso in chat, non ricompare su /tasks
 * nella stessa sessione (stesso comportamento per-sessione di prima).
 */

import { useCallback, useEffect, useState } from 'react';
import { Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let capturedPrompt: BeforeInstallPromptEvent | null = null;
let dismissedThisSession = false;
const subscribers = new Set<(e: BeforeInstallPromptEvent) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    capturedPrompt = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn(e as BeforeInstallPromptEvent));
  });
}

export function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(capturedPrompt);
  const [visible, setVisible] = useState(capturedPrompt !== null && !dismissedThisSession);

  useEffect(() => {
    const onPrompt = (e: BeforeInstallPromptEvent) => {
      setPrompt(e);
      if (!dismissedThisSession) setVisible(true);
    };
    subscribers.add(onPrompt);
    return () => {
      subscribers.delete(onPrompt);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') toast({ title: 'Shadow installata!' });
    capturedPrompt = null;
    setPrompt(null);
    setVisible(false);
  }, [prompt]);

  const handleDismiss = useCallback(() => {
    dismissedThisSession = true;
    setVisible(false);
  }, []);

  if (!visible || !prompt) return null;

  return (
    <div className="bg-amber-600 text-white px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium">Installa Shadow sul telefono</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={handleInstall}>Installa</Button>
        <button onClick={handleDismiss} className="p-1 hover:bg-amber-700 rounded" aria-label="Chiudi">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
