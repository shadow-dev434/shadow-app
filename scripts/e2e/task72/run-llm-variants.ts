/**
 * Task 72 (B3) — run LLM REALE: varianti di apertura SHARE e OCR nella review.
 *
 * Review serale reale con 2 entry seminate:
 *  - Bolletta TARI (source='ocr', deadline tra 3 giorni) → l'apertura deve
 *    nominare l'origine foto ("dalla foto ho letto...") e il framing temporale;
 *  - Iscrizione corso primo soccorso (source='share', sourceRef=URL) →
 *    l'apertura deve nominare la condivisione ("te la sei condivisa...").
 * In entrambe: presentazione neutra, mai "hai una bolletta scaduta" (Layer 2).
 *
 * Costo: ~4-6 turni smart (~$0.4-0.8). Utente effimero, finestra ripristinata.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task72/run-llm-variants.ts
 */

import { db } from '@/lib/db';
import { executeTool } from '@/lib/chat/tools';
import {
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  postTurn,
  assert,
  warn,
  finish,
} from '../collaudo-68/lib';

// NB: niente /lett[ao]/ nudo — matcherebbe dentro "bo-lletta" (falso positivo
// visto al primo run: apertura GMAIL-style passava il check).
const OCR_OPEN_RE = /foto|scatt|ho letto/i;
const SHARE_OPEN_RE = /condivis|da fuori|altra app|mandat[ao]/i;
const SHAMING_RE = /non l'hai (ancora )?(fatta|pagata)|è la \w+ volta|da \d+ (giorni|sere)/i;

function inNDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const u = await createEphemeralUser('t72-llm-var');
  await db.adaptiveProfile.create({ data: { userId: u.id } });

  // Entry OCR: deadline vicina → il triage la apre per prima (reason deadline).
  await db.task.create({
    data: {
      userId: u.id,
      title: 'Bolletta TARI',
      status: 'inbox',
      source: 'ocr',
      sourceRef: 'AVVISO DI PAGAMENTO TARI 2026 — importo 154,30 — pagare entro il ' + inNDays(3),
      deadline: new Date(`${inNDays(3)}T00:00:00.000Z`),
      urgency: 4,
      importance: 3,
    },
  });
  // Entry SHARE: nessuna deadline → arriva dopo (reason new).
  await db.task.create({
    data: {
      userId: u.id,
      title: 'Iscrizione corso primo soccorso',
      status: 'inbox',
      source: 'share',
      sourceRef: 'https://esempio.it/corso-primo-soccorso',
      urgency: 3,
      importance: 3,
    },
  });

  await executeTool('set_user_mood', { level: 4 }, u.id);
  await executeTool('set_user_energy', { level: 3 }, u.id);
  const restore = await openEveningWindow(u.id);

  try {
    const t1 = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: '__auto_start__' });
    assert(t1.status === 200, 'T1 (auto start) 200', t1.status);
    const threadId = t1.json.threadId as string;
    assert(typeof threadId === 'string', 'T1: threadId presente', t1.json);
    console.log('[T1]', String(t1.json.assistantMessage ?? '').slice(0, 160));

    // Avanza (conferma mood/intake) finché non appare l'apertura della TARI.
    let ocrOpening = '';
    const nudges = ['confermo', 'sì, tutto ok, andiamo', 'ok'];
    for (const msg of nudges) {
      const t = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: msg, threadId });
      assert(t.status === 200, `turno "${msg}" 200`, t.status);
      const reply = String(t.json.assistantMessage ?? '');
      console.log(`[reply dopo "${msg}"]`, reply.slice(0, 220));
      if (/tari/i.test(reply)) {
        ocrOpening = reply;
        break;
      }
    }
    assert(ocrOpening !== '', 'apertura entry OCR raggiunta (menziona TARI)');
    assert(OCR_OPEN_RE.test(ocrOpening), 'OCR: l\'apertura nomina l\'origine foto', ocrOpening.slice(0, 200));
    assert(!SHAMING_RE.test(ocrOpening), 'OCR: nessun rinfaccio (Layer 2)', ocrOpening.slice(0, 200));
    if (!/scade|entro|giorn/i.test(ocrOpening)) {
      warn('OCR: framing temporale non rilevato (deadline tra 3 giorni)', ocrOpening.slice(0, 160));
    }

    // Risolvi la TARI → il triage apre la entry SHARE.
    let shareOpening = '';
    const resolves = ['sì, la pago domani mattina', 'ok, avanti'];
    for (const msg of resolves) {
      const t = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: msg, threadId });
      assert(t.status === 200, `turno "${msg}" 200`, t.status);
      const reply = String(t.json.assistantMessage ?? '');
      console.log(`[reply dopo "${msg}"]`, reply.slice(0, 220));
      if (/corso|soccorso/i.test(reply)) {
        shareOpening = reply;
        break;
      }
    }
    assert(shareOpening !== '', 'apertura entry SHARE raggiunta (menziona il corso)');
    assert(
      SHARE_OPEN_RE.test(shareOpening),
      'SHARE: l\'apertura nomina la condivisione',
      shareOpening.slice(0, 200),
    );
    assert(!SHAMING_RE.test(shareOpening), 'SHARE: nessun rinfaccio (Layer 2)', shareOpening.slice(0, 200));
  } finally {
    await restore();
    await deleteEphemeralUser(u.email);
    await db.$disconnect();
  }
}

main()
  .then(() => finish('run-llm-variants'))
  .catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
  });
