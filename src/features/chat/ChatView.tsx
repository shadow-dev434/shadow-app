'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Info, List, Pencil, Send, Loader2, CheckCircle2, History, ArrowLeft, Lock, MessageSquare, Paperclip, X, FileText } from 'lucide-react';
import { BugReportButton } from '@/features/beta/BugReportDialog';
import { BetaCheckin } from '@/features/beta/BetaCheckinCard';
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

interface QuickReply {
  label: string;
  value: string;
}

interface ToolExecution {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsExecuted?: ToolExecution[];
  quickReplies?: QuickReply[];
  createdAt: string;
  // Task 54 (vision): allegati mostrati nella bolla utente ottimistica (solo
  // display, client-side — non rehydratati: inline-only in v1).
  attachments?: { name: string; previewUrl?: string }[];
}

interface TurnResponse {
  threadId: string;
  /** Mode autorevole del thread effettivo dopo il turno (Task 41). */
  mode?: string;
  assistantMessage: string;
  toolsExecuted: ToolExecution[];
  quickReplies?: QuickReply[];
  costUsd: number;
  latencyMs: number;
}

interface BootstrapResponse {
  triggered: boolean;
  threadId?: string;
  assistantMessage?: string;
  toolsExecuted?: ToolExecution[];
  quickReplies?: QuickReply[];
  mode?: string;
}

interface ActiveThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ActiveThreadResponse {
  activeThread: {
    threadId: string;
    mode: string;
    messages: ActiveThreadMessage[];
    hasMore: boolean;
  } | null;
  eveningReview: {
    shouldStart: boolean;
  };
}

// Task 53 — voce della sidebar storica (GET /api/chat/threads).
interface ThreadSummary {
  id: string;
  mode: string;
  state: string;
  label: string;
  isActive: boolean;
  startedAt: string;
  lastTurnAt: string;
  messageCount: number;
}

// Task 53 — metadati di un thread aperto in sola lettura (GET /api/chat/threads/[id]).
interface ArchivedThreadMeta {
  id: string;
  mode: string;
  state: string;
  label: string;
  isActive: boolean;
  startedAt: string;
  lastTurnAt: string;
}

// ── Task 54 (vision) — allegati lato client ─────────────────────────────────
const MAX_CLIENT_ATTACHMENTS = 4;
const IMAGE_MAX_DIM = 1536; // Anthropic consiglia <=1568px; tiene il body sotto i limiti Vercel
const IMAGE_JPEG_QUALITY = 0.85;

interface PendingAttachment {
  id: string;
  kind: 'image' | 'document';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';
  data: string; // base64 senza prefisso data:
  name: string;
  previewUrl?: string; // data URL per la miniatura (solo immagini)
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Ridimensiona un'immagine a IMAGE_MAX_DIM e la ricodifica JPEG: il base64 resta
// piccolo (sotto i limiti del body Vercel) e la lettura del modello migliora.
function downscaleImageToJpeg(file: File): Promise<{ data: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > IMAGE_MAX_DIM || height > IMAGE_MAX_DIM) {
        const scale = Math.min(IMAGE_MAX_DIM / width, IMAGE_MAX_DIM / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas non disponibile'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
      resolve({ data: dataUrl.split(',')[1] ?? '', dataUrl });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('immagine non caricata'));
    };
    img.src = url;
  });
}

async function fileToPendingAttachment(file: File): Promise<PendingAttachment | null> {
  const id = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  if (file.type === 'application/pdf') {
    const dataUrl = await readFileAsDataURL(file);
    const data = dataUrl.split(',')[1] ?? '';
    if (!data) return null;
    return { id, kind: 'document', mediaType: 'application/pdf', data, name: file.name };
  }
  if (file.type.startsWith('image/')) {
    const { data, dataUrl } = await downscaleImageToJpeg(file);
    if (!data) return null;
    return { id, kind: 'image', mediaType: 'image/jpeg', data, name: file.name, previewUrl: dataUrl };
  }
  return null; // tipo non supportato
}

