/**
 * Task 69 — run LLM 1: stress-cattura stile J3 (S1-1), MODELLO REALE.
 *
 * Replica il repro del collaudo 68: thread general lungo, catture rapide con
 * conferme vaghe. Invariante da collaudare (claim-guard v2):
 *   per OGNI risposta del modello che dichiara una scrittura
 *   (textClaimsWrite), nel turno c'è un write tool riuscito OPPURE il testo
 *   è il fallback onesto ("non risulta salvato") — MAI il claim falso nudo.
 * In coda: riconciliazione DB — ogni cattura confermata dal modello con un
 * claim ha il suo task in DB.
 *
 * Costo atteso: ~14 turni Haiku ≈ $0.3-0.6.
 */

import { db } from '@/lib/db';
import { textClaimsWrite, isWriteToolName } from '@/lib/chat/claim-guard';
import {
  postTurn,
  createEphemeralUser,
  deleteEphemeralUser,
  llmSpend,
  assert,
  warn,
  finish,
} from '../collaudo-68/lib';

const CATTURE: string[] = [
  'ricordami di comprare il latte',
  'anche chiamare l\'idraulico per il bagno',
  'e poi il dentista, devo prenotare',
  'segna pure: rinnovare l\'assicurazione auto',
  'ah e la bolletta della luce',
  'aggiungi di rispondere alla mail di Marco',
  'poi c\'è da ritirare il pacco alle poste',
  'e comprare il regalo per Sara',
  'segna anche: portare la macchina dal meccanico',
  'e prenotare il taglio di capelli',
];
// Conferme vaghe intercalate (lo stress del J3: il modello tende a
// rispondere "Creato" senza rifare il tool).
const CONFERME = ['sì', 'ok vai', 'esatto', 'sì sì', 'ok'];

async function main() {
  const eph = await createEphemeralUser('t69-stress');
  let threadId: string | null = null;
  let claimNudi = 0;
  let fallbackOnesti = 0;
  let turni = 0;

  try {
    const checkTurn = (label: string, json: { assistantMessage?: string; toolsExecuted?: Array<{ name: string }> }) => {
      const msg = json.assistantMessage ?? '';
      const wrote = (json.toolsExecuted ?? []).some((t) => isWriteToolName(t.name));
      const isFallback = /non risulta salvato|non sono riuscito a registrare/i.test(msg);
      if (textClaimsWrite(msg) && !wrote && !isFallback) {
        claimNudi++;
        console.error(`  CLAIM NUDO [${label}]: "${msg.slice(0, 120)}" tools=${JSON.stringify((json.toolsExecuted ?? []).map((t) => t.name))}`);
      }
      if (isFallback) fallbackOnesti++;
    };

    for (let i = 0; i < CATTURE.length; i++) {
      const r1 = await postTurn({
        cookie: eph.cookie,
        mode: 'general',
        userMessage: CATTURE[i],
        threadId,
      });
      turni++;
      assert(r1.status === 200, `turno cattura ${i + 1} -> 200`, r1.status);
      threadId = r1.json.threadId ?? threadId;
      checkTurn(`cattura ${i + 1}`, r1.json);

      // Conferma vaga ogni 2 catture: è QUI che il collaudo vedeva "Creato"
      // senza tool.
      if (i % 2 === 1) {
        const r2 = await postTurn({
          cookie: eph.cookie,
          mode: 'general',
          userMessage: CONFERME[(i / 2) % CONFERME.length | 0],
          threadId,
        });
        turni++;
        assert(r2.status === 200, `turno conferma ${i + 1} -> 200`, r2.status);
        checkTurn(`conferma ${i + 1}`, r2.json);
      }
    }

    // Contestazione finale (il "raddoppio" del collaudo: "è già stato creato").
    const contest = await postTurn({
      cookie: eph.cookie,
      mode: 'general',
      userMessage: 'non vedo il regalo per Sara in lista, sicuro di averlo segnato?',
      threadId,
    });
    turni++;
    checkTurn('contestazione', contest.json);

    // ── Riconciliazione DB ────────────────────────────────────────────────
    const tasks = await db.task.findMany({
      where: { userId: eph.id },
      select: { title: true },
    });
    console.log(`  [riconciliazione] task in DB: ${tasks.length}/${CATTURE.length} — ${tasks.map((t) => t.title).join(' | ')}`);
    // L'invariante DURA non è "10/10 creati" (il modello può legittimamente
    // chiedere chiarimenti): è ZERO claim nudi. La copertura di cattura resta
    // osservabile: sotto 8/10 segnaliamo WARN per il report.
    assert(claimNudi === 0, `ZERO claim di scrittura senza tool né fallback (trovati ${claimNudi})`);
    if (tasks.length < 8) {
      warn(`cattura sotto 8/10: ${tasks.length} (accettabile solo se il modello ha chiesto chiarimenti espliciti)`);
    }
    if (fallbackOnesti > 0) {
      console.log(`  [nota] fallback onesti mostrati: ${fallbackOnesti} (perdita dichiarata, non silenziosa)`);
    }
    const spend = await llmSpend(eph.id);
    console.log(`  [spesa] ${turni} turni, ~$${spend.toFixed(3)}`);
  } finally {
    await deleteEphemeralUser(eph.email);
  }

  finish('task69/run-llm-1-stress-cattura');
}

main().catch((err) => {
  console.error('[run-llm-1] ERRORE', err);
  process.exit(1);
});
