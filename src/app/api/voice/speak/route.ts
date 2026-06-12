import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { getTtsProvider } from '@/lib/voice/provider';
import { recordAiUsage, getDailyCalls } from '@/lib/llm/usage';

export const maxDuration = 30;

// Cap giornaliero anti-abuso (kill-switch senza deploy: settare a 0). Il
// flusso normale è già limitato dai check-in, ma la route è chiamabile
// direttamente e ogni chiamata costa caratteri ElevenLabs.
const DAILY_TTS_CAP = Number(process.env.VOICE_TTS_DAILY_CAP ?? '300');
// Stima flash v2.5 ≈ $0.00003/char: telemetria, non fatturazione.
const EST_COST_PER_CHAR = 0.00003;

// POST /api/voice/speak {text} → audio/mpeg (Task 27 v1.1, solo TTS).
// 501 = nessun provider server configurato: il client degrada a
// speechSynthesis senza errori visibili.
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'text è obbligatorio' }, { status: 400 });
    }

    const provider = getTtsProvider();
    if (!provider) {
      return NextResponse.json({ error: 'TTS server non configurato' }, { status: 501 });
    }

    if (DAILY_TTS_CAP <= 0 || (await getDailyCalls(userId, 'voice_tts')) >= DAILY_TTS_CAP) {
      return NextResponse.json({ error: 'Limite giornaliero voce raggiunto' }, { status: 429 });
    }

    const out = await provider.synthesize(text);
    // Telemetria/cap in AiUsage: tokensOut = caratteri sintetizzati.
    void recordAiUsage(userId, 'voice_tts', {
      model: `${provider.name}/flash-v2.5`,
      tokensIn: 0,
      tokensOut: out.chars,
      costUsd: out.chars * EST_COST_PER_CHAR,
    });

    return new NextResponse(out.stream, {
      headers: {
        'Content-Type': out.mimeType,
        'X-Voice-Provider': provider.name,
        'X-Voice-Chars': String(out.chars),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('POST /api/voice/speak error:', error);
    return NextResponse.json({ error: 'Sintesi vocale non riuscita' }, { status: 502 });
  }
}
