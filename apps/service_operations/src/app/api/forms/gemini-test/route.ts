import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { normalizeGeminiModel } from '@/lib/gemini-model';
import { generateContentResilient } from '@/lib/gemini-resilient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const settings = await getSettings();
    const apiKey = String(settings.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return NextResponse.json({ ok:false, error:'Gemini API key is not configured.' }, { status:428 });

    const primaryModel = normalizeGeminiModel(settings.formVisionModel);
    const gemini = await generateContentResilient({
      apiKey,
      primaryModel,
      requestBody:{
        contents:[{ parts:[{ text:'Reply with exactly OK.' }] }],
        generationConfig:{ maxOutputTokens:8 }
      },
      attemptTimeoutMs:10000,
      maxTotalMs:30000
    });

    if(!gemini.ok){
      const auth=[401,403].includes(gemini.status);
      return NextResponse.json({
        ok:false,
        error:String(gemini.raw?.nunesFriendlyError||gemini.lastError||'Gemini test failed.'),
        code:auth?'GEMINI_AUTH_ERROR':gemini.transient?'GEMINI_TEMPORARILY_BUSY':'GEMINI_REQUEST_FAILED',
        primaryModel,
        model:gemini.model,
        attempts:gemini.attempts,
        fallbackUsed:gemini.fallbackUsed
      },{status:auth?502:gemini.transient?503:502});
    }

    return NextResponse.json({
      ok:true,
      provider:'gemini',
      primaryModel,
      model:gemini.model,
      attempts:gemini.attempts,
      fallbackUsed:gemini.fallbackUsed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, error:/aborted|abort|timed out/i.test(message) ? 'Gemini connection test timed out after automatic retry.' : message }, { status:502 });
  }
}
