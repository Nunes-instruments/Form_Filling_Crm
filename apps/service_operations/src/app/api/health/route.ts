import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const instanceId = createHash('sha1').update(process.cwd().toLowerCase()).digest('hex').slice(0, 16);
  return NextResponse.json({ app: 'ServiceFlowJobCards', version: '1.1.33', ok: true, instance_id: instanceId }, { headers: { 'cache-control': 'no-store' } });
}
