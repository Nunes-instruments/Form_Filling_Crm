import { NextResponse } from 'next/server';
import { prepareWhatsAppWeb } from '@/lib/whatsapp-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(await prepareWhatsAppWeb());
}
