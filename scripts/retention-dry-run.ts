/**
 * RETENTION DRY-RUN — track R6 (c). SOLO SELECT, nessuna mutazione.
 *
 * Per ogni utente calcola l'ultima attivita = max(ChatThread.lastTurnAt), con
 * fallback a User.createdAt per chi non ha mai avuto un thread. Stampa TUTTI gli
 * utenti (per validare il calcolo del gap) e marca quelli oltre la soglia di
 * inattivita (WOULD-DELETE) — SENZA cancellare nulla.
 *
 * Soglia: mesi di inattivita via argv[2] (default 12). Usa 0 per testare la
 * selezione (marca tutti). Non cancella mai: e un dry-run.
 *
 * Lancio (wrapper corretto del progetto; bunx dotenv-cli e rotto):
 *   bun run dotenv -e .env.local -- bun run scripts/retention-dry-run.ts
 *   bun run dotenv -e .env.local -- bun run scripts/retention-dry-run.ts 0   # test: marca tutti
 */

import { db } from '../src/lib/db';

const MONTHS = Number(process.argv[2] ?? 12);

async function main(): Promise<void> {
  if (!Number.isFinite(MONTHS) || MONTHS < 0) {
    console.error(`[FATAL] soglia mesi non valida: ${process.argv[2]}`);
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - MONTHS);

  const users = await db.user.findMany({
    select: { id: true, email: true, createdAt: true },
  });

  const grouped = await db.chatThread.groupBy({
    by: ['userId'],
    _max: { lastTurnAt: true },
  });
  const lastTurnByUser = new Map<string, Date>();
  for (const g of grouped) {
    if (g._max.lastTurnAt) lastTurnByUser.set(g.userId, g._max.lastTurnAt);
  }

  const dayMs = 1000 * 60 * 60 * 24;
  const rows = users.map((u) => {
    const lastTurn = lastTurnByUser.get(u.id);
    const lastActivity = lastTurn ?? u.createdAt;
    const source = lastTurn ? 'chat' : 'created';
    const daysInactive = Math.floor((now.getTime() - lastActivity.getTime()) / dayMs);
    const wouldDelete = lastActivity < cutoff;
    return { email: u.email, lastActivity, source, daysInactive, wouldDelete };
  });

  rows.sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime());

  console.log('=== RETENTION DRY-RUN (SOLO SELECT, nessuna cancellazione) ===');
  console.log(`soglia: ${MONTHS} mesi | cutoff: ${cutoff.toISOString()} | now: ${now.toISOString()}`);
  console.log(`utenti totali: ${rows.length}\n`);
  for (const r of rows) {
    const mark = r.wouldDelete ? 'WOULD-DELETE' : 'keep        ';
    console.log(`[${mark}] ${r.email} | ultima attivita: ${r.lastActivity.toISOString()} (${r.source}) | inattivo da ${r.daysInactive}g`);
  }
  const toDelete = rows.filter((r) => r.wouldDelete);
  console.log(`\n=== RIEPILOGO ===`);
  console.log(`candidati (>${MONTHS} mesi inattivi): ${toDelete.length} / ${rows.length}`);
  if (toDelete.length > 0) console.log(`email candidate: ${toDelete.map((r) => r.email).join(', ')}`);
  console.log('NOTA: dry-run, nessun dato cancellato.');
}

main()
  .catch((err) => {
    console.error('[FATAL] retention dry-run failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
