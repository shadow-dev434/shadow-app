/**
 * Task 72 (B2) — probe: contratto di ingestione delle catture esterne.
 *
 * Parte contract (statica): sw.js v12 dichiara source:'share' e separa
 * titolo/sourceRef; manifest share_target intatto; route con whitelist source
 * e dedup; schema con Task.sourceRef.
 *
 * Parte runtime (dev :3000 + DB royal-feather):
 *  - POST /api/tasks senza cookie → 401.
 *  - share: 201 con source/sourceRef persistiti e deadline parsata dal testo
 *    ("entro il 15/08/2026"); re-POST stesso sourceRef → 200 alreadyExists;
 *    stesso titolo (sourceRef diverso) → 200 alreadyExists.
 *  - share senza data nel testo → deadline null (mai inventata).
 *  - source fuori whitelist (recurring/gmail/x) → 400 (le stelle del Cielo
 *    contano i completamenti 'recurring': mai accettarlo dal client).
 *  - ocr: deadline passa così com'è (la sceglie l'utente nella sheet);
 *    dedup SOLO per sourceRef — stesso titolo con testo OCR diverso NON
 *    deduplica (due bollette con la stessa intestazione sono due task).
 *  - sourceRef: cap 2000; ignorato (='') senza source di cattura.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task72/probe-b-ingestion.ts
 */
import { readFileSync } from 'node:fs';
import {
  BASE_URL,
  api,
  assert,
  finish,
  preflightDb,
  createEphemeralUser,
  deleteEphemeralUser,
} from '../collaudo-68/lib';

