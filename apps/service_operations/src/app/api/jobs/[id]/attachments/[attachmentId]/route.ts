import { NextResponse } from 'next/server';
import { getJob, updateJob } from '@/lib/db';
import { deleteAttachmentFile } from '@/lib/attachments';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, attachmentId } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const attachment = job.attachments.find((a) => a.id === attachmentId);
  if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  await deleteAttachmentFile(id, attachment.storedName);
  const updated = await updateJob(id, { attachments: job.attachments.filter((a) => a.id !== attachmentId) });
  return NextResponse.json({ job: updated });
}
