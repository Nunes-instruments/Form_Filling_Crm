import { NextResponse } from 'next/server';
import { deleteJob, getJob, updateJob } from '@/lib/db';
import { jobInputSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const existing = await getJob(id);
    if (!existing) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    const body = await request.json();
    const parsed = jobInputSchema.parse({ ...existing, ...body, attachments: existing.attachments });
    const products = parsed.products.map((p: any) => ({ ...p, id: p.id || crypto.randomUUID() }));
    const job = await updateJob(id, { ...parsed, products, attachments: existing.attachments } as any);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await deleteJob(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Job not found' }, { status: 404 });
}
