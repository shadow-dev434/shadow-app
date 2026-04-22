/**
 * Manual test of the LLM client wrapper.
 * Run with: bun run scripts/test-llm-client.ts
 */

import { callLLM, completeText } from '../src/lib/llm/client';

async function main() {
  console.log('═══ Test 1: simple text completion (fast tier) ═══');
  const text = await completeText(
    'Sei Shadow, un assistente per persone con ADHD. Rispondi in italiano in max 1 frase.',
    'Ciao, sto per iniziare una sessione focus. Dimmi qualcosa di concreto.',
    { tier: 'fast' },
  );
  console.log('Response:', text);
  console.log();

  console.log('═══ Test 2: full call with metadata (smart tier) ═══');
  const response = await callLLM({
    tier: 'smart',
    systemPrompt: 'Sei Shadow. Rispondi in italiano in max 2 frasi. Caldo ma concreto.',
    messages: [
      { role: 'user', content: 'Mi sento bloccato, non so da dove iniziare con la presentazione.' },
    ],
    maxTokens: 150,
  });
  console.log('Text:', response.text);
  console.log('Model:', response.model);
  console.log('Tokens:', response.tokensIn, 'in /', response.tokensOut, 'out');
  console.log('Cost: $', response.costUsd.toFixed(6));
  console.log('Latency:', response.latencyMs, 'ms');
  console.log();

  console.log('═══ Test 3: tool calling ═══');
  const toolResponse = await callLLM({
    tier: 'fast',
    systemPrompt: 'Sei Shadow. Se l utente crea un task, usa il tool create_task.',
    messages: [
      { role: 'user', content: 'Aggiungi alla lista: chiamare il dentista domani mattina, e urgente.' },
    ],
    tools: [
      {
        name: 'create_task',
        description: 'Crea un nuovo task per l utente',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titolo del task, conciso' },
            urgency: { type: 'number', description: 'Urgenza 1-5 (5 = massima)' },
            dueDate: { type: 'string', description: 'Data di scadenza ISO YYYY-MM-DD, se specificata' },
          },
          required: ['title'],
        },
      },
    ],
  });
  console.log('Text:', toolResponse.text || '(no text)');
  console.log('Tool calls:', JSON.stringify(toolResponse.toolCalls, null, 2));
  console.log('Stop reason:', toolResponse.stopReason);
  console.log('Cost: $', toolResponse.costUsd.toFixed(6));
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
