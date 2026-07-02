/**
 * Task 67 (A/D21) — probe: share target onesto.
 *
 * Parte contract (statica, pattern task65/probe-contracts): sw.js v10 controlla
 * res.ok e redirige con esito esplicito (saved=1 vs text= preservato); ChatView
 * legge l'esito (banner / precompila input / stash post-login); page.tsx stasha
 * il testo sulla landing di login; il middleware preserva i 2 param share.
 *
 * Parte runtime (dev server :3000 + DB royal-feather):
 *  - GET /?action=share&text=x con cookie STALE → redirect a /?auth=login che
 *    PRESERVA action+text (era il punto di perdita: url.search = '').
 *  - GET /?action=share&text=x senza cookie → 200 (landing con query intatta).
 *  - POST /api/tasks senza cookie → 401 (il fallimento che il SW ora rileva).
 *  - POST /api/tasks con cookie valido → 201 (il ramo saved=1 del SW).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task67/probe-a-share.ts
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
  db,
} from './lib';

const sw = readFileSync('public/sw.js', 'utf8');
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as {
  share_target?: { action: string; method?: string };
};
const chatView = readFileSync('src/features/chat/ChatView.tsx', 'utf8');
const homePage = readFileSync('src/app/page.tsx', 'utf8');
const middleware = readFileSync('src/middleware.ts', 'utf8');

async function main() {
  await preflightDb();

  // ── Contract: sw.js v10 ────────────────────────────────────────────────
  assert(sw.includes('shadow-static-v10'), 'sw.js cache bumpata a v10');
  assert(sw.includes('res.ok'), 'sw.js: esito POST /api/tasks controllato (res.ok)');
  assert(sw.includes('/?action=share&saved=1'), 'sw.js: redirect saved=1 solo a successo');
  assert(
    sw.includes('action=share&text=${encodeURIComponent(sharedText.slice(0, 500))}'),
    'sw.js: fallimento → testo preservato nel redirect (cap 500)',
  );
  assert(manifest.share_target?.action === '/?action=share', 'manifest: share_target intatto');

  // ── Contract: ChatView legge l'esito ───────────────────────────────────
  assert(chatView.includes("get('saved')"), 'ChatView: legge ?saved=');
  assert(chatView.includes('share-saved-banner'), 'ChatView: banner conferma presente');
  assert(chatView.includes('shadow-share-pending'), 'ChatView: consuma lo stash post-login');
  assert(
    chatView.includes('setInput(sharedText.slice(0, 500))'),
    'ChatView: testo non salvato precompila input',
  );

  // ── Contract: page.tsx stasha sulla landing ────────────────────────────
  assert(homePage.includes('shadow-share-pending'), 'page.tsx: stash sessionStorage');
  assert(homePage.includes("status !== 'unauthenticated'"), 'page.tsx: stash solo pre-login');

  // ── Contract: middleware preserva i param share ────────────────────────
  assert(middleware.includes("get('action') === 'share'"), 'middleware: riconosce lo share redirect');
  assert(middleware.includes("searchParams.set('text'"), 'middleware: preserva ?text= su stale session');

  // ── Runtime ────────────────────────────────────────────────────────────
  const user = await createEphemeralUser('a-share');
  let createdTaskId: string | null = null;
  try {
    // Cookie stale (presente ma invalido) → redirect login CON i param share.
    const stale = await api('GET', '/?action=share&text=comprare%20latte', {
      cookie: 'next-auth.session-token=garbage-stale-token',
    });
    assert(
      stale.status >= 300 && stale.status < 400,
      'stale session: redirect',
      stale.status,
    );
    const loc = stale.headers.get('location') ?? '';
    assert(loc.includes('auth=login'), 'stale session: verso il login', loc);
    assert(
      loc.includes('action=share') && loc.includes('text=comprare'),
      'stale session: action+text PRESERVATI nel redirect',
      loc,
    );

    // Redirect di uno shortcut non-share resta pulito (nessuna regressione).
    const staleInbox = await api('GET', '/?action=inbox', {
      cookie: 'next-auth.session-token=garbage-stale-token',
    });
    const locInbox = staleInbox.headers.get('location') ?? '';
    assert(
      locInbox.includes('auth=login') && !locInbox.includes('action='),
      'stale session non-share: query ripulita come prima',
      locInbox,
    );

    // Senza cookie: la landing è servita con la query intatta (pagina 200).
    const anon = await api('GET', '/?action=share&text=x', {});
    assert(anon.status === 200, 'no cookie: landing 200 con query intatta', anon.status);

    // Il fallimento che il SW ora rileva: 401 senza sessione.
    const post401 = await api('POST', '/api/tasks', {
      body: { title: 'share senza sessione', status: 'inbox' },
    });
    assert(post401.status === 401, 'POST /api/tasks senza cookie → 401', post401.status);

    // Il ramo saved=1: POST con sessione valida → 201.
    const post201 = await api('POST', '/api/tasks', {
      cookie: user.cookie,
      body: { title: 'task67 probe share — testo condiviso', status: 'inbox' },
    });
    assert(post201.status === 201, 'POST /api/tasks con cookie → 201', post201.status);
    createdTaskId = (post201.json as { task?: { id?: string } })?.task?.id ?? null;
    assert(createdTaskId !== null, 'task creato con id');
  } finally {
    if (createdTaskId) {
      await db.task.deleteMany({ where: { id: createdTaskId } });
    }
    await deleteEphemeralUser(user.email);
  }

  console.log(`\n[probe-a-share] base=${BASE_URL}`);
  finish('probe-a-share');
}

main().catch((err) => {
  console.error('[probe-a-share] errore fatale:', err);
  process.exit(1);
});
