/**
 * Task 40 — Rolling summary della chat.
 *
 * Quando i messaggi scivolano oltre la finestra LLM, vengono piegati ("fold")
 * incrementalmente in un riassunto per-thread con semantica LEDGER (fatti
 * registrati, non un pattern di stile da continuare), salvato come riga
 * ChatMessage con role='summary' (append-only, zero migration: role e' una
 * String libera nello schema) e iniettato nel prompt come terzo blocco system
 * cachato (vedi client.ts systemPrompt.summary).
 *
 * Scelte load-bearing (spec docs/tasks/40-rolling-summary.md):
 *  - Storage append-only su ChatMessage, MAI in thread.contextJson: la
 *    riserializzazione dell'orchestrator (orchestrator.ts ~:767) ricostruisce
 *    contextJson dai soli namespace evening_review e cancellerebbe il summary
 *    in silenzio (il mode del client puo' desincronizzarsi: spec §8 #1).
 *  - Watermark (coveredUntilCreatedAt + coveredUntilMessageId, tiebreaker
 *    createdAt-poi-id come la query history dell'orchestrator): il summary e'
 *    ancorato a un cursore, mai a conteggi -> non puo' divergere dalla history.
 *  - Reader pick-max-watermark: due fold concorrenti (multi-device; il
 *    single-flight e' solo client-side) producono al peggio due righe e il
 *    reader converge deterministicamente. Watermark mai regressivo.
 *  - Fail-open TOTALE: rollSummaryIfNeeded non lancia MAI (try/catch proprio);
 *    su errore il watermark resta fermo e si ritenta al turno successivo
 *    (il count post-watermark e' ancora sopra soglia: auto-riparante).
 *  - Gate sul mode SERVER-SIDE (thread.mode), mai sul mode inviato dal client.
 *
 * Tutte le soglie vivono qui (file auto-approvabile): ritarabili senza toccare
 * file protetti. Valori per finestra 60 (decisione di prodotto #4).
 */

import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';

// ── Costanti (spec §4) ──────────────────────────────────────────────────────

export const SUMMARY_ROLE = 'summary';

/** Finestra effettiva del modello: slice(-WINDOW) SEMPRE attivo (= opzione 1). */
export const SUMMARY_WINDOW = 60;
/** Count post-watermark che innesca il fold. */
export const SUMMARY_TRIGGER = 60;
/** Messaggi recenti mai piegati. */
export const SUMMARY_KEEP = 30;
/** Max messaggi per evento di fold: il backlog dei thread veterani converge in piu' turni. */
export const SUMMARY_MAX_BATCH = 40;
/**
 * Cap di fetch della query history dell'orchestrator. NON e' una finestra
 * alternativa: compensa le righe pre-watermark scartate dal filtro; la
 * finestra effettiva resta slice(-SUMMARY_WINDOW) in ogni stato del flag.
 */
export const SUMMARY_HARD_CAP = 80;
export const SUMMARIZER_MAX_TOKENS = 700;
/** Bound duro sul blocco iniettato nel prompt (oltre il maxTokens del summarizer). */
export const SUMMARY_BLOCK_CHAR_CAP = 6000;
/** Troncamento per-messaggio nel prompt del summarizer (bound costi, spec §6). */
export const SUMMARIZER_MSG_CHAR_CAP = 1500;
/** Fetch cap del check post-watermark: basta per trigger detection + batch. */
const FETCH_CAP = SUMMARY_TRIGGER + SUMMARY_MAX_BATCH;

// ── Tipi ────────────────────────────────────────────────────────────────────

export interface SummaryPayload {
  kind: 'rolling-summary';
  version: 1;
  /** Watermark: ultimo messaggio coperto (tiebreaker createdAt poi id). */
  coveredUntilMessageId: string;
  /** ISO 8601. */
  coveredUntilCreatedAt: string;
  /** Cumulativo dei messaggi piegati in tutti i fold del thread. */
  messagesCovered: number;
  /** Costo del singolo fold (la colonna non esiste: vive nel payload). */
  costUsd: number;
}

export interface LoadedSummary {
  text: string;
  payload: SummaryPayload;
}

