/**
 * POST /api/chat/turn
 *
 * Body: { threadId?: string, mode: ChatMode, userMessage: string, relatedTaskId?: string, clientDate?: string }
 * Response: { threadId, mode, assistantMessage, toolsExecuted, costUsd, ... }
 *
 * Auth: requires NextAuth session cookie. Set by /api/auth/login.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { orchestrate, type ChatMode, type ChatAttachment } from '@/lib/chat/orchestrator';
import { rollSummaryIfNeeded } from '@/lib/chat/summary';
import { shouldRollOverThread } from '@/lib/chat/day-rollover';
import { getDailyCalls, recordAiUsage } from '@/lib/llm/usage';
import { captureApiError } from '@/lib/observability';

// B3 (audit pre-beta): cap giornaliero per-utente sui turni chat. La route LLM
// più trafficata (check-in, review serale su Sonnet, chat, vision) non aveva
// alcun freno (fino a ~10 callLLM per turno, nessun limite sul numero di turni).
// 0 = kill-switch (chat disabilitata), come il pattern di voice/body-double.
// Task 73 (D): default 200→80 per il lancio pubblico — l'uso reale osservato è
// 10-30 turni/die; 80 lascia margine e dimezza il danno di un account abusivo.
const CHAT_DAILY_CAP = Number(process.env.CHAT_DAILY_CAP ?? '80');

/**
 * Task 40: after() gira DENTRO il budget di durata residuo della stessa
 * invocazione (su Vercel via waitUntil), NON oltre — senza maxDuration
 * esplicito un turno lungo + fold rischiava il kill sistematico SOLO in
 * produzione (spec Task 40 §8 #5). 60s allineato a export/route.ts.
 * Il fold ucciso resta fail-open e auto-riparante (count ancora sopra
 * soglia al turno successivo), ma il primo fold va VERIFICATO nei log del
 * preview deploy: primo uso di after() nel codebase.
 */
export const maxDuration = 60;

// Task 64 (B4, D75): solo i 3 mode realmente usati dal prodotto. I mode
// legacy 'planning'/'focus_companion'/'unblock' erano accettati via API con
// tool sensibili abilitati ('unblock' addirittura a prompt vuoto): un client
// che li manda oggi degrada a 'general' come qualunque altro valore ignoto.
const VALID_MODES: ChatMode[] = [
  'morning_checkin',
  'evening_review',
  'general',
];

// ── Task 54 (vision) — validazione allegati inline ──────────────────────────
// Inline-only in v1: gli allegati viaggiano base64 NEL body. Limite di fatto:
// il body delle serverless function Vercel (~4.5MB) -> cap totale conservativo,
// non i 32MB "ideali" della spec (servirebbe un upload diretto a blob, non v1).
// Il client ridimensiona le immagini, quindi questi cap colpiscono solo i casi
// estremi (PDF grossi / molte immagini).
const MAX_ATTACHMENTS = 4;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const MAX_ITEM_BYTES = 4 * 1024 * 1024; // 4MB per allegato
const MAX_TOTAL_BYTES = Math.floor(4.5 * 1024 * 1024); // safety body Vercel

function approxBase64Bytes(s: string): number {
  return Math.floor((s.length * 3) / 4);
}

// Task 69 (I, S2-K): base64 malformato passava intatto fino alla chiamata
// Anthropic, che esplodeva in un 500 "Errore interno". Validazione sintattica
// qui → 400 parlante. Alfabeto standard (niente URL-safe: il client manda
// l'output di FileReader/btoa), padding finale opzionale, length%4===0.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function isDecodableBase64(s: string): boolean {
  return s.length % 4 === 0 && BASE64_RE.test(s);
}

type AttachmentValidation =
  | { attachments: ChatAttachment[]; error?: undefined }
  | { attachments?: undefined; error: string };

