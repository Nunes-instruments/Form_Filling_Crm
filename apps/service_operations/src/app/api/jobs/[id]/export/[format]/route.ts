import { NextResponse } from 'next/server';
import { getJob, getSettings } from '@/lib/db';
import { createJobPdf } from '@/lib/pdf';
import { createJobExcel } from '@/lib/excel';
import { createFullZip } from '@/lib/export';
import { buildJobFileBase } from '@/lib/naming';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; format: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, format } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const base = buildJobFileBase(job);
  let bytes: Buffer;
  let contentType: string;
  let ext: string;
  if (format === 'pdf') {
    const settings = await getSettings();
    bytes = await createJobPdf(job, settings.companyName);
    contentType = 'application/pdf'; ext = 'pdf';
  } else if (format === 'xlsx') {
    bytes = await createJobExcel(job);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; ext = 'xlsx';
  } else if (format === 'json') {
    bytes = Buffer.from(JSON.stringify(job, null, 2));
    contentType = 'application/json'; ext = 'json';
  } else if (format === 'zip') {
    bytes = await createFullZip(job);
    contentType = 'application/zip'; ext = 'zip';
  } else {
    return NextResponse.json({ error: 'Supported formats: pdf, xlsx, json, zip' }, { status: 400 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`,
      'Cache-Control': 'no-store'
    }
  });
}