/** Proiezione minima di ChatMessage usata da fold e filtro watermark. */
export interface FoldableMessage {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export interface RollSummaryResult {
  status: 'disabled' | 'skipped' | 'not_due' | 'folded' | 'error';
  reason?: string;
}

// ── Kill switch (decisione di prodotto #6: default ON) ─────────────────────

export function isRollingSummaryEnabled(): boolean {
  return process.env.SHADOW_ROLLING_SUMMARY?.trim().toLowerCase() !== 'off';
}

// ── Parse tollerante del payload ────────────────────────────────────────────

/**
 * Riga malformata -> null (scartata dal reader): un fold corrotto non deve
 * mai rompere il turno. Pattern calco di loadTriageStateFromContext.
 * messagesCovered/costUsd tolleranti (default 0): non sono load-bearing.
 */
export function parseSummaryPayload(payloadJson: string | null): SummaryPayload | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as Partial<SummaryPayload> | null;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.kind !== 'rolling-summary' ||
      parsed.version !== 1 ||
      typeof parsed.coveredUntilMessageId !== 'string' ||
      typeof parsed.coveredUntilCreatedAt !== 'string' ||
      isNaN(new Date(parsed.coveredUntilCreatedAt).getTime())
    ) {
      return null;
    }
    return {
      kind: 'rolling-summary',
      version: 1,
      coveredUntilMessageId: parsed.coveredUntilMessageId,
      coveredUntilCreatedAt: parsed.coveredUntilCreatedAt,
      messagesCovered:
        typeof parsed.messagesCovered === 'number' ? parsed.messagesCovered : 0,
      costUsd: typeof parsed.costUsd === 'number' ? parsed.costUsd : 0,
    };
  } catch {
    return null;
  }
}

// ── Watermark ───────────────────────────────────────────────────────────────

/**
 * True se msg e' DOPO il watermark del payload. Tiebreaker createdAt-poi-id,
 * stessa convenzione della query history dell'orchestrator (orderBy
 * [createdAt, id]): a parita' di timestamp decide l'id (cuid, confronto
 * lessicografico coerente con l'orderBy Prisma).
 */
export function isAfterWatermark(
  msg: Pick<FoldableMessage, 'id' | 'createdAt'>,
  payload: SummaryPayload,
): boolean {
  const wm = new Date(payload.coveredUntilCreatedAt).getTime();
  const t = msg.createdAt.getTime();
  if (t !== wm) return t > wm;
  return msg.id > payload.coveredUntilMessageId;
}

/** Ordine totale tra due watermark (per il pick-max del reader). */
function watermarkIsAfter(a: SummaryPayload, b: SummaryPayload): boolean {
  return isAfterWatermark(
    { id: a.coveredUntilMessageId, createdAt: new Date(a.coveredUntilCreatedAt) },
    b,
  );
}

// ── Reader: pick-max-watermark ──────────────────────────────────────────────

/**
 * Ultimo summary valido del thread. findMany take 3 (non findFirst): sotto
 * concorrenza multi-device possono esistere righe multiple; vince il watermark
 * MASSIMO tra le righe con payload valido -> il watermark letto non regredisce
 * mai, indipendentemente dall'ordine di insert.
 */
export async function loadLatestSummary(threadId: string): Promise<LoadedSummary | null> {
  const rows = await db.chatMessage.findMany({
    where: { threadId, role: SUMMARY_ROLE },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 3,
    select: { content: true, payloadJson: true },
  });
  let best: LoadedSummary | null = null;
  for (const row of rows) {
    const payload = parseSummaryPayload(row.payloadJson);
    if (payload === null) continue;
    if (best === null || watermarkIsAfter(payload, best.payload)) {
      best = { text: row.content, payload };
    }
  }
  return best;
}

// ── Blocco iniettato nel prompt ─────────────────────────────────────────────

/**
 * Testo del blocco system `summary` (client.ts). Header con semantica ledger;
 * quando il backlog non e' ancora convergito (uncoveredCount oltre la finestra:
 * fold in corso su thread veterano, o fold falliti a lungo) l'header DICHIARA
 * la copertura parziale invece di mentire sulla completezza (spec §8 #3).
 *
 * @param uncoveredCount messaggi post-watermark PRIMA dello slice(-WINDOW)
 *   (cappato dal fetch HARD_CAP: oltre, "+").
 */
export function buildSummaryBlock(summary: LoadedSummary, uncoveredCount: number): string {
  const text =
    summary.text.length > SUMMARY_BLOCK_CHAR_CAP
      ? summary.text.slice(0, SUMMARY_BLOCK_CHAR_CAP) + '…'
      : summary.text;
  const coveredUntilDay = summary.payload.coveredUntilCreatedAt.slice(0, 10);
  const gapNote =
    uncoveredCount > SUMMARY_WINDOW
      ? `\n\nNOTA COPERTURA: il riassunto arriva fino al ${coveredUntilDay}; circa ${
          uncoveredCount - SUMMARY_WINDOW
        }+ messaggi intermedi non sono ancora rappresentati ne' qui ne' nella finestra recente. Non dare per completa la memoria della conversazione.`
      : '';
  return `RIASSUNTO DEI TURNI PRECEDENTI — ledger di fatti registrati della parte piu' vecchia della conversazione, NON un pattern di stile da continuare:\n\n${text}${gapNote}`;
}

