'use client';

import { Download, Printer, X } from 'lucide-react';
import type { ServiceJob } from '@/types/service-job';

type PreviewJob = Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'> & Partial<Pick<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>>;

function text(value: unknown) {
  const s = String(value ?? '').trim();
  return s || '\u00a0';
}

function pretty(value: string) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function date(value: string) {
  if (!value) return '';
  const parts = value.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return value;
}

function money(value: number, currency: string) {
  const n = Number(value || 0);
  return `${currency || ''} ${n.toFixed(2)}`.trim();
}

function CheckedBox({ checked }: { checked: boolean }) {
  return <span className={`paperCheck ${checked ? 'checked' : ''}`}>{checked ? '✓' : ''}</span>;
}

function LineField({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={`paperLineField ${wide ? 'wide' : ''}`}><b>{label}</b><span>{text(value)}</span></div>;
}

export default function PaperJobCardPreview({ job, onClose }: { job: PreviewJob; onClose: () => void }) {
  const rows = Array.from({ length: 4 }, (_, i) => job.products[i]);
  const repairTotal = Number(job.totals?.repairEstimate || 0);
  const discount = Number(job.totals?.discount || 0);
  const totalEstimate = Number(job.totals?.totalEstimate || Math.max(0, repairTotal - discount));
  const currency = 'INR';
  const productStatuses = Array.from(new Set(job.products.map((p) => p.status || job.status)));
  const productStatusSummary = productStatuses.length === 0
    ? pretty(job.status)
    : productStatuses.length === 1
      ? pretty(productStatuses[0])
      : `${pretty(productStatuses[0])} +${productStatuses.length - 1}`;

  return (
    <div className="paperPreviewOverlay" role="dialog" aria-modal="true" aria-label="Service Job Card preview">
      <div className="paperPreviewShell">
        <div className="paperPreviewToolbar">
          <div>
            <b>Final Service Job Card Preview</b>
            <span>Same paper-card layout as your original form. Review it before print or PDF.</span>
          </div>
          <div className="paperPreviewActions">
            {job.id ? <a className="button" href={`/api/jobs/${job.id}/export/pdf`}><Download size={16}/> PDF</a> : <span className="paperUnsavedNote">Save once to enable PDF</span>}
            <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16}/> Print</button>
            <button type="button" className="iconButton" title="Back to form" onClick={onClose}><X size={18}/></button>
          </div>
        </div>

        <div className="paperPreviewSummary" aria-label="Service tracking summary">
          <div><span>Enquiry Branch</span><b>{job.branchName || '—'}</b></div>
          <div><span>Company / Customer</span><b>{job.customer.name || '—'}</b></div>
          <div><span>Product Status</span><b>{productStatusSummary}</b></div>
          <div><span>Job Status</span><b>{pretty(job.status)}</b></div>
        </div>

        <article className="paperJobCard">
          <div className="paperTopRow">
            <div className="paperSerial"><b>S.NO:</b><strong>{text(job.legacySerialNo || job.jobNo || '')}</strong></div>
            <div className="paperTitle">SERVICE JOB CARD</div>
            <LineField label="Date:" value={date(job.jobDate)} />
          </div>

          <div className="paperOfficeRow">
            <div />
            <div className="paperOfficeChecks">
              <span>Head Office <CheckedBox checked={job.officeType === 'HEAD_OFFICE'} /></span>
              <span>Branch Office <CheckedBox checked={job.officeType === 'BRANCH_OFFICE'} /></span>
            </div>
          </div>

          <section className="paperSection paperCustomerSection">
            <h3>Customer Details</h3>
            <div className="paperCustomerGrid">
              <LineField label="Name:" value={job.customer.name} />
              <LineField label="Phone:" value={job.customer.phone} />
              <LineField label="City:" value={job.customer.city} />
              <LineField label="Address:" value={job.customer.address} wide />
              <LineField label="Email:" value={job.customer.email} wide />
            </div>
          </section>

          <section className="paperSection paperReceiptSection">
            <h3>Receipt Details</h3>
            <div className="paperReceiptGrid">
              <LineField label="MR.NO:" value={job.receipt.mrNo} />
              <LineField label="MR. Date:" value={date(job.receipt.mrDate)} />
              <div className="paperReceiptMode">
                <b>Mode of Receipt</b>
                <span><CheckedBox checked={job.receipt.mode === 'COURIER'} /> Courier</span>
                <span><CheckedBox checked={job.receipt.mode === 'DIRECT'} /> Direct</span>
              </div>
              <LineField label="Receipt Reference:" value={job.receipt.reference} wide />
            </div>
          </section>

          <section className="paperSection paperProductSection">
            <h3>Product Details</h3>
            <table className="paperProductTable">
              <thead>
                <tr>
                  <th>Product Name &amp; Make/ Model/ Sl.No</th>
                  <th>Qty</th>
                  <th>Repair</th>
                  <th>Product Value<br/>(incl.of GST)</th>
                  <th>Repair Cost<br/>Estimate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => <tr key={p?.id || i}>
                  <td>{p ? [p.productName, p.makeModel, p.serialNo].filter(Boolean).join(' / ') : '\u00a0'}</td>
                  <td className="center">{p ? p.qty : '\u00a0'}</td>
                  <td>{p ? (p.repairWork || p.complaint || '\u00a0') : '\u00a0'}</td>
                  <td className="amount">{p ? money(Number(p.productValue || 0) * Number(p.qty || 0), currency) : '\u00a0'}</td>
                  <td className="amount">{p ? money(Number(p.repairEstimate || 0) * Number(p.qty || 0), currency) : '\u00a0'}</td>
                </tr>)}
              </tbody>
            </table>
            {job.products.length > 4 && <div className="paperMoreProducts">+ {job.products.length - 4} additional product(s) remain saved in the electronic job record.</div>}
          </section>

          <div className="paperLowerGrid">
            <div className="paperLowerLeft">
            <section className="paperMiniSection paperDispatch">
              <h3>Dispatch Details</h3>
              <table>
                <tbody>
                  <tr><th>Tested by</th><td>{text(job.dispatch.testedBy)}</td></tr>
                  <tr><th>DC.NO</th><td>{text(job.dispatch.dcNo)}</td></tr>
                  <tr><th>DC.Date</th><td>{text(date(job.dispatch.dcDate))}</td></tr>
                  <tr><th>Mode of Despatch</th><td>{text(job.dispatch.mode)}</td></tr>
                  <tr><th>Despatch Reference</th><td>{text(job.dispatch.reference)}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="paperMiniSection paperPayment">
              <h3>Payment Details</h3>
              <LineField label="Invoice NO:" value={job.payment.invoiceNo} wide />
              <LineField label="Invoice Date:" value={date(job.payment.invoiceDate)} wide />
              <LineField label="Payment Mode:" value={job.payment.mode} wide />
              <LineField label="Payment Reference:" value={job.payment.reference} wide />
              <LineField label="Payment Received by:" value={job.payment.receivedBy} wide />
            </section>
            </div>

            <section className="paperTotalsSection">
              <table>
                <tbody>
                  <tr><th>Total</th><td>{money(repairTotal, currency)}</td></tr>
                  <tr><th>Discount</th><td>{money(discount, currency)}</td></tr>
                  <tr><th>Total Estimate</th><td>{money(totalEstimate, currency)}</td></tr>
                </tbody>
              </table>
            </section>
          </div>

          <div className="paperSignatures">
            <div><span>{text(job.signoff.receivedBy)}</span><b>Received by</b></div>
            <div><span>{text(job.signoff.inspectedBy)}</span><b>Inspected by</b></div>
            <div><span>{text(job.signoff.estimateConfirmedBy)}</span><b>Estimate Confirmed by</b></div>
            <div><span>{text(job.signoff.repairedBy)}</span><b>Repaired by</b></div>
          </div>
        </article>
      </div>
    </div>
  );
}
