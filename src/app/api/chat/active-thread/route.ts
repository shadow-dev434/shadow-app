/**
 * GET /api/chat/active-thread
 *
 * Ritorna il ChatThread piu' recente dell'utente corrente da reidratare
 * (state='active', oppure 'paused' per i thread evening_review da
 * riprendere dentro la finestra serale -- vedi lazy archive di Slice 3
 * sotto), insieme agli ultimi 200 messaggi visibili all'utente
 * (role='user'|'assistant'), in ordine cronologico ascendente. Usato
 * da ChatView al mount per reidratare la conversazione in corso --
 * senza questo endpoint il client perdeva threadId+messaggi ad ogni
 * remount e ne creava uno nuovo ad ogni sendMessage (Task 3, Step 1
 * post-mortem).
 *
 * Auth: richiede NextAuth session cookie (requireSession).
 *
 * Query params:
 *   ?clientTime=HH:MM   ora locale del client (timezone-agnostic).
 *                       Usato per decidere se l'utente e' dentro la
 *                       finestra serale configurata in Settings.
 *   ?clientDate=YYYY-MM-DD  data locale del client. Usato per cercare
 *                           una eventuale Review esistente per oggi.
 *
 * Entrambi i parametri sono opzionali ma necessari insieme per il
 * segnale eveningReview: se mancanti o malformati, la response
 * contiene eveningReview.shouldStart=false e un warning viene loggato
 * server-side.
 *
 * Response shape:
 *   200 OK, body =
 *     { activeThread: null,
 *       eveningReview: { shouldStart: boolean } }
 *   oppure
 *     { activeThread: {
 *         threadId: string,
 *         mode: string,
 *         messages: Array<{
 *           id: string,
 *           role: 'user' | 'assistant',
 *           content: string,
 *           createdAt: string  // ISO 8601
 *         }>,
 *         hasMore: boolean  // true se esistono messaggi piu' vecchi
 *                           //   dei 200 restituiti (paginazione in
 *                           //   task futuro)
 *       },
 *       eveningReview: { shouldStart: boolean }
 *     }
 *
 * L'endpoint ritorna al massimo gli ultimi 200 messaggi ordinati
 * cronologicamente ascendente. hasMore: true indica che ne esistono
 * di piu' vecchi: la UI potra' mostrare un affordance "carica
 * messaggi precedenti" in Task futuri, ma la rehydration base del
 * turn corrente e' sempre coperta dagli ultimi 200.
 *
 * I messaggi con role='system' o 'tool' (context LLM interno) sono
 * filtrati server-side: non devono comparire nella UI.
 *
 * Campi ChatMessage fuori dalla shape in questa iterazione:
 * payloadJson (toolsExecuted/quickReplies), modelUsed, tokens*,
 * latencyMs -- non necessari alla rehydration base del thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { INACTIVITY_PAUSE_MINUTES } from '@/lib/evening-review/config';
import { normalizeThreadState } from '@/lib/evening-review/normalize';

const MESSAGE_LIMIT = 200;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ActiveThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ActiveThreadPayload {
  threadId: string;
  mode: string;
  messages: ActiveThreadMessage[];
  hasMore: boolean;
}

interface EveningReviewPayload {
  shouldStart: boolean;
}

interface ActiveThreadResponse {
  activeThread: ActiveThreadPayload | null;
  eveningReview: EveningReviewPayload;
}

/**
 * Helper privato: fetch dei campi di Settings rilevanti per evening review.
 * Estratto per uniformare le due call site (normalize flow + computeEveningReview).
 */
async function loadSettings(userId: string) {
  return db.settings.findFirst({
    where: { userId },
    select: { eveningWindowStart: true, eveningWindowEnd: true },
  });
}

