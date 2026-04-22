'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2, CheckCircle2, Sparkles } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

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
  createdAt: string;
}

interface TurnResponse {
  threadId: string;
  assistantMessage: string;
  toolsExecuted: ToolExecution[];
  costUsd: number;
  latencyMs: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ChatView() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setError(null);
    setSending(true);

    // Optimistic: show user message immediately
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const res = await fetch('/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          mode: 'general',
          userMessage: trimmed,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Errore sconosciuto' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as TurnResponse;

      setThreadId(data.threadId);

      const assistantMsg: Message = {
        id: `assist-${Date.now()}`,
        role: 'assistant',
        content: data.assistantMessage || '(nessuna risposta)',
        toolsExecuted: data.toolsExecuted,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore';
      setError(msg);
      // Remove the optimistic user message on error? No, keep it so the user sees what they sent
    } finally {
      setSending(false);
      // Refocus input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [threadId, sending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="p-2 -ml-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors"
          aria-label="Torna indietro"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Shadow</h1>
          <p className="text-xs text-zinc-500">Sempre qui</p>
        </div>
      </header>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {messages.length === 0 && !sending && <EmptyState />}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {sending && <ThinkingIndicator />}

        {error && (
          <div className="max-w-[85%] bg-red-950/50 border border-red-900 text-red-200 text-sm px-4 py-2 rounded-lg">
            Errore: {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 px-3 py-3 border-t border-zinc-800 bg-zinc-900/50 flex-shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
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
          disabled={sending || !input.trim()}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-zinc-700 disabled:text-zinc-500 transition-colors flex-shrink-0"
          aria-label="Invia"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <Sparkles size={28} className="text-amber-500 mb-3" />
      <h2 className="text-lg font-semibold mb-2">Ciao, sono Shadow</h2>
      <p className="text-sm text-zinc-400 max-w-xs">
        Dimmi cosa ti passa per la testa — cose da fare, dubbi, cosa ti blocca. Aiuto a tenere tutto in ordine.
      </p>
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
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1.5`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
          isUser
            ? 'bg-amber-600 text-white rounded-br-md'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-md'
        }`}
      >
        {message.content}
      </div>

      {/* Tool execution cards (only for assistant) */}
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

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  // Friendly labels per tool type
  if (tool.name === 'create_task') {
    const result = tool.result as { title?: string; urgency?: number; category?: string } | null;
    if (!result?.title) return null;
    return (
      <div className="flex items-start gap-2 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">
        <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-emerald-400 font-medium">Task creato</div>
          <div className="text-sm text-zinc-200 truncate">{result.title}</div>
          {(result.category || result.urgency) && (
            <div className="text-xs text-zinc-500 mt-0.5">
              {result.category && <span>{result.category}</span>}
              {result.category && result.urgency && <span> · </span>}
              {result.urgency && <span>urgenza {result.urgency}</span>}
            </div>
          )}
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

  // Generic fallback
  return (
    <div className="text-xs text-zinc-500 pl-1">
      ✓ {tool.name}
    </div>
  );
}