const sw = readFileSync('public/sw.js', 'utf8');
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as {
  share_target?: { action: string };
};
const route = readFileSync('src/app/api/tasks/route.ts', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

interface TaskJson {
  task?: {
    id: string;
    title: string;
    source: string;
    sourceRef: string;
    deadline: string | null;
  };
  alreadyExists?: boolean;
  error?: string;
}

async function main() {
  await preflightDb();

  // ── Contract ────────────────────────────────────────────────────────────
  const swVersion = Number((sw.match(/shadow-static-v(\d+)/) ?? [])[1] ?? 0);
  assert(swVersion >= 12, 'sw.js: cache bumpata (>= v12)', swVersion);
  assert(sw.includes("source: 'share'"), 'sw.js: POST dichiara source share');
  assert(sw.includes('sourceRef,'), 'sw.js: POST porta sourceRef');
  assert(sw.includes('(fullText || sharedUrl).slice(0, 500)'), 'sw.js: titolo cap 500 senza URL');
  assert(manifest.share_target?.action === '/?action=share', 'manifest: share_target intatto');
  assert(route.includes("'source non valido'"), 'route: whitelist source presente');
  assert(route.includes('terminalTaskStatuses()'), 'route: dedup tra non-terminali');
  assert(route.includes('alreadyExists: true'), 'route: risposta dedup dichiarata');
  assert(/sourceRef\s+String\s+@default\(""\)\s+@db\.Text/.test(schema), 'schema: Task.sourceRef presente');

  // ── Runtime ─────────────────────────────────────────────────────────────
  const user = await createEphemeralUser('t72-ing');
  try {
    // 401 senza sessione (il fallimento che il SW consegna al client).
    const anon = await api('POST', '/api/tasks', {
      body: { title: 'share senza sessione', status: 'inbox', source: 'share' },
    });
    assert(anon.status === 401, 'POST senza cookie → 401', anon.status);

    // share con data nel testo → deadline parsata (cheap, zero LLM).
    const shareUrl = 'https://esempio.it/bolletta-luglio';
    const share1 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'Bolletta Enel — pagare entro il 15/08/2026',
        status: 'inbox',
        source: 'share',
        sourceRef: shareUrl,
      },
    });
    assert(share1.status === 201, 'share: creato 201', share1.status);
    const t1 = (share1.json as TaskJson).task;
    assert(t1?.source === 'share', 'share: source persistito', t1?.source);
    assert(t1?.sourceRef === shareUrl, 'share: sourceRef = URL', t1?.sourceRef);
    assert(
      (t1?.deadline ?? '').startsWith('2026-08-15'),
      'share: deadline parsata dal testo',
      t1?.deadline,
    );
    assert(!t1?.title.includes('http'), 'share: URL fuori dal titolo', t1?.title);

    // Dedup per sourceRef: stesso URL ricondiviso → nessun duplicato.
    const share2 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'titolo diverso, stesso link',
        status: 'inbox',
        source: 'share',
        sourceRef: shareUrl,
      },
    });
    assert(share2.status === 200, 'share dedup sourceRef: 200', share2.status);
    assert((share2.json as TaskJson).alreadyExists === true, 'share dedup sourceRef: alreadyExists');
    assert((share2.json as TaskJson).task?.id === t1?.id, 'share dedup sourceRef: stesso task');

    // Dedup per titolo (case-insensitive) anche con sourceRef diverso.
    const share3 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'BOLLETTA ENEL — PAGARE ENTRO IL 15/08/2026',
        status: 'inbox',
        source: 'share',
        sourceRef: 'https://altro.it/x',
      },
    });
    assert(share3.status === 200, 'share dedup titolo: 200', share3.status);
    assert((share3.json as TaskJson).alreadyExists === true, 'share dedup titolo: alreadyExists');

    // share senza data → deadline null (mai inventata).
    const share4 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'guarda questo articolo interessante',
        status: 'inbox',
        source: 'share',
        sourceRef: 'https://esempio.it/articolo',
      },
    });
    assert(share4.status === 201, 'share senza data: 201', share4.status);
    assert((share4.json as TaskJson).task?.deadline === null, 'share senza data: deadline null');

    // Whitelist source: mai accettare valori riservati o ignoti dal client.
    for (const source of ['recurring', 'gmail', 'review_carryover', 'x']) {
      const bad = await api('POST', '/api/tasks', {
        cookie: user.cookie,
        body: { title: `probe source ${source}`, status: 'inbox', source },
      });
      assert(bad.status === 400, `source=${source} → 400`, bad.status);
    }

    // ocr: deadline passa com'e' (scelta dall'utente), dedup solo su sourceRef.
    const ocrText = 'AVVISO DI PAGAMENTO TARI 2026 — importo 154,30 — scadenza 30/09/2026 — contribuente ROSSI';
    const ocr1 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'AVVISO DI PAGAMENTO',
        status: 'inbox',
        source: 'ocr',
        sourceRef: ocrText,
        deadline: '2026-09-30',
      },
    });
    assert(ocr1.status === 201, 'ocr: creato 201', ocr1.status);
    assert((ocr1.json as TaskJson).task?.source === 'ocr', 'ocr: source persistito');
    assert(
      ((ocr1.json as TaskJson).task?.deadline ?? '').startsWith('2026-09-30'),
      'ocr: deadline scelta rispettata',
    );

    const ocr2 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: { title: 'AVVISO DI PAGAMENTO bis', status: 'inbox', source: 'ocr', sourceRef: ocrText },
    });
    assert(ocr2.status === 200, 'ocr dedup sourceRef: 200', ocr2.status);
    assert((ocr2.json as TaskJson).alreadyExists === true, 'ocr dedup sourceRef: alreadyExists');

    // Stesso titolo generico ma testo OCR diverso: DUE task (niente dedup titolo).
    const ocr3 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: {
        title: 'AVVISO DI PAGAMENTO',
        status: 'inbox',
        source: 'ocr',
        sourceRef: 'AVVISO DI PAGAMENTO TARI 2026 — importo 89,00 — scadenza 31/10/2026 — contribuente VERDI',
      },
    });
    assert(ocr3.status === 201, 'ocr titolo uguale, testo diverso: nuovo task 201', ocr3.status);

    // sourceRef: cap 2000.
    const long = 'x'.repeat(3000);
    const capped = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: { title: 'ocr lungo', status: 'inbox', source: 'ocr', sourceRef: long },
    });
    assert(capped.status === 201, 'ocr sourceRef lungo: 201', capped.status);
    assert(
      (capped.json as TaskJson).task?.sourceRef.length === 2000,
      'sourceRef cap a 2000',
      (capped.json as TaskJson).task?.sourceRef.length,
    );

    // sourceRef senza source di cattura: ignorato, source resta manual.
    const manual = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: { title: 'quick add normale', status: 'inbox', sourceRef: 'https://ignorami.it' },
    });
    assert(manual.status === 201, 'manual: 201', manual.status);
    assert((manual.json as TaskJson).task?.source === 'manual', 'manual: source default');
    assert((manual.json as TaskJson).task?.sourceRef === '', 'manual: sourceRef ignorato');
  } finally {
    await deleteEphemeralUser(user.email);
  }

  console.log(`\n[probe-b-ingestion] base=${BASE_URL}`);
  finish('probe-b-ingestion');
}

main().catch((err) => {
  console.error('[probe-b-ingestion] errore fatale:', err);
  process.exit(1);
});
