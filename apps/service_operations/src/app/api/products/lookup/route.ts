import { NextResponse } from 'next/server';
import { lookupOnlineProduct } from '@/lib/online-product';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productName = String(body.productName || '').trim();
    const makeModel = String(body.makeModel || '').trim();
    if (!productName) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    const details = await lookupOnlineProduct(productName, makeModel);
    return NextResponse.json({ details });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
