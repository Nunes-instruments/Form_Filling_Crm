import { NextResponse } from 'next/server';
import { getJob, updateJob } from '@/lib/db';
import { saveAttachment } from '@/lib/attachments';
import type { ProofCategory } from '@/types/service-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    const category = String(form.get('category') || 'OTHER') as ProofCategory;
    if (!files.length) return NextResponse.json({ error: 'No files selected' }, { status: 400 });
    const added = [];
    for (const file of files) added.push(await saveAttachment(id, file, category));
    const updated = await updateJob(id, { attachments: [...job.attachments, ...added] });
    return NextResponse.json({ job: updated, attachments: added });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