// Task 64 (A4, D34): i messaggi di errore arrivano in UI così come sono
// (ChatView li mostra all'utente) — devono essere italiani e parlanti.
function validateAttachments(raw: unknown): AttachmentValidation {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { error: 'Allegati non validi.' };
  if (raw.length === 0) return { attachments: [] };
  if (raw.length > MAX_ATTACHMENTS) {
    return { error: `Troppi allegati: al massimo ${MAX_ATTACHMENTS} per messaggio.` };
  }

  const out: ChatAttachment[] = [];
  let total = 0;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { error: 'Allegato non valido.' };
    const { kind, mediaType, data } = item as {
      kind?: unknown;
      mediaType?: unknown;
      data?: unknown;
    };
    if (typeof data !== 'string' || data.length === 0) return { error: 'Allegato vuoto o non leggibile.' };
    if (!isDecodableBase64(data)) return { error: 'Allegato corrotto o non leggibile: riprova a caricarlo.' };
    const bytes = approxBase64Bytes(data);
    if (bytes > MAX_ITEM_BYTES) return { error: 'Allegato troppo grande: il massimo è 4MB.' };
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return { error: 'Allegati troppo grandi nel complesso: riduci o togline qualcuno.' };

    if (
      kind === 'image' &&
      typeof mediaType === 'string' &&
      (IMAGE_TYPES as readonly string[]).includes(mediaType)
    ) {
      out.push({ kind: 'image', mediaType: mediaType as (typeof IMAGE_TYPES)[number], data });
    } else if (kind === 'document' && mediaType === 'application/pdf') {
      out.push({ kind: 'document', mediaType: 'application/pdf', data });
    } else {
      return { error: 'Formato non supportato: immagini (JPEG, PNG, GIF, WebP) o PDF.' };
    }
  }
  return { attachments: out };
}

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    // Cap giornaliero / kill-switch (B3): respinge prima di qualunque chiamata LLM.
    // Fail-open sulla LETTURA del consumo: un errore transitorio di AiUsage non
    // deve rompere la chat (il cap è protezione costi, non percorso critico). Il
    // kill-switch (cap<=0) invece blocca sempre, anche se la lettura fallisce.
    // Task 64 (A5, D33): `code` distingue lato client il kill-switch dal cap
    // giornaliero — messaggi e affordance diversi (niente Riprova inutile).
    if (CHAT_DAILY_CAP <= 0) {
      return NextResponse.json(
        { error: 'La chat è temporaneamente non disponibile.', code: 'chat_disabled' },
        { status: 429 },
      );
    }
    let dailyChatCalls = 0;
    try {
      dailyChatCalls = await getDailyCalls(userId, 'chat');
    } catch (err) {
      console.error('[chat/turn] getDailyCalls failed, fail-open:', err);
    }
    if (dailyChatCalls >= CHAT_DAILY_CAP) {
      return NextResponse.json(
        { error: 'Hai raggiunto il limite di messaggi per oggi. Riprova domani.', code: 'daily_cap' },
        { status: 429 },
      );
    }

    // Task 69 (I, S2-K): body non-JSON finiva nel catch esterno come 500.
    // Input invalido → 400, mai 500 (pattern di /api/consent).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
    }
    const { threadId, mode, userMessage, relatedTaskId, clientDate, attachments } = body as {
      threadId?: string;
      mode?: string;
      userMessage?: string;
      relatedTaskId?: string;
      clientDate?: string;
      attachments?: unknown;
    };

    // Task 54: valida gli allegati. Errore -> 400 con messaggio.
    const attResult = validateAttachments(attachments);
    if (attResult.error) {
      return NextResponse.json({ error: attResult.error }, { status: 400 });
    }
    const validAttachments = attResult.attachments ?? [];
    const hasAttachments = validAttachments.length > 0;

    // Task 54: userMessage obbligatorio SOLO se non ci sono allegati (consenti
    // l'invio con solo allegato).
    const trimmedMessage = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!trimmedMessage && !hasAttachments) {
      return NextResponse.json({ error: 'Scrivi un messaggio o allega un file.' }, { status: 400 });
    }
    if (typeof userMessage === 'string' && userMessage.length > 4000) {
      return NextResponse.json({ error: 'Messaggio troppo lungo: il massimo è 4000 caratteri.' }, { status: 400 });
    }

    const chatMode: ChatMode = VALID_MODES.includes(mode as ChatMode)
      ? (mode as ChatMode)
      : 'general';

    // clientDate: optional 'YYYY-MM-DD' used by evening_review for the deadline cutoff.
    // Silent validation: invalid -> drop, let orchestrator fall back to server-side Europe/Rome.
    const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
    const validClientDate =
      typeof clientDate === 'string' &&
      DATE_PATTERN.test(clientDate) &&
      !isNaN(new Date(clientDate).getTime())
        ? clientDate
        : undefined;

    // Task 53 — Rollover a giorno-calendario sul turno (decisione D3, BLOCCATA).
    // Copre la tab lasciata aperta a cavallo della mezzanotte (ora di Roma) SENZA
    // remount: senza questo, il turno post-mezzanotte finirebbe sul thread di
    // ieri. Se il thread inviato dal client e' non-terminale, non-evening e
    // iniziato in un giorno-Roma precedente, lo archiviamo e ripartiamo da zero
    // (threadId=null -> l'orchestrator crea un thread 'general' pulito riusando il
    // suo path di create, cosi' non tocchiamo orchestrator.ts). evening_review
    // escluso da shouldRollOverThread: la review serale ha ciclo di vita proprio.
    // Decisione di rollover SERVER-side (Rome), non dal clientDate (skew-proof).
    let effectiveThreadId: string | null = threadId ?? null;
    let effectiveMode: ChatMode = chatMode;
    if (effectiveThreadId) {
      const existing = await db.chatThread.findFirst({
        where: { id: effectiveThreadId, userId },
        select: { id: true, startedAt: true, mode: true, state: true },
      });
      if (
        existing &&
        existing.state !== 'completed' &&
        existing.state !== 'archived' &&
        shouldRollOverThread(existing)
      ) {
        console.warn('[rollover] archived previous-day thread on turn, threadId=' + existing.id);
        await db.chatThread.update({
          where: { id: existing.id },
          data: { state: 'archived', endedAt: new Date() },
        });
        effectiveThreadId = null;
        effectiveMode = 'general';
      }
    }

    const result = await orchestrate({
      userId,
      threadId: effectiveThreadId,
      mode: effectiveMode,
      userMessage: trimmedMessage,
      relatedTaskId: relatedTaskId ?? null,
      clientDate: validClientDate,
      attachments: hasAttachments ? validAttachments : undefined,
    });

    // Task 40: fold del rolling summary DOPO la risposta (0ms percepiti).
    // INCONDIZIONATO: tutti i gate (kill switch, thread.mode evening_review,
    // stato) vivono in rollSummaryIfNeeded, server-side — il chatMode del
    // client desincronizza sistematicamente post-review e NON va usato qui
    // (spec Task 40 §8 #1). rollSummaryIfNeeded non rigetta mai (fail-open);
    // il catch e' cintura contro unhandled rejection dentro after().
    after(() =>
      rollSummaryIfNeeded(result.threadId).catch(err =>
        console.error('[summary] after() trigger failed:', err),
      ),
    );

    // B3: registra il consumo del turno in AiUsage (alimenta il cap sopra e il
    // budget per tier W3). result espone già i totali aggregati del turno.
    after(() =>
      recordAiUsage(userId, 'chat', {
        model: 'chat-turn',
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      }).catch(err => console.error('[ai-usage] chat turn failed:', err)),
    );

    // Task 41 (bug mode-sticky post-review): result.mode e' il mode
    // autorevole post-turno calcolato dall'orchestrator (thread terminale a
    // fine turno -> 'general'; altrimenti thread.mode, garantito dal guard
    // anti mode-spoof di Section 1). ChatView fa setMode(data.mode) accanto
    // a setThreadId a ogni risposta.
    return NextResponse.json(result);
  } catch (err) {
    captureApiError(err, '/api/chat/turn');
    // Messaggio generico: non esporre err.message (può rivelare dettagli interni).
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}