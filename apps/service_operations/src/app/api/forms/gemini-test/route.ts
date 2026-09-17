import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const settings = await getSettings();
    const apiKey = String(settings.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return NextResponse.json({ ok:false, error:'Gemini API key is not configured.' }, { status:428 });
    const model = String(settings.formVisionModel || 'gemini-2.5-flash').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-goog-api-key':apiKey },
        body:JSON.stringify({ contents:[{ parts:[{ text:'Reply with exactly OK.' }] }], generationConfig:{ temperature:0, maxOutputTokens:8 } }),
        signal:controller.signal
      });
    } finally { clearTimeout(timer); }
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ ok:false, error:raw?.error?.message || `Gemini request failed with HTTP ${response.status}.` }, { status:502 });
    return NextResponse.json({ ok:true, provider:'gemini', model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, error:/aborted|abort/i.test(message) ? 'Gemini connection test timed out.' : message }, { status:502 });
  }
}
