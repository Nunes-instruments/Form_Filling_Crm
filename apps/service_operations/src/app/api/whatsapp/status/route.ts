import { NextResponse } from 'next/server';
import { getWhatsAppWebStatus } from '@/lib/whatsapp-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getWhatsAppWebStatus(true));
}
