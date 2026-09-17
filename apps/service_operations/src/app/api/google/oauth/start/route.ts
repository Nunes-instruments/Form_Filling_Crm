import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { createGoogleOAuthUrl } from '@/lib/google-gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function openOnMainServer(url: string) {
  if (process.platform !== 'win32') return false;
  try {
    // OAuth uses the Desktop-app loopback callback (127.0.0.1:5055), so the
    // Google login browser must be opened on the actual main-server PC.
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const url = await createGoogleOAuthUrl(await getSettings());
    if (openOnMainServer(url)) {
      return NextResponse.redirect(new URL('/settings?gmail_login_opened=1', request.url));
    }
    // Non-Windows/cloud fallback keeps the previous direct redirect behavior.
    return NextResponse.redirect(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const base = process.env.SERVICEFLOW_PUBLIC_BASE_URL || new URL(request.url).origin;
    return NextResponse.redirect(`${base}/settings?gmail_error=${encodeURIComponent(detail)}`);
  }
}
