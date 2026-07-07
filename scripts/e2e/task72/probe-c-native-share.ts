/**
 * Task 72 (Slice C) — probe contract: share nativo Android (ACTION_SEND).
 *
 * Statico (il runtime nativo si verifica sull'APK, passi nel report):
 *  - manifest Android: intent-filter ACTION_SEND text/plain su MainActivity;
 *  - MainActivity registra ShadowCapturePlugin;
 *  - plugin: pending consume-once + evento retained + consumo dell'intent
 *    (singleTask non deve riprocessare lo share a rotazione);
 *  - bootstrap web: pending a freddo + listener a caldo;
 *  - handler web: stesso contratto del SW v12 (source 'share', esito
 *    /?action=share&saved=1, fallback ?text= con troncatura dichiarata).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task72/probe-c-native-share.ts
 */
import { readFileSync } from 'node:fs';
import { assert, finish } from '../collaudo-68/lib';

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const mainActivity = readFileSync(
  'android/app/src/main/java/com/shadow/adhd/executor/MainActivity.java',
  'utf8',
);
const plugin = readFileSync(
  'android/app/src/main/java/com/shadow/adhd/executor/capture/ShadowCapturePlugin.java',
  'utf8',
);
const bootstrap = readFileSync('src/components/native/native-bootstrap.tsx', 'utf8');
const nativeShare = readFileSync('src/lib/capture/native-share.ts', 'utf8');
const captureIface = readFileSync('src/lib/native/capture.ts', 'utf8');

// ── Manifest ──────────────────────────────────────────────────────────────
assert(manifest.includes('android.intent.action.SEND'), 'manifest: ACTION_SEND presente');
assert(manifest.includes('android:mimeType="text/plain"'), 'manifest: mimeType text/plain');
assert(
  manifest.indexOf('android.intent.action.SEND') < manifest.indexOf('</activity>'),
  'manifest: intent-filter dentro MainActivity',
);

// ── Nativo ────────────────────────────────────────────────────────────────
assert(
  mainActivity.includes('registerPlugin(ShadowCapturePlugin.class)'),
  'MainActivity: ShadowCapturePlugin registrato',
);
assert(plugin.includes('handleOnNewIntent'), 'plugin: gestione share a caldo (singleTask)');
assert(plugin.includes('getActivity() != null ? getActivity().getIntent()'), 'plugin: gestione cold start');
assert(plugin.includes('notifyListeners("shareReceived", share, true)'), 'plugin: evento retained');
assert(plugin.includes('intent.setAction(Intent.ACTION_MAIN)'), 'plugin: intent consumato (no re-process)');
assert(plugin.includes('pendingShare = null'), 'plugin: pending consume-once');

// ── Web ───────────────────────────────────────────────────────────────────
assert(bootstrap.includes('getPendingShare()'), 'bootstrap: pending a freddo');
assert(bootstrap.includes("addListener('shareReceived'"), 'bootstrap: listener a caldo');
assert(captureIface.includes("registerPlugin<ShadowCapturePlugin>('ShadowCapture')"), 'iface: plugin registrato');
assert(nativeShare.includes("source: 'share'"), 'handler: POST dichiara source share');
assert(nativeShare.includes("'/?action=share&saved=1'"), 'handler: esito successo = contratto SW');
assert(nativeShare.includes('action=share&text='), 'handler: fallback ?text= (mai perso in silenzio)');
assert(nativeShare.includes("'&truncated=1'"), 'handler: troncatura dichiarata');
assert(nativeShare.includes('processedShareIds'), 'handler: dedupe pending/evento');

finish('probe-c-native-share');
