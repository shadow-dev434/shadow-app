/**
 * Task 72 (Slice E) — probe contract: voce nativa (RecognizerIntent).
 *
 * Il brief dava la voce per "già esistente": vero solo su web/TWA (Web
 * Speech). L'Android WebView non la implementa → sul guscio nativo la
 * quick-add vocale passa dal dialog di sistema. Contratti:
 *  - plugin: startSpeech via RecognizerIntent it-IT, annullo distinto
 *    dall'indisponibilità del riconoscitore;
 *  - manifest: NESSUN permesso RECORD_AUDIO (il dialog di sistema fa da sé);
 *  - useVoiceCapture: ramo isNative() → plugin, Web Speech altrimenti; il
 *    transcript rientra nello stesso stato (stessa card di conferma).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task72/probe-e-voice.ts
 */
import { readFileSync } from 'node:fs';
import { assert, finish } from '../collaudo-68/lib';

const plugin = readFileSync(
  'android/app/src/main/java/com/shadow/adhd/executor/capture/ShadowCapturePlugin.java',
  'utf8',
);
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const tasksPage = readFileSync('src/app/tasks/page.tsx', 'utf8');
const captureIface = readFileSync('src/lib/native/capture.ts', 'utf8');

assert(plugin.includes('RecognizerIntent.ACTION_RECOGNIZE_SPEECH'), 'plugin: dialog di sistema');
assert(plugin.includes('"it-IT"'), 'plugin: lingua it-IT');
assert(plugin.includes('speech_unavailable'), 'plugin: indisponibilità distinta');
assert(plugin.includes('EXTRA_RESULTS'), 'plugin: trascritto dal primo match');
assert(!manifest.includes('RECORD_AUDIO'), 'manifest: NESSUN permesso RECORD_AUDIO');
assert(captureIface.includes('startSpeech(): Promise<{ text: string }>'), 'iface: startSpeech');
assert(tasksPage.includes('ShadowCapture.startSpeech()'), 'useVoiceCapture: ramo nativo');
assert(tasksPage.includes('setTranscript(text)'), 'useVoiceCapture: transcript riusa lo stato');
assert(
  tasksPage.includes("'webkitSpeechRecognition' in window"),
  'useVoiceCapture: Web Speech intatto su web',
);

finish('probe-e-voice');
