import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { checkEmailConnection } from '@/lib/communications';
import { googleOAuthConfigured, googleOAuthConnected } from '@/lib/google-gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    configured: googleOAuthConfigured(settings),
    connected: googleOAuthConnected(settings),
    sender: settings.googleOAuthEmail,
    status: googleOAuthConnected(settings) ? 'CONFIGURED' : googleOAuthConfigured(settings) ? 'LOGIN_REQUIRED' : 'NOT_CONFIGURED'
  });
}

export async function POST() {
  return NextResponse.json(await checkEmailConnection(await getSettings()));
}
