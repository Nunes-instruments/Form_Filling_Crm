import { NextResponse } from 'next/server';
import { getWhatsAppWebStatus } from '@/lib/whatsapp-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const initialize = url.searchParams.get('init') !== '0';
  return NextResponse.json(await getWhatsAppWebStatus(initialize), {
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' }
  });
}
