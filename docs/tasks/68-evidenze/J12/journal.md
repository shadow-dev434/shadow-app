# J12 — PWA, share target, SW (build di PRODUZIONE) — 2026-07-04

`bun run build` verde + server standalone su :3000, health 200. Utente collaudo68-pwa (login reale 200).

## Esiti
- **Build di produzione PASS**: compila in 33s, 63 pagine statiche generate.
  **`[migrate-on-deploy] VERCEL_ENV=(assente) ≠ "production" → nessuna migration applicata`**:
  in locale la guardia SALTA correttamente la migration (gira solo su Vercel prod). Conferma
  che il fix pipeline (migrate-on-deploy.ts) non tocca il DB dev al build locale.
- **SW servito (200)**: `public/sw.js` v10. Strategie usano `shadow-static-v10` /
  `shadow-dynamic-v10`. L'activate (sw.js:46-52) purga tutte le cache tranne le due v10 →
  **l'aggiornamento dei bundle funziona** a ogni bump.
- **N53 RIDIMENSIONATA (costante morta, non bug)**: `CACHE_NAME='shadow-v2'` (sw.js:18) è
  DEFINITA ma MAI USATA (nessun `caches.open/addAll/delete` la referenzia; le strategie e la
  pulizia usano solo i nomi v10). È dead code cosmetico, NON un fallimento di aggiornamento:
  i bundle si aggiornano davvero via le cache v10 + purge all'activate. → declassare da
  "i client potrebbero non aggiornare" a "rimuovere la costante inutilizzata" (quick-win).
- **Manifest valido** a `/manifest.json` (200; `/manifest.webmanifest` → 404, non usato):
  `share_target: {action:'/?action=share', method:POST, enctype:multipart/form-data,
  params:{title,text,url}}`; `shortcuts: [/?action=inbox, /?action=today]`; start_url `/`.
- **Share target 67A/R18**: il POST `/` è gestito dal **service worker** (sw.js:118): intercetta
  il POST multipart, chiama `POST /api/tasks {status:'inbox'}`, e redirige a
  `/?action=share&saved=1` SOLO se 2xx (esito onesto), altrimenti a
  `/?action=share&text=<testo>` (fallback). Un POST diretto via curl → **404 (atteso)**: curl
  non ha il SW, il server Next non ha un handler POST per la pagina `/`. In un browser reale
  con SW registrato lo share FUNZIONA. La meccanica è già verificata dal probe di regressione
  `task67/probe-a-share` (PASS=21) + il round-trip middleware/sessionStorage (R18).
- **Shortcuts reader**: `/?action=today` → 200, `/?action=inbox` → 200.
- **N11 CONFERMATA**: il testo condiviso è troncato a 500 char in silenzio nel SW
  (`sharedText.slice(0, 500)`, sw.js:150) sia nel path saved sia nel fallback.

## Non testato in web (→ Appendice B on-device)
Registrazione/attivazione SW reale in browser, banner install mobile (N29: solo /tasks),
share da app Android reale, aggiornamento SW su PWA installata. La meccanica è coperta;
l'esperienza on-device resta da verificare su telefono (con l'AVVERTENZA prod: la WebView
nativa punta a shadow-app2.vercel.app).
