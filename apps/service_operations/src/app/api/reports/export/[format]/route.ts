import { NextResponse } from 'next/server';
import { listJobs } from '@/lib/db';
import { createMasterExcel, createMasterPdf } from '@/lib/master-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ format: string }> };

function norm(value:string|null) { return String(value || '').trim(); }

export async function GET(request: Request, { params }: Ctx) {
  const { format } = await params;
  const url = new URL(request.url);
  const branch = norm(url.searchParams.get('branch'));
  const company = norm(url.searchParams.get('company'));
  const status = norm(url.searchParams.get('status'));
  const from = norm(url.searchParams.get('from'));
  const to = norm(url.searchParams.get('to'));
  const q = norm(url.searchParams.get('q')).toLowerCase();
  const jobs = (await listJobs()).filter(job => {
    const hay = [job.jobNo, job.branchName, job.customer.name, job.customer.contactPerson, job.customer.phone, job.customer.email,
      job.products.map(p=>`${p.productName} ${p.makeModel} ${p.serialNo}`).join(' ')].join(' ').toLowerCase();
    return (!branch || branch === 'ALL' || job.branchName === branch)
      && (!company || company === 'ALL' || job.customer.name === company)
      && (!status || status === 'ALL' || job.status === status)
      && (!from || job.jobDate >= from)
      && (!to || job.jobDate <= to)
      && (!q || hay.includes(q));
  });
  const titleBits = ['ServiceFlow Master Data'];
  if (branch && branch !== 'ALL') titleBits.push(branch);
  if (company && company !== 'ALL') titleBits.push(company);
  if (from || to) titleBits.push(`${from || 'Start'} to ${to || 'Today'}`);
  const title = titleBits.join(' - ');
  const stamp = new Date().toISOString().slice(0,10);
  if (format === 'xlsx') {
    const bytes = await createMasterExcel(jobs, title);
    return new NextResponse(new Uint8Array(bytes), { headers:{ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition':`attachment; filename="ServiceFlow_Master_${stamp}.xlsx"` } });
  }
  if (format === 'pdf') {
    const bytes = await createMasterPdf(jobs, title);
    return new NextResponse(new Uint8Array(bytes), { headers:{ 'Content-Type':'application/pdf', 'Content-Disposition':`attachment; filename="ServiceFlow_Master_${stamp}.pdf"` } });
  }
  return NextResponse.json({ error:'Supported formats: xlsx, pdf' }, { status:400 });
}
