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
import { captureApiError } from '@/lib/observability';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { computeEveningReviewSignal } from '@/lib/evening-review/compute-signal';
import { INACTIVITY_PAUSE_MINUTES } from '@/lib/evening-review/config';
import { normalizeThreadState } from '@/lib/evening-review/normalize';
import { computeInactivityGapDays } from '@/lib/evening-review/inactivity-gap';
import { shouldRollOverThread } from '@/lib/chat/day-rollover';

const MESSAGE_LIMIT = 200;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
 * Helper privato: fetch dei campi di Settings rilevanti per il normalize flow e
 * la spina 8c. Il segnale eveningReview è ora delegato a
 * computeEveningReviewSignal (lib/evening-review/compute-signal.ts), riusato
 * anche dall'endpoint read-only /api/chat/evening-signal per il polling client.
 */
async function loadSettings(userId: string) {
  return db.settings.findFirst({
    where: { userId },
    select: { eveningWindowStart: true, eveningWindowEnd: true },
  });
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
      select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, contextJson: true },
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
        // V1.2.2: detection paused -> active = resume di review interrotta.
        // Settiamo firstTurnAfterResume=true nel triageState (contextJson)
        // come escape hatch per il guard alreadyOpen di set_current_entry.
        // Vedi tools.ts executeSetCurrentEntry V1.2.2 e triage.ts
        // firstTurnAfterResume per il razionale catastrofico.
        const becameActiveFromPaused =
          thread.state === 'paused' &&
          result.desiredState === 'active' &&
          result.shouldPersist;
        let updatedContextJson: string | null = null;
        if (becameActiveFromPaused && thread.contextJson) {
          try {
            // Preserva tutti i namespace (triage, previewState, phase) via
            // spread del JSON originale. Pattern coerente con orchestrator.ts
            // serializzazione contextJson.
            const parsed = JSON.parse(thread.contextJson) as {
              triage?: Record<string, unknown>;
              [key: string]: unknown;
            };
            if (parsed.triage) {
              updatedContextJson = JSON.stringify({
                ...parsed,
                triage: { ...parsed.triage, firstTurnAfterResume: true },
              });
            }
          } catch {
            // contextJson malformato: skip silenzioso, no-op. Il guard V1.2.2
            // continuera' a scattare in modo sub-ottimale ma non rompera'
            // la review.
            updatedContextJson = null;
          }
        }

        if (result.shouldPersist) {
          await db.chatThread.update({
            where: { id: thread.id },
            data: {
              state: result.desiredState,
              ...(result.desiredState === 'archived' ? { endedAt: now } : {}),
              ...(updatedContextJson !== null ? { contextJson: updatedContextJson } : {}),
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

    // Task 53 — Rollover a giorno-calendario (ora di Roma). Decisione D3 (BLOCCATA).
    // Se il candidato e' un thread NON-evening (general / morning_checkin) iniziato
    // in un giorno-calendario Roma PRECEDENTE, lo archiviamo e cadiamo nel ramo
    // !thread: una chat pulita ogni giorno. La sidebar storica lo ripresenta
    // read-only come "chat del GG/MM/AAAA" (GET /api/chat/threads[/[id]]).
    // shouldRollOverThread esclude gli evening_review (ciclo di vita proprio:
    // normalize.ts qui sopra + close-review.ts), quindi una review lasciata
    // aperta a cavallo della mezzanotte NON viene mai archiviata da qui.
    // Posizione: DOPO il normalize evening-gated e PRIMA della spina 8c. Con
    // thread=null la 8c si salta (suo guard `thread !== null`), ma e' innocuo:
    // per i thread non-evening il rollover quotidiano e' un superset del caso 8c
    // (gap>=3gg => giorno-Roma diverso), quindi la pulizia resta garantita.
    // Single-writer: archiviamo il SOLO candidato (update mirato, non updateMany),
    // niente race con la 8c. endedAt:now allineato a normalize / close-review.
    if (thread !== null && shouldRollOverThread(thread)) {
      console.warn('[rollover] archived previous-day thread on mount, threadId=' + thread.id);
      await db.chatThread.update({
        where: { id: thread.id },
        data: { state: 'archived', endedAt: now },
      });
      thread = null; // cade nel ramo `if (!thread)` -> computeEveningReview / chat vuota.
    }

    // Slice 8c — spina di raggiungibilita' del re-entry.
    // Dopo il normalize evening-gated sopra, se il thread piu' recente e' un
    // residuo NON-evening (mode !== 'evening_review' implica state 'active': la
    // query :186-196 seleziona i non-evening solo via { state: 'active' }) e
    // l'utente sta rientrando da un'assenza DENTRO la finestra serale,
    // archiviamo l'intero set non-terminale e cadiamo nel ramo !thread ->
    // computeEveningReview -> card con threadId=null (Addendum #1/#2; design
    // 20-slice-8c-design.md §3). normalize.ts resta INTOCCATO: la spina copre
    // il caso "most-recent non-evening" che il gating evening-only di normalize
    // non gestisce.
    //
    // Vincolo-in-avanti (design §6, F7): l'apertura pulita della review dipende
    // dalla card che forza threadId=null. Ogni futuro trigger MANUALE di review
    // dovra' passare threadId=null esplicito, o avvierebbe la review su un thread
    // stale, inquinando initEveningReview al primo turno. (8c non aggiunge
    // trigger manuali; nota anche in docs/tasks/05-deploy-notes.md.)
    if (thread !== null && thread.mode !== 'evening_review') {
      const settings = await loadSettings(userId);
      // settings === null (onboarding incompleto): skip spina, comportamento
      // odierno invariato (si prosegue al rehydrate del residuo). Fuori finestra:
      // skip (senza shouldStart la card non apparirebbe; archiviare lascerebbe
      // l'utente senza thread ne' card).
      if (
        settings !== null &&
        validatedNowHHMM !== null &&
        isInsideEveningWindow(validatedNowHHMM, settings)
      ) {
        // Gap = max(lastTurnAt) su TUTTI i thread dell'utente, NESSUNA esclusione:
        // a active-thread il thread evening fresco non esiste ancora, quindi il
        // max coincide con l'ultimo contatto reale. Il Date dell'aggregate
        // (Date | null) entra DRITTO nell'helper (forcella F1=(a));
        // _max.lastTurnAt===null e' impossibile qui (thread!==null) ma l'helper
        // lo gestisce comunque (null -> skip).
        const agg = await db.chatThread.aggregate({
          _max: { lastTurnAt: true },
          where: { userId },
        });
        const gap = computeInactivityGapDays(agg._max.lastTurnAt, now);
        if (gap !== null) {
          // INVARIANTE (load-bearing). L'updateMany archivia un SUPERSET di cio'
          // che :186-196 restituisce, per due ragioni distinte: (a) include i
          // `paused` NON-evening, che quella query non seleziona affatto; (b)
          // include un eventuale evening_review (active o paused) PIU' VECCHIO del
          // residuo non-evening: la query e' findFirst con orderBy lastTurnAt desc,
          // quindi restituisce un solo thread -- se il residuo non-evening e' il
          // piu' recente, un evening piu' vecchio non viene ne' restituito ne'
          // visto dal normalize (che gira solo sul thread restituito), e
          // sopravviverebbe a bloccare computeEveningReview. Sicuro per
          // costruzione: gap>=3 <=> max(lastTurnAt) su TUTTI i thread >= 3gg <=>
          // nessun thread non-terminale ha attivita' recente -> archiviare
          // l'intero set non-terminale non distrugge mai un thread con lastTurnAt
          // recente. Se un domani la query si allargasse (nuovi state
          // non-terminali / nuova semantica), rivalutare l'invariante QUI. History
          // in DB (archived, non cancellata): nessun messaggio perso. endedAt:now
          // allineato a normalize (:253) e close-review (:242/:361).
          console.warn('[8c re-entry] archived stale threads on re-entry, gapDays=' + gap.gapDays);
          await db.chatThread.updateMany({
            where: { userId, state: { in: ['active', 'paused'] } },
            data: { state: 'archived', endedAt: now },
          });
          thread = null; // -> ramo !thread (:266) -> computeEveningReview -> card.
        }
      }
    }

    if (!thread) {
      const eveningReview = await computeEveningReviewSignal(userId, validatedNowHHMM, clientDate);
      const body: ActiveThreadResponse = { activeThread: null, eveningReview };
      return NextResponse.json(body);
    }

    const rows = await db.chatMessage.findMany({
      where: {
        threadId: thread.id,
        role: { in: ['user', 'assistant'] },
        // Task 63 (D31): i marker sintetici di apertura (bootstrap morning,
        // "Inizia la review") sono persistiti come righe user ma non sono
        // enunciati dell'utente: mai mostrarli come bolle al rehydrate.
        NOT: { role: 'user', content: '__auto_start__' },
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

    // Task 43 (bug review serale): un thread NON-serale sopravvissuto alla spina
    // 8c (gap < 3gg, es. chat usata la sera stessa) prima cadeva su
    // shouldStart:false hardcoded, rendendo la review irraggiungibile per chi ha
    // un thread attivo. Ora calcoliamo comunque il segnale: computeEveningReview
    // e' read-only e ritorna shouldStart:false se esiste gia' una Review-oggi o un
    // thread evening_review attivo/in-pausa -> nessun banner durante una review in
    // corso. Il client mostra un banner d'ingresso (ChatView EveningReviewBanner)
    // e avvia SEMPRE su threadId=null (vincolo F7, vedi commento riga 278-281).
    const eveningReview = await computeEveningReviewSignal(userId, validatedNowHHMM, clientDate);

    const body: ActiveThreadResponse = {
      activeThread: {
        threadId: thread.id,
        mode: thread.mode,
        messages,
        hasMore,
      },
      eveningReview,
    };
    return NextResponse.json(body);
  } catch (err) {
    captureApiError(err, 'GET /api/chat/active-thread');
    return NextResponse.json(
      { error: 'Failed to load active thread' },
      { status: 500 },
    );
  }
}
