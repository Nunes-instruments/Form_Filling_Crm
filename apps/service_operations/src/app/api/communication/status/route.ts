import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { checkEmailConnection } from '@/lib/communications';
import { googleOAuthConfigured, googleOAuthConnected } from '@/lib/google-gmail';
import { getWhatsAppWebStatus } from '@/lib/whatsapp-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  const whatsapp = await getWhatsAppWebStatus(false);
  return NextResponse.json({
    email: {
      configured: googleOAuthConfigured(settings),
      connected: googleOAuthConnected(settings),
      sender: settings.googleOAuthEmail,
      status: googleOAuthConnected(settings) ? 'CONFIGURED' : googleOAuthConfigured(settings) ? 'LOGIN_REQUIRED' : 'NOT_CONFIGURED'
    },
    whatsapp
  });
}

export async function POST() {
  const settings = await getSettings();
  const [email, whatsapp] = await Promise.all([checkEmailConnection(settings), getWhatsAppWebStatus(true)]);
  return NextResponse.json({ email, whatsapp });
}
