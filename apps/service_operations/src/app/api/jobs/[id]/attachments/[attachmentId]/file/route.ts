import { NextResponse } from 'next/server';
import { getJob } from '@/lib/db';
import { readAttachmentFile } from '@/lib/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, attachmentId } = await params;
  const job = await getJob(id);
  const a = job?.attachments.find((x) => x.id === attachmentId);
  if (!job || !a) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  try {
    const bytes = await readAttachmentFile(id, a.storedName);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': a.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
        'Cache-Control': 'private, max-age=60'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Local proof file is missing' }, { status: 404 });
  }
}
