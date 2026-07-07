/**
 * Task 72 (Slice D) — probe contract: foto → OCR on-device.
 *
 * Statico (il runtime OCR si verifica sull'APK con una bolletta vera, passi
 * nel report). Contratti chiave:
 *  - privacy: NESSUN permesso CAMERA nel manifest (si delega all'app camera);
 *    l'immagine viene cancellata appena estratto il testo, mai caricata;
 *  - ML Kit bundled nel gradle; metodi capturePhoto/pickImage/recognizeText;
 *  - manifest: share di immagini (image/*) instradato all'OCR;
 *  - sheet: POST source 'ocr' con sourceRef = testo (cap 2000), date candidate
 *    da date-extract (zero LLM), preselezione = primo confident;
 *  - mount globale in NativeBootstrap + bottone camera nell'inbox (solo nativo).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task72/probe-d-ocr.ts
 */
import { readFileSync } from 'node:fs';
import { assert, finish } from '../collaudo-68/lib';

const gradle = readFileSync('android/app/build.gradle', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const plugin = readFileSync(
  'android/app/src/main/java/com/shadow/adhd/executor/capture/ShadowCapturePlugin.java',
  'utf8',
);
const sheet = readFileSync('src/features/capture/OcrCaptureSheet.tsx', 'utf8');
const bootstrap = readFileSync('src/components/native/native-bootstrap.tsx', 'utf8');
const nativeShare = readFileSync('src/lib/capture/native-share.ts', 'utf8');
const tasksPage = readFileSync('src/app/tasks/page.tsx', 'utf8');

// ── Privacy by design ─────────────────────────────────────────────────────
assert(!manifest.includes('android.permission.CAMERA'), 'manifest: NESSUN permesso CAMERA');
assert(plugin.includes('MediaStore.ACTION_IMAGE_CAPTURE'), 'plugin: camera via intent di sistema');
assert(plugin.includes('deleteQuietly(file)'), 'plugin: immagine cancellata dopo OCR');
assert(
  plugin.includes('getCacheDir().getAbsolutePath()'),
  'plugin: delete confinato alla cache dell\'app',
);

// ── Nativo ────────────────────────────────────────────────────────────────
assert(gradle.includes('com.google.mlkit:text-recognition'), 'gradle: ML Kit bundled');
assert(manifest.includes('android:mimeType="image/*"'), 'manifest: share immagini attivo');
assert(plugin.includes('public void capturePhoto'), 'plugin: capturePhoto');
assert(plugin.includes('public void pickImage'), 'plugin: pickImage (Photo Picker)');
assert(plugin.includes('public void recognizeText'), 'plugin: recognizeText (ML Kit)');
assert(plugin.includes('ACTION_PICK_IMAGES'), 'plugin: Photo Picker su API 33+');
assert(plugin.includes('capture_cancelled'), 'plugin: annullo utente distinto dagli errori');
assert(plugin.includes('IntentCompat.getParcelableExtra'), 'plugin: EXTRA_STREAM compat');

// ── Web ───────────────────────────────────────────────────────────────────
assert(sheet.includes("source: 'ocr'"), 'sheet: POST dichiara source ocr');
assert(sheet.includes('sourceRef: text.slice(0, 2000)'), 'sheet: sourceRef = testo OCR cap 2000');
assert(sheet.includes('extractDateCandidates'), 'sheet: date candidate euristiche (zero LLM)');
assert(sheet.includes('c.confident)?.date ?? null'), 'sheet: preselezione = primo confident');
assert(sheet.includes("'shadow:ocr-open'"), 'sheet: apertura via evento globale');
assert(sheet.includes('alreadyExists'), 'sheet: dedup dichiarato all\'utente');
assert(bootstrap.includes('<OcrCaptureSheet />'), 'bootstrap: sheet montata globalmente');
assert(nativeShare.includes("mode: 'image', path: share.imagePath"), 'share immagine → OCR sheet');
assert(
  tasksPage.includes("detail: { mode: 'camera' }") && tasksPage.includes('isNative() && ('),
  'inbox: bottone camera solo nativo',
);

finish('probe-d-ocr');