async function computeEveningReview(
  userId: string,
  validatedNowHHMM: string | null,
  clientDate: string | null,
): Promise<EveningReviewPayload> {
  if (
    !validatedNowHHMM ||
    !clientDate ||
    !DATE_PATTERN.test(clientDate)
  ) {
    console.warn(
      '[active-thread] missing or invalid clientTime/clientDate, defaulting to shouldStart=false',
    );
    return { shouldStart: false };
  }

  const settings = await loadSettings(userId);
  if (!settings) return { shouldStart: false };

  if (!isInsideEveningWindow(validatedNowHHMM, settings)) {
    return { shouldStart: false };
  }

  const reviewToday = await db.review.findFirst({
    where: { userId, date: clientDate },
    select: { id: true },
  });
  if (reviewToday) return { shouldStart: false };

  // Defensive: dopo lazy archive in GET, un evening_review orfano non
  // dovrebbe piu' esistere qui. Lasciato come safety net contro race
  // tra chiamate concorrenti dello stesso utente.
  const eveningThread = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'evening_review',
      state: { in: ['active', 'paused'] },
    },
    select: { id: true },
  });
  if (eveningThread) return { shouldStart: false };

  return { shouldStart: true };
}

export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  const now = new Date();
  const clientTimeRaw = req.nextUrl.searchParams.get('clientTime');
  const clientDate = req.nextUrl.searchParams.get('clientDate');
  const validatedNowHHMM: string | null =
    clientTimeRaw && TIME_PATTERN.test(clientTimeRaw) ? clientTimeRaw : null;

  try {
    let thread = await db.chatThread.findFirst({
      where: {
        userId,
        OR: [
          { state: 'active' },
          { state: 'paused', mode: 'evening_review' },
        ],
      },
      orderBy: { lastTurnAt: 'desc' },
      select: { id: true, mode: true, state: true, lastTurnAt: true },
    });

    // Lazy archive / state normalization per thread evening_review.
    // Vedi src/lib/evening-review/normalize.ts e piano Slice 3 sezione 5.
    // Single-writer: questo e' l'unico punto in cui lo state di un
    // evening_review thread viene transizionato fuori da Slice 7 (chiusura
    // atomica). Se settings non esiste l'utente e' in stato anomalo
    // (onboarding incompleto / corrotto) - skippiamo normalize e lasciamo
    // il thread invariato; non e' compito di Slice 3 gestirlo.
    if (thread !== null && thread.mode === 'evening_review') {
      const settings = await loadSettings(userId);
      if (settings !== null) {
        const result = normalizeThreadState({
          thread,
          now,
          nowHHMM: validatedNowHHMM,
          settings,
          inactivityPauseMinutes: INACTIVITY_PAUSE_MINUTES,
        });
        if (result.shouldPersist) {
          await db.chatThread.update({
            where: { id: thread.id },
            data: {
              state: result.desiredState,
              ...(result.desiredState === 'archived' ? { endedAt: now } : {}),
            },
          });
        }
        if (result.desiredState === 'archived') {
          thread = null; // fall-through al ramo computeEveningReview.
        }
      } else {
        console.warn('[active-thread] evening_review thread found but settings missing, skipping normalize');
      }
    }

    if (!thread) {
      const eveningReview = await computeEveningReview(userId, validatedNowHHMM, clientDate);
      const body: ActiveThreadResponse = { activeThread: null, eveningReview };
      return NextResponse.json(body);
    }

    const rows = await db.chatMessage.findMany({
      where: {
        threadId: thread.id,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_LIMIT + 1,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > MESSAGE_LIMIT;
    const truncated = hasMore ? rows.slice(0, MESSAGE_LIMIT) : rows;

    const messages: ActiveThreadMessage[] = truncated
      .map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      }))
      .reverse();

    const body: ActiveThreadResponse = {
      activeThread: {
        threadId: thread.id,
        mode: thread.mode,
        messages,
        hasMore,
      },
      eveningReview: { shouldStart: false },
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[/api/chat/active-thread] error:', err);
    return NextResponse.json(
      { error: 'Failed to load active thread' },
      { status: 500 },
    );
  }
}
