import { NextResponse } from 'next/server';
import { listJobs } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown) { return String(value || '').trim(); }
function key(value: unknown) { return text(value).toLocaleLowerCase(); }
let cached: { signature:string; data:any } | null = null;

export async function GET() {
  const jobs = await listJobs();
  const signature = `${jobs.length}:${jobs[0]?.updatedAt || ''}`;
  if (cached?.signature === signature) return NextResponse.json(cached.data);
  const customers: Array<{name:string; phone:string; email:string; address:string; city:string; state:string; gstin:string; contactPerson:string}> = [];
  const products: Array<{productName:string; makeModel:string; complaint:string; repairWork:string}> = [];
  const people:string[] = [];
  const dispatchModes:string[] = [];
  const seenCustomers = new Set<string>();
  const seenProducts = new Set<string>();
  const seenPeople = new Set<string>();
  const seenDispatch = new Set<string>();

  for (const job of jobs) {
    const customerName = text(job.customer?.name);
    if (customerName && !seenCustomers.has(key(customerName))) {
      seenCustomers.add(key(customerName));
      customers.push({
        name: customerName,
        phone: text(job.customer?.phone),
        email: text(job.customer?.email),
        address: text(job.customer?.address),
        city: text(job.customer?.city),
        state: text(job.customer?.state),
        gstin: text(job.customer?.gstin),
        contactPerson: text(job.customer?.contactPerson)
      });
    }
    for (const p of job.products || []) {
      const productName = text(p.productName);
      const makeModel = text(p.makeModel);
      const productKey = `${key(productName)}|||${key(makeModel)}`;
      if ((productName || makeModel) && !seenProducts.has(productKey)) {
        seenProducts.add(productKey);
        products.push({ productName, makeModel, complaint:text(p.complaint), repairWork:text(p.repairWork) });
      }
    }
    for (const name of [job.dispatch?.testedBy, job.payment?.receivedBy, job.signoff?.receivedBy, job.signoff?.inspectedBy, job.signoff?.estimateConfirmedBy, job.signoff?.repairedBy]) {
      const value=text(name); const k=key(value);
      if (value && !seenPeople.has(k)) { seenPeople.add(k); people.push(value); }
    }
    const dispatch=text(job.dispatch?.mode); const dk=key(dispatch);
    if (dispatch && !seenDispatch.has(dk)) { seenDispatch.add(dk); dispatchModes.push(dispatch); }
  }

  const data = {
    customers: customers.slice(0, 250),
    products: products.slice(0, 500),
    people: people.slice(0, 150),
    dispatchModes: dispatchModes.slice(0, 100)
  };
  cached = { signature, data };
  return NextResponse.json(data);
}
