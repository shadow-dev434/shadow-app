'use client';

/**
 * Task 72 (Slice D) — sheet di conferma foto→OCR (solo guscio nativo).
 *
 * Flusso: camera/galleria/immagine-condivisa → ML Kit on-device →
 * qui l'utente vede il testo estratto, aggiusta il titolo, sceglie (o
 * scarta) una data candidata → POST /api/tasks {source:'ocr'}. L'immagine
 * è già stata cancellata dal plugin appena estratto il testo; il primo
 * parsing delle date è euristico (date-extract), zero LLM.
 *
 * Si apre via evento globale 'shadow:ocr-open' (detail: {mode, path?}) —
 * emesso dal bottone camera dell'inbox e dallo share nativo di immagini.
 * Montata in NativeBootstrap (layout root), così funziona da qualunque vista.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { extractDateCandidates, type DateCandidate } from '@/lib/capture/date-extract';
import { suggestTitleFromOcr } from '@/lib/capture/ocr-title';
import { useShadowStore, type ShadowTask } from '@/store/shadow-store';

export type OcrRequest =
  | { mode: 'camera' }
  | { mode: 'gallery' }
  | { mode: 'image'; path: string };

type Phase = 'processing' | 'review' | 'saving' | 'error';

function formatChip(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function OcrCaptureSheet() {
  const addTask = useShadowStore((s) => s.addTask);
  const [request, setRequest] = useState<OcrRequest | null>(null);
  const [phase, setPhase] = useState<Phase>('processing');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [candidates, setCandidates] = useState<DateCandidate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as OcrRequest | undefined;
      if (detail?.mode) setRequest(detail);
    };
    window.addEventListener('shadow:ocr-open', onOpen);
    return () => window.removeEventListener('shadow:ocr-open', onOpen);
  }, []);

  const close = useCallback(() => setRequest(null), []);

  // Pipeline on-device: risolvi il path (camera/galleria) → OCR → review.
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setPhase('processing');
    setText('');
    setErrorMsg('');
    void (async () => {
      try {
        const { ShadowCapture } = await import('@/lib/native/capture');
        let path: string;
        if (request.mode === 'camera') {
          path = (await ShadowCapture.capturePhoto()).path;
        } else if (request.mode === 'gallery') {
          path = (await ShadowCapture.pickImage()).path;
        } else {
          path = request.path;
        }
        const { text: ocrText } = await ShadowCapture.recognizeText({ path });
        if (cancelled) return;
        const trimmed = (ocrText ?? '').trim();
        if (!trimmed) {
          setPhase('error');
          setErrorMsg('Non ho letto testo nella foto. Prova con più luce o più vicino.');
          return;
        }
        const found = extractDateCandidates(trimmed);
        setText(trimmed);
        setTitle(suggestTitleFromOcr(trimmed));
        setCandidates(found);
        // Preselezione: il primo candidato confident (stessa regola dello share).
        setSelectedDate(found.find((c) => c.confident)?.date ?? null);
        setPhase('review');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('capture_cancelled')) {
          setRequest(null); // annullato dall'utente: nessun errore da mostrare
          return;
        }
        setPhase('error');
        setErrorMsg('Lettura non riuscita. Riprova.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const save = useCallback(async () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;
    setPhase('saving');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle.slice(0, 500),
          status: 'inbox',
          source: 'ocr',
          sourceRef: text.slice(0, 2000),
          ...(selectedDate ? { deadline: selectedDate } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { task?: ShadowTask; alreadyExists?: boolean }
        | null;
      if (res.ok && json?.task) {
        if (json.alreadyExists) {
          toast({ title: 'Era già in inbox', description: `"${json.task.title}"` });
        } else {
          addTask(json.task);
          toast({
            title: 'Salvato in inbox',
            description: selectedDate
              ? `"${finalTitle}" — scadenza ${formatChip(selectedDate)}`
              : `"${finalTitle}"`,
          });
        }
        close();
        return;
      }
      setPhase('review');
      toast({ title: 'Non salvato', description: 'Riprova tra poco.', variant: 'destructive' });
    } catch {
      setPhase('review');
      toast({ title: 'Non salvato', description: 'Riprova tra poco.', variant: 'destructive' });
    }
  }, [title, text, selectedDate, addTask, close]);

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Foto → task</DialogTitle>
          <DialogDescription>
            Letta sul telefono: l&apos;immagine non viene caricata e viene eliminata subito.
          </DialogDescription>
        </DialogHeader>

        {phase === 'processing' && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Leggo il testo…
          </div>
        )}

        {phase === 'error' && (
          <div className="py-4 text-sm text-rose-600 dark:text-rose-400">{errorMsg}</div>
        )}

        {(phase === 'review' || phase === 'saving') && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Titolo</p>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-1">Scadenza letta nel testo</p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <Button
                    key={c.date}
                    size="sm"
                    variant={selectedDate === c.date ? 'default' : 'outline'}
                    onClick={() => setSelectedDate(c.date)}
                    title={c.snippet}
                  >
                    {formatChip(c.date)}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={selectedDate === null ? 'default' : 'outline'}
                  onClick={() => setSelectedDate(null)}
                >
                  Nessuna
                </Button>
              </div>
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-1">Testo letto</p>
              <div className="max-h-36 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 p-2 text-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                {text.slice(0, 1200)}
                {text.length > 1200 ? '…' : ''}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={phase === 'saving'}>
            Annulla
          </Button>
          {(phase === 'review' || phase === 'saving') && (
            <Button onClick={() => void save()} disabled={phase === 'saving' || !title.trim()}>
              {phase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salva in inbox'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
