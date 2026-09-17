import crypto from 'crypto';
import type { AppSettings, ServiceJob } from '@/types/service-job';
import { sendWhatsAppWebMessage } from './whatsapp-web';
import { checkGoogleGmailConnection, sendGmailEstimate } from './google-gmail';

function money(n: number) { return Number(n || 0).toFixed(2); }
function formatJobDate(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value || '');
  return `${match[3]}-${match[2]}-${match[1]}`;
}
function customerDisplayName(job: ServiceJob) {
  return String(job.customer.name || job.customer.contactPerson || 'Customer').trim() || 'Customer';
}
function productValue(p: ServiceJob['products'][number]) {
  const saved = Number(p.productValue || 0);
  return saved > 0 ? saved : Number(p.onlinePrice || 0);
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c)); }

export function whatsappNumber(phone: string) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

export function estimateFingerprint(job: ServiceJob) {
  const payload = {
    customer: { phone: job.customer.phone, email: job.customer.email },
    products: job.products.map(p => ({ name:p.productName, problem:p.complaint || p.repairWork, qty:p.qty, estimate:p.repairEstimate })),
    total: job.totals.totalEstimate
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildEstimateText(job: ServiceJob, _settings: AppSettings) {
  const lines: string[] = [
    `Dear *${customerDisplayName(job)}*,`,
    '',
    'Your product repair has been completed. Please find the repair details below.'
  ];

  job.products.forEach((p, i) => {
    const qty = Math.max(1, Number(p.qty || 1));
    const value = productValue(p);
    const repairUnit = Number(p.repairEstimate || 0);
    if (job.products.length > 1) lines.push('', `*Product ${i + 1}*`);
    else lines.push('');
    lines.push(`*Product:* ${p.productName || 'Instrument'}`);
    if (qty > 1) lines.push(`*Qty:* ${qty}`);
    lines.push(`*Repair / Problem:* ${p.complaint || p.repairWork || '-'}`);
    if (value > 0) lines.push(`*Product Value:* INR ${money(value)}`);
    if (repairUnit > 0) lines.push(`*Repairing Cost:* INR ${money(repairUnit)}`);
  });

  if (Number(job.totals.totalEstimate || 0) > 0) {
    lines.push('', `*Total Amount:* INR ${money(job.totals.totalEstimate)}`);
  }

  lines.push(
    '',
    'Thank you for choosing *Nunes Instrumentation Service*.',
    '',
    'Regards,',
    '*Nunes Instrumentation*'
  );
  return lines.join('\n').trim();
}

export function buildEstimateHtml(job: ServiceJob, settings: AppSettings) {
  return `<pre>${escapeHtml(buildEstimateText(job, settings))}</pre>`;
}

export function estimateReady(job: ServiceJob) {
  return job.products.length > 0 && job.products.every(p => Number(p.repairEstimate) > 0) && Number(job.totals.totalEstimate || 0) > 0;
}

export async function checkEmailConnection(settings: AppSettings) {
  return checkGoogleGmailConnection(settings);
}

export async function sendEstimateEmail(job: ServiceJob, settings: AppSettings) {
  return sendGmailEstimate(job, settings);
}

export async function sendEstimateWhatsApp(job: ServiceJob, settings: AppSettings) {
  const to = whatsappNumber(job.customer.phone);
  if (!to) return { status: 'SKIPPED' as const, detail: 'Customer WhatsApp number missing' };
  return sendWhatsAppWebMessage(to, buildEstimateText(job, settings).slice(0, 4000), false);
}
