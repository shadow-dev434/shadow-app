/**
 * Probe e2e — scripts/migrate-on-deploy.ts (verbale 23, raccomandazione 2).
 *
 * Strategia: lo script viene eseguito come SOTTOPROCESSO con env interamente
 * controllata: `--env-file` punta a un file temporaneo vuoto (sostituisce
 * l'auto-load di .env/.env.local di bun) e le variabili sensibili vengono
 * rimosse/sovrascritte esplicitamente. Le URL usate nei test sono fittizie
 * (host `ep-finto-…`, inesistente): prisma fallisce con P1001/DNS senza poter
 * toccare alcun database reale.
 *
 * T3 fa anche da canary di isolamento: se l'env-file vuoto NON sostituisse
 * l'auto-load, lo script vedrebbe la DATABASE_URL di .env.local (solo DEV per
 * convenzione, verbale §racc. 5) e il probe fallirebbe HARD.
 *
 * NON coperto, by design: il success path (exit 0 con migration applicate)
 * richiederebbe un `migrate deploy` contro un DB reale — per CLAUDE.md ogni
 * `prisma migrate` va sotto conferma esplicita di Antonio. La verifica del
 * success path avviene al primo deploy di produzione (log `[migrate-on-deploy]`
 * nel build Vercel).
 *
 * Lancio: bun scripts/e2e/probe-migrate-on-deploy.ts
 * Exit 0 = nessun FAIL hard.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "migrate-on-deploy.ts");

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Env di base per i sottoprocessi: process.env SENZA le variabili sotto test. */
function baseEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.VERCEL_ENV;
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  return env;
}

interface RunResult {
  status: number | null;
  out: string;
}

// File env vuoto: con --env-file bun NON auto-carica .env/.env.local.
const tmpDir = mkdtempSync(join(tmpdir(), "probe-migrate-"));
const emptyEnvFile = join(tmpDir, "vuoto.envfile");
writeFileSync(emptyEnvFile, "# intenzionalmente vuoto: isola il probe da .env.local\n");

function runScript(envOverrides: Record<string, string>): RunResult {
  const env = { ...baseEnv(), ...envOverrides };
  const res = spawnSync(process.execPath, ["--env-file", emptyEnvFile, SCRIPT], {
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: res.status, out: `${res.stdout ?? ""}\n${res.stderr ?? ""}` };
}

const FAKE_POOLED =
  "postgresql://probe:probe@ep-finto-probe-pooler.c-0.eu-central-1.aws.neon.tech:5432/probedb?sslmode=require";
const FAKE_DIRECT_ESPLICITA =
  "postgresql://probe:probe@ep-direct-esplicita.c-0.eu-central-1.aws.neon.tech:5432/probedb?sslmode=require";

try {
  // T1 — locale (VERCEL_ENV assente): no-op, exit 0
  {
    const r = runScript({});
    check("T1 VERCEL_ENV assente → exit 0", r.status === 0, `exit=${r.status}`);
    check("T1 output dichiara il no-op", r.out.includes("nessuna migration"));
    check(
      "T1 prisma NON invocato",
      !r.out.includes("Datasource") && !r.out.includes("migrate deploy fallito"),
    );
  }

  // T2 — preview deploy: no-op, exit 0 (i preview condividono la DATABASE_URL di prod)
  {
    const r = runScript({ VERCEL_ENV: "preview" });
    check("T2 VERCEL_ENV=preview → exit 0", r.status === 0, `exit=${r.status}`);
    check("T2 output dichiara il no-op", r.out.includes("nessuna migration"));
  }

  // T3 — production senza DATABASE_URL: exit 1. Canary di isolamento: se
  // --env-file non sostituisse l'auto-load, lo script vedrebbe .env.local.
  {
    const r = runScript({ VERCEL_ENV: "production" });
    check("T3 production senza DATABASE_URL → exit 1", r.status === 1, `exit=${r.status}`);
    check("T3 messaggio 'DATABASE_URL assente'", r.out.includes("DATABASE_URL assente"));
    check(
      "T3 canary isolamento: .env.local NON caricata dal sottoprocesso",
      !r.out.includes("Datasource"),
    );
  }

  // T4 — derivazione DIRECT_URL: host pooled fittizio → prisma deve tentare
  // l'host DERIVATO (senza -pooler) e fallire (P1001/DNS), build interrotto.
  {
    const r = runScript({ VERCEL_ENV: "production", DATABASE_URL: FAKE_POOLED });
    check("T4 deriva DIRECT_URL quando assente", r.out.includes("derivata da DATABASE_URL"));
    const hostDerivatoOk =
      r.out.includes("ep-finto-probe.c-0") && !r.out.includes("ep-finto-probe-pooler.c-0");
    if (!hostDerivatoOk) {
      console.log(`---- diagnostica T4: output del sottoprocesso ----\n${r.out}\n----`);
    }
    check("T4 prisma usa l'host derivato senza -pooler", hostDerivatoOk);
    check("T4 fallimento prisma ⇒ exit ≠ 0 (build fallirebbe)", r.status !== 0, `exit=${r.status}`);
    check("T4 messaggio di build interrotto", r.out.includes("build interrotto"));
    check("T4 nessuna connection string nei log dello script", !r.out.includes("probe:probe@"));
  }

  // T5 — DIRECT_URL esplicita presente: rispettata, nessuna derivazione.
  {
    const r = runScript({
      VERCEL_ENV: "production",
      DATABASE_URL: FAKE_POOLED,
      DIRECT_URL: FAKE_DIRECT_ESPLICITA,
    });
    check(
      "T5 DIRECT_URL esplicita: nessuna derivazione",
      !r.out.includes("derivata da DATABASE_URL"),
    );
    check("T5 prisma usa la DIRECT_URL esplicita", r.out.includes("ep-direct-esplicita"));
    check("T5 fallimento ⇒ exit ≠ 0", r.status !== 0, `exit=${r.status}`);
  }

  // T6 — DATABASE_URL non interpretabile e DIRECT_URL assente: exit 1 senza
  // nemmeno invocare prisma.
  {
    const r = runScript({ VERCEL_ENV: "production", DATABASE_URL: "non-e-una-url" });
    check("T6 URL non interpretabile → exit 1", r.status === 1, `exit=${r.status}`);
    check("T6 messaggio 'non interpretabile'", r.out.includes("non interpretabile"));
    check("T6 prisma NON invocato", !r.out.includes("Datasource"));
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\nRiepilogo: ${failures} FAIL`);
process.exit(failures > 0 ? 1 : 0);
