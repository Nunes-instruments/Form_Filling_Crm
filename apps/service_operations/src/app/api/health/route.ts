import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const SOURCE_SIGNATURE = (() => {
  const env = String(process.env.NUNES_SOURCE_SIGNATURE || '').trim();
  if (env) return env;
  try { return readFileSync(join(process.cwd(), 'SOURCE_SIGNATURE.txt'), 'utf8').trim(); } catch { return ''; }
})();
const INSTANCE_ID = createHash('sha1').update(process.cwd().toLowerCase()).digest('hex').slice(0, 16);

export async function GET() {
  return NextResponse.json(
    { app: 'ServiceFlowJobCards', version: '1.1.38', ok: true, instance_id: INSTANCE_ID, source_signature: SOURCE_SIGNATURE },
    { headers: { 'cache-control': 'no-store' } }
  );
}