// ── Selezione del batch da piegare (pura) ───────────────────────────────────

/**
 * Dal set post-watermark (ordine cronologico) seleziona i messaggi da piegare:
 * tutti tranne i KEEP piu' recenti, cappati a MAX_BATCH (i PIU' VECCHI).
 * Il batch termina sempre su una riga assistant: mai spezzare una coppia
 * user->assistant tra summary e finestra (la finestra residua riparte da una
 * riga user; il parity trim dell'orchestrator resta il guard finale).
 * null = fold non dovuto.
 */
export function selectFoldBatch(postWatermark: FoldableMessage[]): FoldableMessage[] | null {
  if (postWatermark.length < SUMMARY_TRIGGER) return null;
  const foldableCount = Math.min(postWatermark.length - SUMMARY_KEEP, SUMMARY_MAX_BATCH);
  if (foldableCount <= 0) return null;
  const batch = postWatermark.slice(0, foldableCount);
  while (batch.length > 0 && batch[batch.length - 1].role !== 'assistant') {
    batch.pop();
  }
  return batch.length > 0 ? batch : null;
}

// ── Prompt del summarizer ───────────────────────────────────────────────────

/**
 * Vincolo non negoziabile (spec §2): segnali emotivi/di crisi e motivi di
 * rimando per-task vanno PRESERVATI, mai compressi via. I marker sintetici
 * (es. '__auto_start__' del bootstrap, persistito come riga user) vanno
 * ignorati: non sono enunciati dell'utente.
 */
export function buildSummarizerPrompt(
  prevSummaryText: string | null,
  batch: FoldableMessage[],
): { system: string; user: string } {
  const system = `Sei il compressore di memoria di Shadow, assistente per adulti ADHD. Aggiorni un LEDGER della conversazione: un elenco denso di fatti registrati, in italiano.

REGOLE:
- Output: SOLO il ledger aggiornato, senza preamboli ne' commenti.
- Integra i nuovi turni nel ledger precedente: aggiorna le voci superate, non duplicare.
- Registra: fatti concreti, decisioni prese, task citati (con stato e MOTIVI di rimando/blocco), preferenze espresse, promesse fatte dall'assistente, questioni rimaste aperte.
- PRESERVA SEMPRE, senza attenuarli: segnali emotivi o di crisi, scarico emotivo, frustrazione, menzioni di burnout. Non riassumerli via.
- Ignora completamente i marker sintetici di sistema (es. righe utente uguali a '__auto_start__').
- Niente stile narrativo: voci brevi, una per riga, raggruppate per tema se utile.
- Massimo ~500 parole.`;

  const lines = batch.map(m => {
    const text =
      m.content.length > SUMMARIZER_MSG_CHAR_CAP
        ? m.content.slice(0, SUMMARIZER_MSG_CHAR_CAP) + ' […troncato]'
        : m.content;
    return `${m.role === 'user' ? 'UTENTE' : 'SHADOW'}: ${text}`;
  });

  const user = `LEDGER PRECEDENTE:
${prevSummaryText ?? '(nessuno: primo fold di questo thread)'}

NUOVI TURNI DA INTEGRARE (dal piu' vecchio al piu' recente):
${lines.join('\n')}`;

  return { system, user };
}

// ── Fetch post-watermark ────────────────────────────────────────────────────

/**
 * Messaggi user/assistant DOPO il watermark, ordine cronologico, cap FETCH_CAP
 * (basta per trigger detection + batch: selectFoldBatch usa i PIU' VECCHI).
 * Il filtro watermark e' espresso nel WHERE (gt su createdAt, tiebreaker id a
 * parita') cosi' la query usa l'indice [threadId, createdAt] esistente.
 */
