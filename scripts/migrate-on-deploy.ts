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
 * - Task 75 follow-up (incidente 2026-07-08): P1001 "Can't reach database
 *   server" durante un deploy notturno = compute Neon in autosuspend che non
 *   si sveglia entro il timeout di connessione → il build moriva per una
 *   causa transitoria. Solo per quel caso si ritenta (max 3 tentativi,
 *   pausa 10s); ogni altro errore di migration resta fatale al primo colpo.
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
  const MAX_ATTEMPTS = 3;
  const RETRY_PAUSE_MS = 10_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // process.execPath = il runtime bun che sta eseguendo questo script: evita
    // dipendenze dal PATH; "x" risolve la CLI prisma locale (dependency del repo).
    // env esplicita: in bun lo spawn senza `env` passa l'ambiente ORIGINALE del
    // processo, non un eventuale process.env mutato — la DIRECT_URL derivata va
    // quindi passata così, mai via mutazione. stdout/stderr catturati (e
    // rigirati sul log) per riconoscere il P1001 transitorio.
    const result = spawnSync(process.execPath, ["x", "prisma", "migrate", "deploy"], {
      stdio: ["inherit", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, DIRECT_URL: directUrl },
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      console.error(`${TAG} avvio di prisma fallito: ${result.error.message}`);
      return 1;
    }
    if (result.status === 0) {
      console.log(`${TAG} migration applicate (o schema già aggiornato)`);
      return 0;
    }
    const transient = /P1001|Can't reach database server/i.test(
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
    if (transient && attempt < MAX_ATTEMPTS) {
      console.warn(
        `${TAG} DB non raggiungibile (P1001, tentativo ${attempt}/${MAX_ATTEMPTS}) — probabile cold start Neon: riprovo tra ${RETRY_PAUSE_MS / 1000}s…`,
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_PAUSE_MS);
      continue;
    }
    console.error(
      `${TAG} prisma migrate deploy fallito (exit ${result.status ?? `segnale ${result.signal}`}) → build interrotto: niente deploy con schema non aggiornato`,
    );
    return result.status ?? 1;
  }
  return 1;
}

process.exit(main());
