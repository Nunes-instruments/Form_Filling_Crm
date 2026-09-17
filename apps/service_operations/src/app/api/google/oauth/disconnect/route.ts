import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const current = await getSettings();
  const saved = await saveSettings({ ...current, googleOAuthRefreshToken:'', googleOAuthEmail:'', smtpPassword:'' });
  return NextResponse.json({ ok:true, sender:saved.googleOAuthEmail });
}
