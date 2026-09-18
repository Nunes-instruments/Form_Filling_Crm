import { publicSettings } from '@/lib/public-settings';
import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/db';
import { normalizeGeminiModel } from '@/lib/gemini-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function GET() {
  try {
    return NextResponse.json({ settings: publicSettings(await getSettings()) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Settings could not load: ${detail}` }, { status:500 });
  }
}

export async function PUT(request: Request) {
  try {
    const current = await getSettings();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error:'Settings request was empty or invalid.' }, { status:400 });
    const requestedOAuthClientId = String(body.googleOAuthClientId || '').trim();
    const requestedOAuthClientSecret = String(body.googleOAuthClientSecret || '').trim();
    const nextOAuthClientId = requestedOAuthClientId || current.googleOAuthClientId;
    const nextOAuthClientSecret = requestedOAuthClientSecret || current.googleOAuthClientSecret;
    const oauthClientChanged = nextOAuthClientId !== current.googleOAuthClientId || nextOAuthClientSecret !== current.googleOAuthClientSecret;
    const next = {
      ...current,
      ...body,
      branchNames: Array.isArray(body.branchNames) ? body.branchNames.filter(Boolean).map(String) : current.branchNames,
      autoLookupProductDetails: Boolean(body.autoLookupProductDetails),
      autoSendOnSave: true,
      autoSendEmail: true,
      autoSendWhatsApp: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'nunuescbe@gmail.com',
      smtpPassword: '',
      googleOAuthClientId: nextOAuthClientId,
      googleOAuthClientSecret: nextOAuthClientSecret,
      // A refresh token belongs to one OAuth client. When the JSON is changed,
      // force one clean Google sign-in instead of reusing an incompatible token.
      googleOAuthRefreshToken: oauthClientChanged ? '' : current.googleOAuthRefreshToken,
      googleOAuthEmail: oauthClientChanged ? '' : current.googleOAuthEmail,
      formVisionEnabled: body.formVisionEnabled !== false,
      formVisionModel: normalizeGeminiModel(body.formVisionModel || current.formVisionModel),
      geminiApiKey: String(body.geminiApiKey || '').trim() ? String(body.geminiApiKey).trim() : current.geminiApiKey
    };
    return NextResponse.json({ settings: publicSettings(await saveSettings(next)) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Settings could not save: ${detail}` }, { status:500 });
  }
}
