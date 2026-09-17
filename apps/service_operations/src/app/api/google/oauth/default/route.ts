import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/db';
import { publicSettings } from '@/lib/public-settings';
import { getDefaultGoogleOAuthClient } from '@/lib/default-google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const cfg = await getDefaultGoogleOAuthClient();
    if (!cfg?.client_id || !cfg?.client_secret) {
      return NextResponse.json({
        error:'The local default Google Desktop OAuth JSON is missing. On the main server run 0_FIRST_TIME_VSCODE_MAIN_SERVER.bat, or use Add / Change Other Google JSON.'
      }, { status:500 });
    }

    const current = await getSettings();
    const changed = current.googleOAuthClientId !== String(cfg.client_id) || current.googleOAuthClientSecret !== String(cfg.client_secret);
    const saved = await saveSettings({
      ...current,
      googleOAuthClientId: String(cfg.client_id),
      googleOAuthClientSecret: String(cfg.client_secret),
      googleOAuthRefreshToken: changed ? '' : current.googleOAuthRefreshToken,
      googleOAuthEmail: changed ? '' : current.googleOAuthEmail,
      smtpPassword: ''
    });

    return NextResponse.json({
      ok:true,
      changed,
      projectId:String(cfg.project_id || ''),
      settings:publicSettings(saved)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error:`Default Google OAuth JSON could not be loaded: ${detail}` }, { status:500 });
  }
}