const SUGGESTED_PROMPTS = [
  { label: 'Pianifichiamo oggi', prompt: 'Aiutami a pianificare la giornata. Cosa devo priorizzare?' },
  { label: 'Ho un task nuovo', prompt: 'Devo aggiungere qualcosa alla lista: ' },
  { label: 'Cosa ho in lista?', prompt: 'Cosa ho in lista oggi?' },
  { label: 'Sono bloccato', prompt: 'Sono bloccato su qualcosa e non riesco a partire.' },
  { label: 'Come funziona Shadow?', prompt: 'Spiegami come funziona Shadow e cosa puoi fare per me.' },
];

export function ChatView() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('general');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [eveningReviewShouldStart, setEveningReviewShouldStart] = useState(false);

  // Task 53 — storico chat (sidebar) + vista archiviata read-only.
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [viewing, setViewing] = useState<{ meta: ArchivedThreadMeta; messages: Message[] } | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);

  // Task 54 (vision): allegati in coda nel composer, in attesa di invio.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountInitCalled = useRef(false);
  // Ultimo turno utente fallito, per il Riprova (Task 42). Ref e non state:
  // serve solo al click handler. Task 54: porta anche gli allegati.
  const lastFailedRef = useRef<{ text: string; attachments: PendingAttachment[] } | null>(null);

  // Mount init: prima prova a rehydratare un thread attivo esistente
  // via GET /api/chat/active-thread. Se non ce n'e' nessuno (o il
  // fetch fallisce), fallback al bootstrap che puo' triggerare un
  // morning check-in. Un singolo ref guarda l'intera fase init per
  // evitare double-invocation in React 18 strict mode.
  useEffect(() => {
    if (mountInitCalled.current) return;
    mountInitCalled.current = true;

    (async () => {
      // Task 44: CTA "Costruiamo il piano di oggi" da /tasks (?plan=today).
      // Avvio manuale del morning check-in: bypassa le guardie del bootstrap
      // (thread attivo / once-a-day) perché l'utente l'ha chiesto esplicitamente.
      if (new URLSearchParams(window.location.search).get('plan') === 'today') {
        window.history.replaceState({}, '', '/'); // niente ri-trigger al refresh
        setMode('morning_checkin');
        try {
          const res = await fetch('/api/chat/turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threadId: null, mode: 'morning_checkin', userMessage: '__auto_start__' }),
          });
          if (res.ok) {
            const data = (await res.json()) as TurnResponse;
            setThreadId(data.threadId);
            if (data.mode) setMode(data.mode);
            setMessages([{
              id: 'assist-plan-' + Date.now(),
              role: 'assistant',
              content: data.assistantMessage || '(nessuna risposta)',
              toolsExecuted: data.toolsExecuted,
              quickReplies: data.quickReplies,
              createdAt: new Date().toISOString(),
            }]);
          }
        } catch (err) {
          console.error('[ChatView] morning plan start error:', err);
        } finally {
          setBootstrapping(false);
        }
        return;
      }

      // Tentativo 1: rehydrate thread attivo esistente.
      let rehydrated = false;

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mi = String(now.getMinutes()).padStart(2, '0');
      const clientDate = `${yyyy}-${mm}-${dd}`;
      const clientTime = `${hh}:${mi}`;

      try {
        const url = `/api/chat/active-thread?clientTime=${encodeURIComponent(clientTime)}&clientDate=${encodeURIComponent(clientDate)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as ActiveThreadResponse;
          setEveningReviewShouldStart(data.eveningReview.shouldStart);
          if (data.activeThread) {
            // TODO(task-futuro): usare data.activeThread.hasMore per
            // mostrare un affordance "carica messaggi precedenti".
            const { threadId: tid, mode: tmode, messages: tmsgs } = data.activeThread;
            // I messaggi rehydrated non includono toolsExecuted ne
            // quickReplies (payloadJson escluso dall'endpoint per
            // scelta di design): le card "task creato" ecc non
            // ricompaiono al remount. Trade-off accettato.
            const msgs: Message[] = tmsgs.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            }));
            setThreadId(tid);
            setMode(tmode);
            setMessages(msgs);
            console.log('[ChatView] rehydrated thread:', { threadId: tid, messageCount: msgs.length });
            rehydrated = true;
          }
        } else {
          console.warn('[ChatView] active-thread fetch failed:', res.status);
        }
      } catch (err) {
        console.error('[ChatView] active-thread error:', err);
      }

      if (rehydrated) {
        setBootstrapping(false);
        return;
      }

      // Tentativo 2 (fallback): bootstrap -- logica invariata.
      try {
        const res = await fetch('/api/chat/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          console.warn('[ChatView] bootstrap failed:', res.status);
          return;
        }

        const data = (await res.json()) as BootstrapResponse;
        console.log('[ChatView] bootstrap response:', data);

        if (data.triggered && data.threadId && data.assistantMessage) {
          setThreadId(data.threadId);
          setMode(data.mode ?? 'morning_checkin');

          const greetingMsg: Message = {
            id: 'assist-bootstrap-' + Date.now(),
            role: 'assistant',
            content: data.assistantMessage,
            toolsExecuted: data.toolsExecuted,
            quickReplies: data.quickReplies,
            createdAt: new Date().toISOString(),
          };
          setMessages([greetingMsg]);
        }
      } catch (err) {
        console.error('[ChatView] bootstrap error:', err);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // `viewing` in deps: tornando alla chat di oggi (viewing -> null) il div
    // live si rimonta, qui riportiamo lo scroll in fondo.
  }, [messages, sending, viewing]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const sendMessage = useCallback(async (text: string, opts?: { isRetry?: boolean; attachments?: PendingAttachment[] }) => {
    const trimmed = text.trim();
    const atts = opts?.attachments ?? [];
    if ((!trimmed && atts.length === 0) || sending) return;

    setError(null);
    setSending(true);

    // Sul retry la bolla utente ottimistica del tentativo fallito e' gia'
    // in lista: non duplicarla (Task 42).
    if (!opts?.isRetry) {
      const userMsg: Message = {
        id: 'temp-' + Date.now(),
        role: 'user',
        content: trimmed,
        ...(atts.length > 0 && {
          attachments: atts.map(a => ({ name: a.name, previewUrl: a.previewUrl })),
        }),
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
    }
    setInput('');

    try {
      const res = await fetch('/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          mode,
          userMessage: trimmed,
          ...(atts.length > 0 && {
            attachments: atts.map(a => ({ kind: a.kind, mediaType: a.mediaType, data: a.data })),
          }),
          ...(mode === 'evening_review' && {
            clientDate: new Intl.DateTimeFormat('en-CA').format(new Date()),
          }),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Errore sconosciuto' }));
        // Lo status serve all'error box: 404 (probabile deployment skew) ha
        // un'azione diversa (Ricarica) dal resto (Riprova). Task 42.
        const err = new Error(errData.error || 'HTTP ' + res.status) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as TurnResponse;
      setThreadId(data.threadId);
      // Task 41: adotta il mode autorevole dal server. Senza questo, dopo la
      // chiusura della review il client resterebbe sticky su 'evening_review'
      // e dal secondo messaggio re-inizializzerebbe la review sul nuovo
      // thread general creato dal path BUG #C (vedi turn/route.ts).
      if (data.mode && data.mode !== mode) {
        setMode(data.mode);
      }

      const assistantMsg: Message = {
        id: 'assist-' + Date.now(),
        role: 'assistant',
        content: data.assistantMessage || '(nessuna risposta)',
        toolsExecuted: data.toolsExecuted,
        quickReplies: data.quickReplies,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      lastFailedRef.current = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore';
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      lastFailedRef.current = { text: trimmed, attachments: atts };
      setError({ message: msg, status });
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [threadId, mode, sending]);

  // Task 54: l'invio dal composer porta gli allegati in coda; quick-reply e
  // suggerimenti restano text-only (chiamano sendMessage senza attachments).
  const submitComposer = () => {
    sendMessage(input, { attachments: pendingAttachments });
    setPendingAttachments([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitComposer();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComposer();
    }
  };

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const slots = MAX_CLIENT_ATTACHMENTS - pendingAttachments.length;
    if (slots <= 0) return;
    const picked = Array.from(files).slice(0, slots);
    const converted = (
      await Promise.all(picked.map(f => fileToPendingAttachment(f).catch(() => null)))
    ).filter((a): a is PendingAttachment => a !== null);
    if (converted.length > 0) {
      setPendingAttachments(prev => [...prev, ...converted].slice(0, MAX_CLIENT_ATTACHMENTS));
    }
  }, [pendingAttachments.length]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSuggestion = (prompt: string) => {
    if (prompt.endsWith(': ')) {
      setInput(prompt);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      sendMessage(prompt);
    }
  };

  const handleStartEveningReview = () => {
    setEveningReviewShouldStart(false);
    // La review parte SEMPRE su un thread nuovo. La card e' visibile solo a
    // chat vuota, ma threadId puo' essere non-null se il rehydrate ha trovato
    // un thread attivo SENZA messaggi (orfano di un primo turno fallito):
    // senza reset il primo turno evening_review finirebbe su quel thread
    // general e il guard anti mode-spoof dell'orchestrator lo degraderebbe a
    // general (review mai partita). Il thread orfano resta com'era.
    setThreadId(null);
    setMode('evening_review');
    // Task 43: dal banner la review parte con messaggi gia' in lista (thread
    // general riattivato). Puliamo lo schermo per partire dalla review pulita;
    // a chat vuota (path card) e' un no-op. Il thread general resta 'active' in
    // DB e si riprende dopo la review (decisione di prodotto: lo riprendi dopo).
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Task 53 — carica la lista dei thread (lazy, all'apertura della sidebar).
  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await fetch('/api/chat/threads');
      if (res.ok) {
        const data = (await res.json()) as { threads: ThreadSummary[] };
        setThreads(data.threads);
      } else {
        console.warn('[ChatView] threads fetch failed:', res.status);
      }
    } catch (err) {
      console.error('[ChatView] threads error:', err);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  // Task 53 — apre un giorno passato in sola lettura (GET /api/chat/threads/[id]).
  // Mostra subito l'header con la label (dal summary), poi popola i messaggi.
  const openArchivedThread = useCallback(async (t: ThreadSummary) => {
    setViewing({
      meta: {
        id: t.id, mode: t.mode, state: t.state, label: t.label,
        isActive: t.isActive, startedAt: t.startedAt, lastTurnAt: t.lastTurnAt,
      },
      messages: [],
    });
    setViewingLoading(true);
    try {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(t.id)}`);
      if (res.ok) {
        const data = (await res.json()) as { thread: ArchivedThreadMeta; messages: ActiveThreadMessage[] };
        setViewing({
          meta: data.thread,
          messages: data.messages.map(m => ({
            id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
          })),
        });
      } else {
        console.warn('[ChatView] archived thread fetch failed:', res.status);
      }
    } catch (err) {
      console.error('[ChatView] archived thread error:', err);
    } finally {
      setViewingLoading(false);
    }
  }, []);

  // Task 53 — torna alla chat di oggi (esce dalla vista read-only).
  const backToToday = useCallback(() => setViewing(null), []);

  const handleSelectThread = useCallback((t: ThreadSummary) => {
    // Il thread attivo di oggi riapre la chat live; gli altri sono read-only.
    if (t.isActive) backToToday();
    else openArchivedThread(t);
  }, [backToToday, openArchivedThread]);

  return (
    <SidebarProvider defaultOpen={false}>
      <ChatHistorySidebar
        threads={threads}
        loading={threadsLoading}
        viewingId={viewing?.meta.id ?? null}
        onSelect={handleSelectThread}
        onRequestLoad={loadThreads}
      />
      <SidebarInset className="flex flex-col h-screen bg-zinc-950 text-zinc-100 min-w-0">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur flex-shrink-0">
        <HistoryToggleButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold">Shadow</h1>
          <p className="text-xs text-zinc-500">Sempre qui</p>
        </div>
        <BugReportButton area="chat" />
        <button
          onClick={() => router.push('/tasks')}
          className="p-2 -mr-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-200"
          aria-label="Apri lista"
          title="Apri lista task"
        >
          <List size={20} />
        </button>
      </header>

      {viewing ? (
        <ArchivedThreadView
          meta={viewing.meta}
          messages={viewing.messages}
          loading={viewingLoading}
          onBack={backToToday}
        />
      ) : (
      <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && !sending && !bootstrapping && (
          eveningReviewShouldStart
            ? <EveningReviewCard onStart={handleStartEveningReview} />
            : <EmptyState onSuggestion={handleSuggestion} />
        )}

        {bootstrapping && messages.length === 0 && (
          <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Apertura...
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLastAssistant =
            msg.role === 'assistant' && idx === messages.length - 1;
          return (
            <div key={msg.id}>
              <MessageBubble message={msg} />
              {isLastAssistant && msg.quickReplies && msg.quickReplies.length > 0 && (
                <QuickReplyButtons
                  replies={msg.quickReplies}
                  onSelect={(value) => sendMessage(value)}
                  disabled={sending}
                />
              )}
            </div>
          );
        })}

        {sending && <ThinkingIndicator />}

        {error && (
          <div className="max-w-[85%] bg-red-950/50 border border-red-900 text-red-200 text-sm px-4 py-2 rounded-lg space-y-2">
            <div>
              {error.status === 404
                ? 'Non ho raggiunto il server — probabile aggiornamento dell\'app in corso.'
                : `Errore: ${error.message}`}
            </div>
            {error.status === 404 ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1 bg-red-900/40 hover:bg-red-900/60 active:bg-red-900 border border-red-800 rounded-md text-xs font-medium text-red-100 transition-colors"
              >
                Ricarica
              </button>
            ) : lastFailedRef.current ? (
              <button
                type="button"
                onClick={() => {
                  const failed = lastFailedRef.current;
                  if (failed) sendMessage(failed.text, { isRetry: true, attachments: failed.attachments });
                }}
                disabled={sending}
                className="px-3 py-1 bg-red-900/40 hover:bg-red-900/60 active:bg-red-900 border border-red-800 rounded-md text-xs font-medium text-red-100 disabled:opacity-50 transition-colors"
              >
                Riprova
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Task 43 (bug review serale): quando il server segnala shouldStart ma la
          chat ha gia' messaggi (thread attivo riattivato), la EveningReviewCard a
          schermo vuoto non compare. Mostriamo un banner non bloccante sopra
          l'input come punto d'ingresso. Soppresso se la review e' gia' in corso. */}
      {eveningReviewShouldStart &&
        messages.length > 0 &&
        mode !== 'evening_review' &&
        !sending &&
        !bootstrapping && (
          <EveningReviewBanner onStart={handleStartEveningReview} />
        )}

      {/* Check-in beta (Task 23): soppresso solo finché la card della review
          serale occupa la schermata vuota (niente due card impilate). Appena
          l'utente interagisce — fa la review o chatta — il pulse torna
          disponibile come banner non bloccante sopra l'input. */}
      <BetaCheckin
        suppress={eveningReviewShouldStart || (messages.length === 0 && mode === 'evening_review')}
      />

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 px-3 py-3 border-t border-zinc-800 bg-zinc-900/50 flex-shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* Task 54: chip degli allegati in coda */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map(att => (
              <div
                key={att.id}
                className="relative flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg pl-1.5 pr-2 py-1 max-w-[210px]"
              >
                {att.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="w-7 h-7 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <FileText size={16} className="text-zinc-400 flex-shrink-0" />
                )}
                <span className="text-xs text-zinc-300 truncate">{att.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="text-zinc-500 hover:text-zinc-200 flex-shrink-0"
                  aria-label="Rimuovi allegato"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={e => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || pendingAttachments.length >= MAX_CLIENT_ATTACHMENTS}
            className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-40 transition-colors text-zinc-400 hover:text-zinc-200 flex-shrink-0"
            aria-label="Allega foto o PDF"
            title="Allega foto o PDF"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Dimmi cosa ti passa per la testa..."
            rows={1}
            disabled={sending}
            className="flex-1 resize-none bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-2.5 text-base placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
            style={{ maxHeight: '120px' }}
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && pendingAttachments.length === 0)}
            className="flex items-center justify-center w-11 h-11 rounded-full bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-zinc-700 disabled:text-zinc-500 transition-colors flex-shrink-0"
            aria-label="Invia"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </form>
      </>
      )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function EmptyState({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-2 text-center">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center mb-4">
        <span className="text-xl font-semibold text-white">S</span>
      </div>
      <h2 className="text-lg font-semibold mb-2">Ciao, sono Shadow</h2>
      <p className="text-sm text-zinc-400 max-w-xs mb-6">
        Sono qui per aiutarti a tenere tutto in ordine. Scrivimi liberamente: task, dubbi, blocchi.
      </p>
      <div className="w-full max-w-sm space-y-2">
        <div className="text-xs text-zinc-500 mb-2">Oppure inizia da qui:</div>
        {SUGGESTED_PROMPTS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSuggestion(s.prompt)}
            className="block w-full text-left px-4 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700/50 rounded-lg text-sm text-zinc-200 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EveningReviewCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-2 text-center">
      <div className="w-full max-w-sm bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-6 space-y-4">
        <p className="text-sm text-zinc-200">
          Sei nella finestra serale. Vuoi iniziare la review?
        </p>
        <button
          type="button"
          onClick={onStart}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded-md text-sm transition-colors"
        >
          Inizia la review
        </button>
      </div>
    </div>
  );
}

// Task 43: punto d'ingresso non bloccante alla review serale quando la chat ha
// gia' messaggi (la EveningReviewCard a schermo vuoto non comparirebbe). Riga
// compatta sopra l'input; l'avvio riusa handleStartEveningReview (thread nuovo).
function EveningReviewBanner({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-amber-900/40 bg-amber-950/30 flex-shrink-0">
      <p className="flex-1 text-sm text-amber-100">È ora della review serale.</p>
      <button
        type="button"
        onClick={onStart}
        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-md text-sm font-medium transition-colors flex-shrink-0"
      >
        Inizia la review
      </button>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-zinc-500 text-sm pl-2">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={'flex flex-col gap-1.5 ' + (isUser ? 'items-end' : 'items-start')}>
      {/* Task 54 (vision): allegati nella bolla utente ottimistica. */}
      {message.attachments && message.attachments.length > 0 && (
        <div className={'flex flex-wrap gap-1.5 max-w-[85%] ' + (isUser ? 'justify-end' : '')}>
          {message.attachments.map((att, i) =>
            att.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={att.previewUrl}
                alt={att.name}
                className="w-16 h-16 rounded-lg object-cover border border-zinc-700"
              />
            ) : (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5"
              >
                <FileText size={14} className="text-zinc-400 flex-shrink-0" />
                <span className="text-xs text-zinc-300 truncate max-w-[120px]">{att.name}</span>
              </div>
            ),
          )}
        </div>
      )}

      {message.content && (
        <div
          className={
            'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ' +
            (isUser
              ? 'bg-amber-600 text-white rounded-br-md'
              : 'bg-zinc-800 text-zinc-100 rounded-bl-md')
          }
        >
          {message.content}
        </div>
      )}

      {message.toolsExecuted && message.toolsExecuted.length > 0 && (
        <div className="max-w-[85%] space-y-1.5 mt-1">
          {message.toolsExecuted.map((tool, idx) => (
            <ToolExecutionCard key={idx} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickReplyButtons({
  replies,
  onSelect,
  disabled,
}: {
  replies: QuickReply[];
  onSelect: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-2 max-w-[85%]">
      {replies.map((reply, i) => (
        <button
          key={i}
          onClick={() => onSelect(reply.value)}
          disabled={disabled}
          className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/40 active:bg-amber-900/60 border border-amber-800/50 rounded-full text-sm text-amber-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}

// Etichette italiane dei campi di update_task (l'executor ritorna i nomi
// tecnici in `changed`).
const FIELD_LABELS: Record<string, string> = {
  title: 'titolo',
  description: 'descrizione',
  urgency: 'urgenza',
  importance: 'importanza',
  category: 'categoria',
  deadline: 'scadenza',
};

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  if (tool.name === 'create_task') {
    const result = tool.result as {
      title?: string;
      urgency?: number;
      category?: string;
      alreadyExists?: boolean;
    } | null;
    if (!result?.title) return null;
    // Task 42: il dedup guard non ha creato nulla — card neutra, non "creato".
    if (result.alreadyExists) {
      return (
        <div className="flex items-start gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
          <Info size={16} className="text-zinc-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-400 font-medium">Già in lista</div>
            <div className="text-sm text-zinc-200 truncate">{result.title}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-2 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">
        <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-emerald-400 font-medium">Task creato</div>
          <div className="text-sm text-zinc-200 truncate">{result.title}</div>
          {(result.category || result.urgency) && (
            <div className="text-xs text-zinc-500 mt-0.5">
              {result.category && <span>{result.category}</span>}
              {result.category && result.urgency && <span> - </span>}
              {result.urgency && <span>urgenza {result.urgency}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (tool.name === 'complete_task') {
    const result = tool.result as { title?: string; alreadyCompleted?: boolean } | null;
    if (!result?.title) return null;
    return (
      <div className="flex items-start gap-2 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">
        <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-emerald-400 font-medium">
            {result.alreadyCompleted ? 'Era già completato' : 'Task completato'}
          </div>
          <div className="text-sm text-zinc-200 truncate line-through decoration-zinc-500">
            {result.title}
          </div>
        </div>
      </div>
    );
  }

  if (tool.name === 'update_task') {
    const result = tool.result as { title?: string; changed?: string[] } | null;
    if (!result?.title) return null;
    return (
      <div className="flex items-start gap-2 bg-sky-950/40 border border-sky-900/50 rounded-lg px-3 py-2">
        <Pencil size={16} className="text-sky-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-sky-400 font-medium">Task aggiornato</div>
          <div className="text-sm text-zinc-200 truncate">{result.title}</div>
          {result.changed && result.changed.length > 0 && (
            <div className="text-xs text-zinc-500 mt-0.5">
              {result.changed.map(f => FIELD_LABELS[f] ?? f).join(', ')}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (tool.name === 'archive_task') {
    const result = tool.result as { title?: string; alreadyArchived?: boolean } | null;
    if (!result?.title) return null;
    return (
      <div className="flex items-start gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
        <Archive size={16} className="text-zinc-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-400 font-medium">
            {result.alreadyArchived ? 'Era già archiviato' : 'Task archiviato'}
          </div>
          <div className="text-sm text-zinc-200 truncate">{result.title}</div>
        </div>
      </div>
    );
  }

  if (tool.name === 'get_today_tasks') {
    const result = tool.result as Array<{ title: string; urgency: number }> | null;
    if (!Array.isArray(result) || result.length === 0) return null;
    return (
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
        <div className="text-xs text-zinc-400 font-medium mb-1.5">
          {result.length} task in lista
        </div>
        <ul className="space-y-1">
          {result.slice(0, 5).map((t, i) => (
            <li key={i} className="text-sm text-zinc-200 flex items-center gap-2">
              <span className="w-1 h-1 bg-zinc-500 rounded-full" />
              <span className="truncate">{t.title}</span>
            </li>
          ))}
          {result.length > 5 && (
            <li className="text-xs text-zinc-500">+{result.length - 5} altri</li>
          )}
        </ul>
      </div>
    );
  }

  return null;
}

// ─── Task 53 — Storico chat (sidebar a scomparsa) ─────────────────────────────

// Toggle nello header. Usa useSidebar() (gestisce desktop offcanvas + Sheet
// mobile con un solo handler). Vive dentro SidebarProvider.
function HistoryToggleButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      onClick={toggleSidebar}
      className="-ml-1 p-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-200"
      aria-label="Storico chat"
      title="Storico chat"
    >
      <History size={20} />
    </button>
  );
}

// Sidebar a scomparsa con la lista dei giorni (shadcn ui/sidebar, non
// modificato — solo composizione). "Oggi" riapre la chat live; i giorni passati
// si aprono read-only. Carica/aggiorna la lista a ogni apertura.
function ChatHistorySidebar({
  threads,
  loading,
  viewingId,
  onSelect,
  onRequestLoad,
}: {
  threads: ThreadSummary[] | null;
  loading: boolean;
  viewingId: string | null;
  onSelect: (t: ThreadSummary) => void;
  onRequestLoad: () => void;
}) {
  const { open, openMobile, isMobile, setOpen, setOpenMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  const wasOpen = useRef(false);

  useEffect(() => {
    // Fetch a ogni transizione chiuso -> aperto (i conteggi cambiano col tempo).
    if (isOpen && !wasOpen.current) onRequestLoad();
    wasOpen.current = isOpen;
  }, [isOpen, onRequestLoad]);

  const closeSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  }, [isMobile, setOpen, setOpenMobile]);

  return (
    <Sidebar side="left" collapsible="offcanvas" className="border-zinc-800">
      <SidebarHeader className="gap-1 border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Le tue chat</h2>
        <p className="text-xs text-zinc-500 leading-snug">
          Una chat al giorno. I giorni passati sono in sola lettura.
        </p>
      </SidebarHeader>
      <SidebarContent className="px-2 py-2">
        {loading && (!threads || threads.length === 0) ? (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
            <Loader2 size={15} className="mr-2 animate-spin" /> Carico...
          </div>
        ) : !threads || threads.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-zinc-500">
            Nessuna chat ancora. Scrivimi qualcosa per iniziare.
          </div>
        ) : (
          <SidebarMenu>
            {threads.map((t) => {
              const active = t.isActive ? viewingId === null : t.id === viewingId;
              return (
                <SidebarMenuItem key={t.id}>
                  <button
                    onClick={() => {
                      onSelect(t);
                      closeSidebar();
                    }}
                    className={
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ' +
                      (active
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-300 hover:bg-zinc-800/60')
                    }
                  >
                    {t.isActive ? (
                      <MessageSquare size={15} className="flex-shrink-0 text-amber-400" />
                    ) : (
                      <History size={15} className="flex-shrink-0 text-zinc-500" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{t.label}</span>
                      <span className="truncate text-[11px] text-zinc-500">
                        {t.messageCount} messaggi{t.isActive ? ' · in corso' : ''}
                      </span>
                    </span>
                  </button>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

// Vista di un giorno passato: sola lettura, niente composer. Banner con la label
// datata + "Torna a oggi". Riusa MessageBubble.
function ArchivedThreadView({
  meta,
  messages,
  loading,
  onBack,
}: {
  meta: ArchivedThreadMeta;
  messages: Message[];
  loading: boolean;
  onBack: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [meta.id]);

  return (
    <>
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-amber-900/30 bg-amber-950/20 flex-shrink-0">
        <Lock size={14} className="flex-shrink-0 text-amber-300/80" />
        <p className="flex-1 truncate text-sm text-amber-100">{meta.label} · sola lettura</p>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-sm font-medium transition-colors flex-shrink-0"
        >
          <ArrowLeft size={15} /> Torna a oggi
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
            <Loader2 size={16} className="mr-2 animate-spin" /> Carico la chat...
          </div>
        ) : messages.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            Nessun messaggio in questa chat.
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>
    </>
  );
}