async function fetchPostWatermarkMessages(
  threadId: string,
  prev: LoadedSummary | null,
): Promise<FoldableMessage[]> {
  const watermarkFilter =
    prev === null
      ? {}
      : {
          OR: [
            { createdAt: { gt: new Date(prev.payload.coveredUntilCreatedAt) } },
            {
              createdAt: new Date(prev.payload.coveredUntilCreatedAt),
              id: { gt: prev.payload.coveredUntilMessageId },
            },
          ],
        };
  return db.chatMessage.findMany({
    where: {
      threadId,
      role: { in: ['user', 'assistant'] },
      ...watermarkFilter,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: FETCH_CAP,
    select: { id: true, role: true, content: true, createdAt: true },
  });
}

// ── Entry point: fold post-risposta ─────────────────────────────────────────

/**
 * Chiamato dal turn route via after() DOPO la risposta (zero latenza
 * percepita), incondizionatamente: TUTTI i gate vivono qui, server-side.
 * Non lancia MAI: il turno utente non puo' fallire per colpa del summarizer.
 */
export async function rollSummaryIfNeeded(threadId: string): Promise<RollSummaryResult> {
  try {
    if (!isRollingSummaryEnabled()) return { status: 'disabled' };

    const thread = await db.chatThread.findUnique({
      where: { id: threadId },
      select: { id: true, mode: true, state: true },
    });
    if (!thread) return { status: 'skipped', reason: 'thread_not_found' };
    // Gate su thread.mode SERVER-SIDE: il mode del client desincronizza
    // sistematicamente post-review (spec §8 #1) e non va mai usato qui.
    if (thread.mode === 'evening_review') {
      return { status: 'skipped', reason: 'evening_review' };
    }
    if (thread.state !== 'active') {
      return { status: 'skipped', reason: `state_${thread.state}` };
    }

    const prev = await loadLatestSummary(threadId);
    const postWatermark = await fetchPostWatermarkMessages(threadId, prev);
    const batch = selectFoldBatch(postWatermark);
    if (batch === null) return { status: 'not_due' };

    const prompt = buildSummarizerPrompt(prev?.text ?? null, batch);
    // maxAttempts 1: il fold e' auto-riparante (count ancora sopra soglia al
    // turno dopo); il retry interno triplicherebbe il worst-case di durata
    // dentro il budget maxDuration dell'after() (spec §8 #5).
    const response = await callLLM({
      tier: 'fast',
      systemPrompt: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: SUMMARIZER_MAX_TOKENS,
      temperature: 0.2,
      maxAttempts: 1,
    });
    if (!response.text.trim()) {
      console.error(`[summary] fold failed threadId=${threadId}: empty summarizer output`);
      return { status: 'error', reason: 'empty_summary' };
    }

    const last = batch[batch.length - 1];

    // Guard CAS: re-read del watermark subito prima dell'insert — si inserisce
    // SOLO se il watermark su cui questo fold si e' basato (prev) e' ancora
    // l'ultimo. Un fold concorrente che e' avanzato nel frattempo (es. after()
    // di un turno precedente ritardato sotto carico: osservato nel probe e2e)
    // fa scartare il nostro: i suoi messaggi non coperti verranno ripiegati al
    // trigger successivo (auto-riparante). Restringe la finestra di race dalla
    // durata della chiamata LLM (secondi) ai millisecondi del re-read; la race
    // residua produce una riga doppia append-only che il reader pick-max
    // converge — watermark mai regressivo in ogni caso.
    const current = await loadLatestSummary(threadId);
    const currentWm = current?.payload.coveredUntilMessageId ?? null;
    const prevWm = prev?.payload.coveredUntilMessageId ?? null;
    if (currentWm !== prevWm) {
      return { status: 'skipped', reason: 'concurrent_fold' };
    }

    const payload: SummaryPayload = {
      kind: 'rolling-summary',
      version: 1,
      coveredUntilMessageId: last.id,
      coveredUntilCreatedAt: last.createdAt.toISOString(),
      messagesCovered: (prev?.payload.messagesCovered ?? 0) + batch.length,
      costUsd: response.costUsd,
    };
    await db.chatMessage.create({
      data: {
        threadId,
        role: SUMMARY_ROLE,
        content: response.text.trim(),
        payloadJson: JSON.stringify(payload),
        // Telemetria V2c sulle colonne esistenti: il fold e' interrogabile
        // con la query di monitoraggio della spec (§7) senza tabelle nuove.
        modelUsed: response.model,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        latencyMs: response.latencyMs,
      },
    });
    console.log(
      `[summary] fold threadId=${threadId} batch=${batch.length} ` +
        `covered=${payload.messagesCovered} watermark=${last.id} ` +
        `tokens=${response.tokensIn}/${response.tokensOut} ` +
        `cost=$${response.costUsd.toFixed(6)} latency=${response.latencyMs}ms`,
    );
    return { status: 'folded' };
  } catch (err) {
    // Fail-open totale (spec §5): log e basta, mai propagare all'after().
    console.error(`[summary] fold failed threadId=${threadId}:`, err);
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'unknown',
    };
  }
}
