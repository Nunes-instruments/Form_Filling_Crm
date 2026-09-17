import type { ServiceJob } from '@/types/service-job';

export function safeSegment(value: string, fallback = 'NA') {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
    .slice(0, 70);
  return cleaned || fallback;
}

export function buildJobFolderName(job: ServiceJob) {
  const customer = safeSegment(job.customer.name, 'Customer');
  const product = safeSegment(job.products[0]?.productName || 'Service');
  return `${safeSegment(job.jobNo)}__${customer}__${product}`;
}

export function buildJobFileBase(job: ServiceJob) {
  return buildJobFolderName(job);
}
