import { NextResponse } from 'next/server';
import { logoutWhatsAppWeb } from '@/lib/whatsapp-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(await logoutWhatsAppWeb());
}
