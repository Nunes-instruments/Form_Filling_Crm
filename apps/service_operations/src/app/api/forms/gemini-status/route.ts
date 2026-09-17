import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  const configured = Boolean(settings.geminiApiKey || process.env.GEMINI_API_KEY);
  return NextResponse.json({ provider:'gemini', enabled:settings.formVisionEnabled, configured, model:settings.formVisionModel || 'gemini-2.5-flash' }, { headers:{'cache-control':'no-store'} });
}
