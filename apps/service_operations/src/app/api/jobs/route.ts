import { NextResponse } from 'next/server';
import { createJob, listJobs } from '@/lib/db';
import { jobInputSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

function text(value: unknown) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function digits(value: unknown) { return String(value || '').replace(/\D/g, ''); }

function duplicateIdentity(job: any) {
  const serials = (job.products || []).map((p:any)=>text(p.serialNo)).filter(Boolean).sort();
  return {
    phone: digits(job.customer?.phone),
    email: text(job.customer?.email),
    mrNo: text(job.receipt?.mrNo),
    reference: text(job.receipt?.reference),
    serials
  };
}

function hasUsefulIdentity(value: ReturnType<typeof duplicateIdentity>) {
  return value.phone.length >= 6 || Boolean(value.email) || Boolean(value.mrNo) || Boolean(value.reference) || value.serials.length > 0;
}

function exactFormFingerprint(job: any) {
  return JSON.stringify({
    jobDate: text(job.jobDate),
    branchName: text(job.branchName),
    officeType: text(job.officeType),
    customer: {
      name: text(job.customer?.name), phone: digits(job.customer?.phone), email: text(job.customer?.email),
      contactPerson: text(job.customer?.contactPerson), city: text(job.customer?.city), gstin: text(job.customer?.gstin)
    },
    receipt: {
      mrNo: text(job.receipt?.mrNo), mrDate: text(job.receipt?.mrDate), mode: text(job.receipt?.mode), reference: text(job.receipt?.reference)
    },
    products: (job.products || []).map((p:any)=>({
      productName:text(p.productName), makeModel:text(p.makeModel), serialNo:text(p.serialNo), qty:Number(p.qty||0),
      complaint:text(p.complaint), repairWork:text(p.repairWork), productValue:Number(p.productValue||0),
      repairEstimate:Number(p.repairEstimate||0), repairCategory:text(p.repairCategory), repairPercent:Number(p.repairPercent||0)
    })),
    totals: {
      discount:Number(job.totals?.discount||0), totalEstimate:Number(job.totals?.totalEstimate||0),
      totalEstimateManual:Boolean(job.totals?.totalEstimateManual)
    },
    notes:text(job.notes)
  });
}

export async function POST(request: Request) {
  try {
    const parsed = jobInputSchema.parse(await request.json());

    // Protect against accidental double-click/resubmit only. A genuine later service job
    // for the same customer/product remains allowed. We block only an EXACT same form
    // saved again within 10 minutes and only when the form has a real identity field.
    const identity = duplicateIdentity(parsed);
    if (hasUsefulIdentity(identity)) {
      const fingerprint = exactFormFingerprint(parsed);
      const cutoff = Date.now() - 10 * 60 * 1000;
      const existing = (await listJobs()).find((job:any) => {
        const created = Date.parse(job.createdAt || job.updatedAt || '');
        return Number.isFinite(created) && created >= cutoff && exactFormFingerprint(job) === fingerprint;
      });
      if (existing) {
        return NextResponse.json({
          error: `This exact Servicing form was already saved recently as ${existing.jobNo}. Open/Edit the existing report instead of creating a duplicate.`,
          duplicate: true,
          job: existing
        }, { status: 409 });
      }
    }

    const products = parsed.products.map((p: any) => ({ ...p, id: p.id || crypto.randomUUID() }));
    const job = await createJob({ ...parsed, products } as any);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
