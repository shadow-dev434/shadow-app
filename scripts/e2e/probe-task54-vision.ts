/**
 * Probe integrazione Task 54 (vision) — verifica il FORMATO A FILO: il content
 * block immagine costruito da noi viene accettato dall'API Anthropic reale.
 * NESSUNA scrittura DB: chiama callLLM direttamente con un PNG 1x1 valido.
 *
 * Successo = nessun throw (4xx malformed) + testo di risposta non vuoto.
 *
 * Uso (dal worktree, .env.local auto-caricato da bun, usa ANTHROPIC_API_KEY):
 *   bun run scripts/e2e/probe-task54-vision.ts
 */
import sharp from 'sharp';
import { callLLM } from '../../src/lib/llm/client';

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY assente — salto la probe vision.');
  process.exit(0);
}

// Immagine reale 96x96 (non degenerata): un riquadro con due bande di colore,
// processabile dall'API (il PNG 1x1 viene rifiutato come "too small").
const top = await sharp({
  create: { width: 96, height: 48, channels: 3, background: { r: 220, g: 60, b: 60 } },
}).png().toBuffer();
const bottom = await sharp({
  create: { width: 96, height: 48, channels: 3, background: { r: 60, g: 90, b: 220 } },
}).png().toBuffer();
const buf = await sharp({
  create: { width: 96, height: 96, channels: 3, background: { r: 255, g: 255, b: 255 } },
})
  .composite([
    { input: top, top: 0, left: 0 },
    { input: bottom, top: 48, left: 0 },
  ])
  .png()
  .toBuffer();
const PNG_DATA = buf.toString('base64');

try {
  const res = await callLLM({
    systemPrompt: 'Descrivi in pochissime parole cosa vedi nell\'immagine.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_DATA } },
          { type: 'text', text: 'Cosa vedi?' },
        ],
      },
    ],
    tier: 'fast',
    maxTokens: 80,
  });

  const ok = typeof res.text === 'string' && res.text.length > 0;
  console.log('\n=== PROBE TASK 54 (vision wire format) ===');
  console.log(`model=${res.model} stopReason=${res.stopReason} textLen=${res.text.length} cost=$${res.costUsd.toFixed(6)}`);
  console.log(`text: ${res.text.slice(0, 160)}`);
  console.log(`\nRESULT: ${ok ? 'API HA ACCETTATO IL BLOCCO IMMAGINE ✅' : 'NESSUN TESTO ❌'}`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log('\n=== PROBE TASK 54 (vision wire format) ===');
  console.log('RESULT: API HA RIGETTATO IL BLOCCO ❌');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
