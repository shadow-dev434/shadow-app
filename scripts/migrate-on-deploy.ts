/**
 * migrate-on-deploy — applica le migration Prisma al DB di produzione
 * durante il build Vercel di produzione, e SOLO lì.
 *
 * Rimedio alla raccomandazione 2 di docs/tasks/23-prod-db-incident.md:
 * nessun passo della pipeline applicava le migration, e il deploy di codice
 * nuovo su schema vecchio ha causato due incidenti di drift in produzione
 * (2026-06-10 e la recidiva del 2026-06-12).
 *
 * Comportamento:
 * - `VERCEL_ENV !== "production"` → no-op (exit 0). Vale per build locali,
 *   preview e development. I preview deploy condividono la DATABASE_URL di
 *   produzione: il gate non protegge il database (è lo stesso), garantisce
 *   che a migrare sia solo il codice di `main`, mai un branch non mergiato.
 * - In produzione: la CLI Prisma richiede DIRECT_URL (schema.prisma →
 *   `directUrl`); se assente viene derivata da DATABASE_URL rimuovendo il
 *   suffisso "-pooler" dal primo label dell'host Neon. Aggiungere DIRECT_URL
 *   esplicita alle env Vercel Production (raccomandazione 1 del verbale)
 *   resta preferibile: questa derivazione è la rete di sicurezza.
 * - Se `prisma migrate deploy` fallisce, lo script esce con codice ≠ 0 e il
 *   build (quindi il deploy) fallisce: meglio nessun deploy che codice nuovo
 *   su schema vecchio.
 * - Non logga MAI le connection string (contengono credenziali).
 *
 * Aggancio: script `build` di package.json, prima di `next build`.
 * Probe: scripts/e2e/probe-migrate-on-deploy.ts
 */
import { spawnSync } from "node:child_process";

const TAG = "[migrate-on-deploy]";

/**
 * Deriva la connection string diretta Neon da quella pooled: l'host pooled è
 * `ep-…-pooler.<region>.aws.neon.tech`, quello diretto è identico senza
 * "-pooler". Restituisce null se la stringa non è una URL interpretabile.
 */
function deriveDirectUrl(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function main(): number {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== "production") {
    console.log(
      `${TAG} VERCEL_ENV=${vercelEnv ?? "(assente)"} ≠ "production" → nessuna migration applicata`,
    );
    return 0;
  }

  let directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error(`${TAG} DATABASE_URL assente: impossibile applicare le migration`);
      return 1;
    }
    const derived = deriveDirectUrl(databaseUrl);
    if (derived === null) {
      console.error(
        `${TAG} DIRECT_URL assente e DATABASE_URL non interpretabile come URL: aggiungere DIRECT_URL alle env Vercel (Production)`,
      );
      return 1;
    }
    directUrl = derived;
    console.log(`${TAG} DIRECT_URL assente → derivata da DATABASE_URL (host Neon senza "-pooler")`);
  }

  console.log(`${TAG} VERCEL_ENV=production → applico le migration (prisma migrate deploy)…`);
  // process.execPath = il runtime bun che sta eseguendo questo script: evita
  // dipendenze dal PATH; "x" risolve la CLI prisma locale (dependency del repo).
  // env esplicita: in bun lo spawn senza `env` passa l'ambiente ORIGINALE del
  // processo, non un eventuale process.env mutato — la DIRECT_URL derivata va
  // quindi passata così, mai via mutazione.
  const result = spawnSync(process.execPath, ["x", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DIRECT_URL: directUrl },
  });
  if (result.error) {
    console.error(`${TAG} avvio di prisma fallito: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    console.error(
      `${TAG} prisma migrate deploy fallito (exit ${result.status ?? `segnale ${result.signal}`}) → build interrotto: niente deploy con schema non aggiornato`,
    );
    return result.status ?? 1;
  }
  console.log(`${TAG} migration applicate (o schema già aggiornato)`);
  return 0;
}

process.exit(main());
