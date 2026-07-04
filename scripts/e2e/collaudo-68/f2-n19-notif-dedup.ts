/**
 * Collaudo 68 Fase 2 — N19: POST /api/notifications con type libero sopprime il
 * dedup del cron review serale?
 *
 * Cron (cron/evening-review/route.ts:75-79) salta l'invio se esiste una
 * Notification type='evening_review_prompt' createdAt>=mezzanotte-Rome.
 * POST /api/notifications (route.ts:61) accetta `type` dal client senza validarlo.
 *
 * Repro deterministico:
 *  1. utente candidato genuino (finestra aperta, opt-in, no review/thread) →
 *     evening-signal shouldStart:true;
 *  2. controllo positivo: cron con l'utente PULITO → il nostro utente riceve il
 *     prompt (delta prompt-rows = +1);
 *  3. reset, poi il client fabbrica evening_review_prompt PRIMA del cron →
 *     cron: il nostro utente NON riceve un secondo prompt (delta = 0) perché il
 *     dedup ha visto la riga-cliente.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-n19-notif-dedup.ts
 */
import {
  preflightDb, api, createEphemeralUser, deleteEphemeralUser, db,
  openEveningWindow, saveEvidence, assert, warn,
} from './lib';
import { startOfDayInZone, formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

async function main() {
  await preflightDb();
  const secret = process.env.CRON_SECRET;
  if (!secret) { console.error('CRON_SECRET assente'); process.exit(1); }

  const u = await createEphemeralUser('n19', { consent: true, onboarded: true });
  await db.settings.updateMany({ where: { userId: u.id }, data: { notificationsEnabled: true } });
  const restore = await openEveningWindow(u.id);
  const dayStart = startOfDayInZone(formatTodayInRome(), 'Europe/Rome');
  const out: string[] = [];

  const promptCount = () => db.notification.count({
    where: { userId: u.id, type: 'evening_review_prompt', createdAt: { gte: dayStart } },
  });

  try {
    // (1) candidato genuino?
    const sig = await api('GET', `/api/chat/evening-signal?clientTime=${nowHHMMInRome()}&clientDate=${formatTodayInRome()}`, { cookie: u.cookie });
    out.push(`evening-signal → ${sig.status} ${sig.text}`);
    const shouldStart = (sig.json as { shouldStart?: boolean })?.shouldStart === true;
    assert(shouldStart, 'utente è candidato genuino alla review (shouldStart:true)', sig.text);

    // (0) client PUÒ scrivere il type interno cron?
    await db.notification.deleteMany({ where: { userId: u.id } });
    const evil = await api('POST', '/api/notifications', {
      cookie: u.cookie, body: { type: 'evening_review_prompt', title: 'x', body: 'y' },
    });
    assert(evil.status === 200, 'client accettato con type=evening_review_prompt (200)', evil.status);
    const written = await promptCount();
    assert(written === 1, 'riga evening_review_prompt scritta dal CLIENT', written);
    out.push(`POST notifications (evil) → ${evil.status}; prompt-rows=${written}`);

    // NB: le email verso *.probe.local rimbalzano (dominio finto) → nel cron il
    // nostro utente candidato finisce in `failed`, non in `sent` (nessun prompt
    // row scritto). Il dedup (già-sollecitato) però agisce PRIMA del send: se la
    // riga-cliente esiste, l'utente passa nel ramo `skipped` e l'email NON viene
    // nemmeno TENTATA. Prova N19 = spostamento del nostro utente da failed→skipped
    // per effetto della sola riga fabbricata dal client.
    const parse = (t: string) => JSON.parse(t) as { candidates: number; sent: number; skipped: number; failed: number };

    // (2) PULITO: nessuna riga-cliente. Il nostro utente è candidato → viene
    // TENTATO l'invio (failed, per il dominio finto).
    await db.notification.deleteMany({ where: { userId: u.id } });
    const cronClean = parse((await api('GET', '/api/cron/evening-review', { headers: { Authorization: `Bearer ${secret}` } })).text);
    out.push(`[PULITO]    cron → ${JSON.stringify(cronClean)}`);

    // (3) SABOTATO: riga-cliente fabbricata prima del cron.
    await db.notification.deleteMany({ where: { userId: u.id } });
    await api('POST', '/api/notifications', { cookie: u.cookie, body: { type: 'evening_review_prompt', title: 'x', body: 'y' } });
    const before3 = await promptCount(); // 1
    const cronSab = parse((await api('GET', '/api/cron/evening-review', { headers: { Authorization: `Bearer ${secret}` } })).text);
    const after3 = await promptCount();
    out.push(`[SABOTATO]  cron → ${JSON.stringify(cronSab)}; prompt-rows prima=${before3} dopo=${after3}`);

    // Con la riga-cliente presente: +1 skipped e -1 failed rispetto al pulito
    // (il nostro utente non viene più tentato). candidates costante.
    const shiftedToSkipped = cronSab.skipped === cronClean.skipped + 1;
    const noLongerAttempted = cronSab.failed === cronClean.failed - 1;
    const cronDidNotWrite = (after3 - before3) === 0;
    assert(shiftedToSkipped, 'SABOTAGGIO: +1 skipped nel cron (utente deviato nel ramo dedup)', { clean: cronClean.skipped, sab: cronSab.skipped });
    assert(noLongerAttempted, 'SABOTAGGIO: -1 failed nel cron (email NON più tentata per il nostro utente)', { clean: cronClean.failed, sab: cronSab.failed });
    assert(cronDidNotWrite && before3 === 1, 'SABOTAGGIO: il cron non scrive un secondo prompt (la riga-cliente conta come "già inviato")', { before3, after3 });

    const suppressed = shiftedToSkipped && noLongerAttempted;
    const verdict = suppressed
      ? 'N19 CONFERMATA: una POST /api/notifications con type=evening_review_prompt fabbricata da un client sopprime il promemoria serale del cron per quel giorno (l\'utente candidato viene deviato nel ramo dedup e l\'email non viene nemmeno tentata).'
      : `N19 parziale: skipped clean=${cronClean.skipped} sab=${cronSab.skipped}, failed clean=${cronClean.failed} sab=${cronSab.failed}. Meccanica a-codice comunque presente (type non validato + dedup per type).`;
    out.push('\nVERDETTO: ' + verdict);

    saveEvidence('fase2', 'n19-notif-dedup.txt', out.join('\n'));
    console.log('\n' + out.join('\n'));
  } finally {
    await restore();
    await deleteEphemeralUser('collaudo68-n19@probe.local');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
