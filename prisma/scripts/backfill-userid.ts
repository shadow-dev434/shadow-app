/**
 * Backfill userId — Task 1 Data Isolation
 *
 * Esegui PRIMA di `bunx prisma db push`.
 *
 * Cosa fa:
 * 1. Upsert di un utente placeholder `orphan-data@shadow.local`
 * 2. ALTER TABLE per aggiungere la colonna `userId` (nullable) a DailyPlan e Review
 *    (queste tabelle non avevano userId affatto)
 * 3. UPDATE di ogni record con userId NULL → placeholder
 * 4. Conteggio finale di orfani residui (atteso: 0 per ogni tabella)
 *
 * Usa raw SQL per essere indipendente dalla versione del Prisma client generato.
 * L'unica operazione che passa dal client è l'upsert del placeholder User (serve il
 * default cuid() generato lato applicazione).
 *
 * Dopo che questo script chiude con "0 orfani" per tutte le tabelle, l'utente
 * lancia `bunx prisma db push` per applicare i constraint NOT NULL + onDelete
 * Cascade + @@unique([userId, date]) definiti nello schema.prisma aggiornato.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const PLACEHOLDER_EMAIL = 'orphan-data@shadow.local';
const PLACEHOLDER_NAME = 'Orphan data (pre-isolation)';

const TABLES_WITH_USERID = ['Task', 'UserPattern', 'Settings', 'DailyPlan', 'Review'];

async function main() {
  console.log('─── Backfill userId — Task 1 Data Isolation ───\n');

  // ── 1. Placeholder user ────────────────────────────────────────────────
  const placeholder = await db.user.upsert({
    where: { email: PLACEHOLDER_EMAIL },
    update: {},
    create: { email: PLACEHOLDER_EMAIL, name: PLACEHOLDER_NAME },
  });
  console.log(`Placeholder user: ${placeholder.id} (${PLACEHOLDER_EMAIL})\n`);

  // ── 2. Aggiungi colonna userId a DailyPlan e Review se manca ───────────
  console.log('Adding userId column to DailyPlan/Review if missing...');
  await db.$executeRawUnsafe(`ALTER TABLE "DailyPlan" ADD COLUMN IF NOT EXISTS "userId" TEXT`);
  await db.$executeRawUnsafe(`ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "userId" TEXT`);
  console.log('  done.\n');

  // ── 3. Backfill orfani ─────────────────────────────────────────────────
  console.log('Backfilling orphans per table:');
  for (const table of TABLES_WITH_USERID) {
    const before = await countOrphans(table);
    if (before === 0) {
      console.log(`  ${table}: 0 orphan(s) — skip`);
      continue;
    }
    const updated = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "userId" = $1 WHERE "userId" IS NULL`,
      placeholder.id
    );
    console.log(`  ${table}: ${before} orphan(s) — updated ${updated}`);
  }

  // ── 4. Verifica finale ─────────────────────────────────────────────────
  console.log('\nFinal verification:');
  let anyRemaining = false;
  for (const table of TABLES_WITH_USERID) {
    const count = await countOrphans(table);
    const status = count === 0 ? 'OK' : 'FAIL';
    console.log(`  ${table}: ${count} orphan(s) [${status}]`);
    if (count > 0) anyRemaining = true;
  }

  console.log('');
  if (anyRemaining) {
    console.log('✗ Backfill incomplete — NON eseguire `prisma db push` finché non risolto.');
    process.exit(1);
  }
  console.log('✓ Backfill completo. Ora esegui: bunx prisma db push');
}

async function countOrphans(table: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE "userId" IS NULL`
  );
  return Number(rows[0]?.count ?? 0);
}

main()
  .catch((e) => {
    console.error('\nBackfill failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
